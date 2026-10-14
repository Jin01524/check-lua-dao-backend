import express from 'express';
import multer from 'multer';
import { getSupabaseClient } from '../lib/supabase.js';
import { analyzeContent } from '../services/geminiService.js';
import { extractTextFromImages } from '../services/ocrService.js';
import { assessContext } from '../lib/contextFlow.js';
import { hasConclusiveAssessment, persistScanOutcome } from '../services/scanPersistence.js';
import { createHash } from 'node:crypto';

const router = express.Router();
export const v2Router = express.Router();
const recentRequests = new Map();
const REQUEST_TTL_MS = 10 * 60 * 1000;
const MAX_RECENT_REQUESTS = 300;

function requestFingerprint(req) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(req.body));
  for (const file of req.files || []) {
    hash.update(file.originalname || '');
    hash.update(file.buffer);
  }
  return hash.digest('hex');
}

async function idempotentCheck(req, res, options) {
  if (process.env.CONTEXT_FLOW_ENABLED === 'false') {
    return res.status(404).json({ error: 'Route not found' });
  }
  const id = String(req.body.clientRequestId || '').trim();
  if (id && !/^[a-zA-Z0-9-]{8,80}$/.test(id)) {
    return res.status(400).json({ error: 'Mã yêu cầu không hợp lệ.' });
  }
  if (!id) return handleCheck(req, res, options);
  const now = Date.now();
  for (const [key, entry] of recentRequests) {
    if (now - entry.createdAt > REQUEST_TTL_MS) recentRequests.delete(key);
  }
  if (recentRequests.size >= MAX_RECENT_REQUESTS) {
    const oldestCompleted = [...recentRequests].find(([, entry]) => entry.response);
    if (oldestCompleted) recentRequests.delete(oldestCompleted[0]);
  }
  const fingerprint = requestFingerprint(req);
  const prior = recentRequests.get(id);
  if (prior) {
    if (prior.fingerprint !== fingerprint) {
      return res.status(409).json({ error: 'Mã yêu cầu đã được dùng cho nội dung khác.' });
    }
    if (!prior.response) return res.status(409).json({ error: 'Yêu cầu này đang được xử lý.' });
    return res.json(prior.response);
  }
  recentRequests.set(id, { createdAt: now, fingerprint, response: null });
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300 && hasConclusiveAssessment(body.assessment)) {
      const entry = recentRequests.get(id);
      if (entry) entry.response = body;
    } else {
      recentRequests.delete(id);
    }
    return sendJson(body);
  };
  try {
    await handleCheck(req, res, options);
  } finally {
    if (!recentRequests.get(id)?.response) recentRequests.delete(id);
  }
}

// ── Multer config: lưu trong memory, tối đa 5 files, mỗi file <= 10MB ────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 5,
  },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG and PNG images are allowed'), false);
    }
  },
});

/**
 * POST /api/check
 * Phân tích ảnh tin nhắn và/hoặc văn bản để phát hiện lừa đảo
 *
 * Body (multipart/form-data):
 *   images   - Tối đa 5 file ảnh (field name: images)
 *   text     - Nội dung văn bản hoặc link nghi vấn đi kèm
 *   platform - Tên nền tảng (Zalo, Facebook, SMS, Telegram, v.v.)
 */
