import express from 'express';
import multer from 'multer';
import { getSupabaseClient } from '../lib/supabase.js';
import { analyzeContent } from '../services/geminiService.js';
import { extractTextFromImages } from '../services/ocrService.js';
import { recordScanInDB, sessionStats } from './stats.js';

const router = express.Router();

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
router.post('/', upload.array('images', 5), async (req, res) => {
  const startedAt = performance.now();
  const supabase = getSupabaseClient();

  const files = req.files || [];
  const textContent = (req.body.text || req.body.content || '').trim();
  const platform = req.body.platform || 'SMS';

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
      .ilike('platform', `%${platform}%`)
      .limit(2);
    if (!same.error && same.data?.length) return same.data;

    const any = await supabase.from('scam_templates')
      .select('id, title, platform, scam_type, analysis, messages_json, confidence_score')
      .gte('confidence_score', 40)
      .neq('scam_type', 'Tin nhắn an toàn / Bình thường')
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
    const errorMsg = lastError ? lastError.message : 'Tất cả API key đều thất bại';
    return res.status(500).json({ error: `Phân tích thất bại: ${errorMsg}` });
  }
  const analysisFinishedAt = performance.now();

  // ── Lưu trữ tin nhắn vào DB (Cả mẫu rủi ro và mẫu an toàn) ──────────────
  let savedTemplateId = null;
  const numScore = Number(analysisResult.confidenceScore) || 0;
  const hasRisk = Boolean(analysisResult.isScam) || numScore >= 40;
  const hasContent = Boolean(analysisResult.isChatScreenshot) || Boolean(textContent) || files.length > 0;

  if (hasContent) {
    const messagesToSave = Array.isArray(analysisResult.messages) && analysisResult.messages.length > 0
      ? analysisResult.messages
      : (textContent ? [{ sender: 'user', text: textContent }] : []);

    if (hasRisk && (analysisResult.title || analysisResult.scamType)) {
      // 1. Tin nhắn có rủi ro: Lưu vào kho mẫu lừa đảo (trạng thái Chưa kiểm định is_approved = false)
      const baseTemplate = {
        title: analysisResult.title || analysisResult.scamType || 'Nghi vấn tin nhắn lừa đảo mới',
        platform,
        scam_type: analysisResult.scamType || 'Nghi vấn lừa đảo',
        analysis: analysisResult.analysis || '',
        messages_json: messagesToSave,
        is_approved: false,
      };

      let insertData = {
        ...baseTemplate,
        attack_target: analysisResult.attackTarget || 'Không rõ',
        confidence_score: numScore,
        warning_points: Array.isArray(analysisResult.warningPoints) ? analysisResult.warningPoints : [],
        exfiltration_vector: analysisResult.exfiltrationVector || 'none',
        multi_agent_debate: analysisResult.multiAgentDebate || null,
      };

      let { data: savedTemplate, error: saveError } = await supabase
        .from('scam_templates')
        .insert(insertData)
        .select('id')
        .single();

      if (saveError) {
        const fallbackResult = await supabase
          .from('scam_templates')
          .insert(baseTemplate)
          .select('id')
          .single();
        savedTemplate = fallbackResult.data;
        if (fallbackResult.error) {
          console.error('[Check] Failed to save template fallback:', fallbackResult.error.message);
        }
      }

      if (savedTemplate?.id) {
        savedTemplateId = savedTemplate.id;
        console.log(`[Check] Scam template saved with id: ${savedTemplateId} (chưa được kiểm định)`);
      }
    } else {
      // 2. Tin nhắn KHÔNG rủi ro: Lưu trữ lại để AI đối chiếu & đánh giá (KHÔNG hiện lên kho mẫu)
      const safeTemplate = {
        title: analysisResult.title || 'Tin nhắn an toàn / Bình thường',
        platform,
        scam_type: 'Tin nhắn an toàn / Bình thường',
        analysis: analysisResult.analysis || 'Tin nhắn hợp lệ, không có dấu hiệu thao túng hay lừa đảo.',
        messages_json: messagesToSave,
        is_approved: true,
      };

      let insertSafeData = {
        ...safeTemplate,
        attack_target: 'Không có',
        confidence_score: numScore,
        warning_points: [],
        exfiltration_vector: analysisResult.exfiltrationVector || 'none',
        multi_agent_debate: analysisResult.multiAgentDebate || null,
      };

      try {
        let { data: savedSafe, error: safeErr } = await supabase
          .from('scam_templates')
          .insert(insertSafeData)
          .select('id')
          .single();

        if (safeErr) {
          await supabase.from('scam_templates').insert(safeTemplate);
        }
        if (savedSafe?.id) {
          savedTemplateId = savedSafe.id;
        }
        console.log(`[Check] Stored non-risk message for AI reference benchmark (score: ${numScore}%)`);
      } catch (safeErr) {
        console.warn('[Check] Could not save safe reference message:', safeErr.message);
      }
    }
  }

  // Giữ thống kê hoàn tất trước khi trả kết quả để số liệu giao diện cập nhật ngay.
  try {
    await recordScanInDB({
      platform,
      isScam: Boolean(analysisResult.isScam),
      confidenceScore: numScore,
      scamType: analysisResult.scamType || null,
    });
  } catch (statErr) {
    console.warn('[Check] Could not record scan stats:', statErr.message);
  }
  // ── Trả về kết quả cho Frontend ──────────────────────────────────────────
  console.log(`[Check] Timing: chuẩn bị/OCR ${Math.round(preparationFinishedAt - startedAt)}ms, AI ${Math.round(analysisFinishedAt - preparationFinishedAt)}ms, lưu ${Math.round(performance.now() - analysisFinishedAt)}ms`);
  res.json({
    ...analysisResult,
    platform,
    imageCount: files.length,
    hasText: Boolean(textContent),
    savedTemplateId,
    ocrUsed,
    ocrExtractedText: ocrExtractedText || null,
  });
});

export default router;