async function handleCheck(req, res, { v2 = false, continuation = false } = {}) {
  const startedAt = performance.now();
  const supabase = getSupabaseClient();

  const files = req.files || [];
  const originalText = String(req.body.originalText || '').trim();
  const sentReply = String(req.body.sentReply || '').trim();
  const senderReply = String(req.body.senderReply || req.body.text || '').trim();
  const textContent = continuation
    ? `[Tin nhắn ban đầu]\n${originalText}\n[Người dùng đã hỏi]\n${sentReply}\n[Phản hồi mới của người gửi]\n${senderReply}`
    : String(req.body.text || req.body.content || '').trim();
  const platform = req.body.platform || 'SMS';
  // /continue remains compatible with old clients, but every request is a new scan.
  const round = 1;

  if (v2 && (textContent.length > 24000 || originalText.length > 12000 || sentReply.length > 500 || senderReply.length > 12000)) {
    return res.status(400).json({ error: 'Nội dung vượt quá giới hạn cho một phiên quét.' });
  }
  if (continuation && (!originalText || (!senderReply && files.length === 0))) {
    return res.status(400).json({ error: 'Hãy cung cấp đoạn hội thoại để bắt đầu lượt kiểm tra mới.' });
  }

  // Validate: Cần ít nhất 1 ảnh HOẶC 1 đoạn văn bản
  if (files.length === 0 && !textContent) {
    return res.status(400).json({
      error: 'Vui lòng cung cấp ít nhất 1 ảnh chụp màn hình hoặc nội dung tin nhắn cần kiểm tra.',
    });
  }

  // OCR và các truy vấn độc lập chạy cùng lúc để giảm thời gian chờ.
  const scamExamplesPromise = (async () => {
    const same = await supabase.from('scam_templates')
      .select('id, title, platform, scam_type, analysis, messages_json, confidence_score')
      .gte('confidence_score', 40)
      .neq('scam_type', 'Tin nhắn an toàn / Bình thường')
      .eq('is_approved', true)
      .ilike('platform', `%${platform}%`)
      .limit(2);
    if (!same.error && same.data?.length) return same.data;

    const any = await supabase.from('scam_templates')
      .select('id, title, platform, scam_type, analysis, messages_json, confidence_score')
      .gte('confidence_score', 40)
      .neq('scam_type', 'Tin nhắn an toàn / Bình thường')
      .eq('is_approved', true)
      .limit(2);
    if (any.error) throw any.error;
    return any.data || [];
  })();

  const [keyResult, scamResult, safeResult, ocrResult] = await Promise.allSettled([
    supabase.from('api_keys').select('id, key, label, is_active'),
    scamExamplesPromise,
    supabase.from('scam_templates')
      .select('id, title, platform, scam_type, analysis, messages_json, confidence_score')
      .or('confidence_score.lt.40,scam_type.eq.Tin nhắn an toàn / Bình thường')
      .eq('is_approved', true)
      .limit(2),
    files.length > 0 ? extractTextFromImages(files) : Promise.resolve(''),
  ]);

  if (ocrResult.status === 'rejected') {
    console.error('[Check] Local OCR failed:', ocrResult.reason);
    return res.status(503).json({ error: 'Không thể đọc chữ trong ảnh. Vui lòng thử lại.' });
  }

  const ocrExtractedText = ocrResult.value;
  const ocrUsed = files.length > 0;
  if (ocrUsed) console.log(`[Check] Local OCR hoàn tất (${ocrExtractedText.length} ký tự)`);

  const { data: dbKeys, error: dbError } = keyResult.status === 'fulfilled'
    ? keyResult.value
    : { data: null, error: keyResult.reason };

  let activeKeys = [];
  if (!dbError && dbKeys && dbKeys.length > 0) {
    activeKeys = dbKeys.filter((k) => k.is_active);
  }

  // Fallback nếu không có key nào trong DB
  if (activeKeys.length === 0) {
    const fallbackKey = process.env.GEMINI_API_KEY;
    if (fallbackKey) {
      activeKeys.push({
        id: 'fallback',
        key: fallbackKey,
        label: 'Fallback Env Key',
        is_active: true,
      });
      console.warn('[Check] No active keys in DB, using fallback GEMINI_API_KEY from .env');
    }
  }

  if (activeKeys.length === 0) {
    return res.status(500).json({ error: 'Hệ thống chưa được cấu hình API key hoạt động' });
  }

  // Shuffle activeKeys để xoay tua ngẫu nhiên (Load Balancing)
  const shuffledKeys = [...activeKeys].sort(() => Math.random() - 0.5);

  const fewShotExamples = scamResult.status === 'fulfilled' ? scamResult.value : [];
  if (scamResult.status === 'rejected') {
    console.error('[Check] Failed to fetch few-shot examples:', scamResult.reason);
  }

  const safeExamples = safeResult.status === 'fulfilled' && !safeResult.value.error
    ? safeResult.value.data || []
    : [];

  // Kết hợp văn bản người dùng nhập với kết quả OCR.
  let effectiveTextContent = textContent || '';
  if (ocrExtractedText) {
    effectiveTextContent = effectiveTextContent.trim()
      ? `${effectiveTextContent.trim()}\n\n[Văn bản OCR từ ảnh]:\n${ocrExtractedText}`
      : `[Văn bản OCR từ ảnh]:\n${ocrExtractedText}`;
  }

  if (!effectiveTextContent.trim()) {
    return res.status(400).json({ error: 'Không tìm thấy nội dung văn bản nào để AI phân tích.' });
  }

  // ── Gọi Gemini để phân tích (xoay tua qua các API keys) ──────────────────
  // Chỉ văn bản được gửi tới Gemini.
  const preparationFinishedAt = performance.now();
  let analysisResult = null;
  let lastError = null;

  for (const keyObj of shuffledKeys) {
    try {
      console.log(`[Check] Attempting analysis with key: ${keyObj.label} (${keyObj.id})`);
      analysisResult = await analyzeContent({
        textContent: effectiveTextContent,
        imageCount: files.length,
        platform,
        apiKey: keyObj.key,
        fewShotExamples,
        safeExamples,
        contextFlowEnabled: v2,
      });
      console.log(`[Check] Success using key: ${keyObj.label}`);
      break;
    } catch (err) {
      lastError = err;
      console.error(`[Check] Error with key "${keyObj.label}" (${keyObj.id}):`, err.message);

      // Tự động tắt key nếu bị vô hiệu vĩnh viễn
      const isPermanentError =
        err.status === 403 ||
        err.status === 400 ||
        err.message.includes('API key') ||
        err.message.includes('API_KEY') ||
        err.message.includes('PERMISSION_DENIED') ||
        err.message.includes('invalid');

      if (isPermanentError && keyObj.id !== 'fallback') {
        console.warn(`[Check] Disabling invalid key "${keyObj.label}" in DB.`);
        supabase
          .from('api_keys')
          .update({ is_active: false })
          .eq('id', keyObj.id)
          .then(() => {});
      }
    }
  }

  if (!analysisResult) {
    if (lastError) console.error('[Check] Analysis provider failed:', lastError);
    return res.status(500).json({ error: 'Phân tích thất bại. Vui lòng thử lại sau.' });
  }
  const analysisFinishedAt = performance.now();
  const assessment = assessContext({
    analysisResult,
    textContent: effectiveTextContent,
    contextText: continuation ? `${originalText}\n${senderReply}\n${ocrExtractedText}` : effectiveTextContent,
    round,
  });
  const modelDisagreement = assessment.status === 'high_risk' && !analysisResult.isScam;
  const { scanSessionId, templateSave } = await persistScanOutcome({
    assessment, analysisResult, platform, supabase,
  });
  // ── Trả về kết quả cho Frontend ──────────────────────────────────────────
  console.log(`[Check] Timing: chuẩn bị/OCR ${Math.round(preparationFinishedAt - startedAt)}ms, AI ${Math.round(analysisFinishedAt - preparationFinishedAt)}ms, lưu ${Math.round(performance.now() - analysisFinishedAt)}ms`);
  res.json({
    ...analysisResult,
    ...(modelDisagreement ? {
      analysis: 'Nội dung có yêu cầu nhạy cảm, nhưng đánh giá AI chưa thống nhất. Không cung cấp thông tin, không thực hiện yêu cầu và hãy xác minh qua kênh chính thức.',
      multiAgentDebate: null,
      warningPoints: ['Có yêu cầu nhạy cảm cần xác minh độc lập.'],
      recommendations: ['Không trả lời hoặc thực hiện yêu cầu trong cuộc chat này.', 'Tự tìm kênh chính thức để xác minh.'],
    } : {}),
    isScam: assessment.status === 'high_risk',
    confidenceScore: assessment.riskScore,
    platform,
    imageCount: files.length,
    hasText: Boolean(textContent),
    savedTemplateId: templateSave.id,
    templateSaveStatus: templateSave.status,
    scanSessionId,
    assessment: {
      status: assessment.status,
      riskScore: assessment.riskScore,
      reason: assessment.reason,
    },
    suggestedReply: assessment.suggestedReply,
    allowedActions: assessment.allowedActions,
    changedBecause: null,
    ocrUsed,
    ocrExtractedText: ocrExtractedText || null,
  });
}

router.post('/', upload.array('images', 5), (req, res) => handleCheck(req, res));
v2Router.post('/', upload.array('images', 5), (req, res) => idempotentCheck(req, res, { v2: true }));
v2Router.post('/continue', upload.array('images', 5), (req, res) => idempotentCheck(req, res, { v2: true, continuation: true }));

export default router;
