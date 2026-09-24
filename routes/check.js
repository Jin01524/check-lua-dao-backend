import express from 'express';
import multer from 'multer';
import { getSupabaseClient } from '../lib/supabase.js';
import { analyzeContent } from '../services/geminiService.js';
import { extractTextWithGoogleVision } from '../services/visionOcrService.js';
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
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
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

  // ── Lấy API key active từ Supabase ───────────────────────────────────────
  const { data: dbKeys, error: dbError } = await supabase
    .from('api_keys')
    .select('id, key, label, is_active');

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

  // ── Lấy 1-2 mẫu few-shot từ DB (ưu tiên cùng platform) ──────────────────
  let fewShotExamples = [];
  try {
    const { data: samePlatformExamples } = await supabase
      .from('scam_templates')
      .select('id, title, platform, scam_type, analysis, messages_json, confidence_score')
      .gte('confidence_score', 40)
      .neq('scam_type', 'Tin nhắn an toàn / Bình thường')
      .ilike('platform', `%${platform}%`)
      .limit(2);

    if (samePlatformExamples && samePlatformExamples.length > 0) {
      fewShotExamples = samePlatformExamples;
    } else {
      const { data: anyExamples } = await supabase
        .from('scam_templates')
        .select('id, title, platform, scam_type, analysis, messages_json, confidence_score')
        .gte('confidence_score', 40)
        .neq('scam_type', 'Tin nhắn an toàn / Bình thường')
        .limit(2);
      fewShotExamples = anyExamples || [];
    }
  } catch (err) {
    console.error('[Check] Failed to fetch few-shot examples:', err.message);
  }

  // ── Lấy 1-2 mẫu an toàn từ DB để AI đối chiếu phân biệt ─────────────────
  let safeExamples = [];
  try {
    const { data: safeDbExamples } = await supabase
      .from('scam_templates')
      .select('id, title, platform, scam_type, analysis, messages_json, confidence_score')
      .or('confidence_score.lt.40,scam_type.eq.Tin nhắn an toàn / Bình thường')
      .limit(2);

    safeExamples = safeDbExamples || [];
  } catch (err) {
    console.warn('[Check] Could not fetch safe reference examples:', err.message);
  }

  // ── Bước 1: Trích xuất văn bản độc quyền qua Google Cloud Vision OCR (KHÔNG DÙNG FALLBACK) ──
  let ocrExtractedText = '';
  let ocrUsed = false;
  if (files.length > 0) {
    const primaryKey = shuffledKeys[0]?.key;
    const ocrRes = await extractTextWithGoogleVision(files, primaryKey);
    if (!ocrRes.success || !ocrRes.extractedText) {
      const detail = ocrRes.error ? `: ${ocrRes.error}` : '';
      console.error('[Check] Google Cloud Vision OCR thất bại và fallback đã bị tắt:', ocrRes.error);
      return res.status(400).json({
        error: `Google Cloud Vision OCR không trích xuất được văn bản${detail}. Cơ chế dự phòng (fallback) đã bị tắt theo yêu cầu hệ thống.`,
      });
    }

    ocrExtractedText = ocrRes.extractedText;
    ocrUsed = true;
    console.log(`[Check] Google Cloud Vision OCR hoàn tất (${ocrExtractedText.length} ký tự)`);
  }

  // Kết hợp nội dung text người dùng nhập và văn bản bóc tách từ Google Vision
  let effectiveTextContent = textContent || '';
  if (ocrExtractedText) {
    effectiveTextContent = effectiveTextContent.trim()
      ? `${effectiveTextContent.trim()}\n\n[Văn bản trích xuất nguyên vẹn qua Google Cloud Vision OCR]:\n${ocrExtractedText}`
      : `[Văn bản trích xuất nguyên vẹn qua Google Cloud Vision OCR]:\n${ocrExtractedText}`;
  }

  if (!effectiveTextContent.trim()) {
    return res.status(400).json({ error: 'Không tìm thấy nội dung văn bản nào để AI phân tích.' });
  }

  // ── Gọi Gemini để phân tích (xoay tua qua các API keys) ──────────────────
  // ĐÃ TẮT FALLBACK: Không gửi file ảnh lên Gemini (imageFiles: []), 100% xử lý text-only từ Google Vision
  let analysisResult = null;
  let lastError = null;

  for (const keyObj of shuffledKeys) {
    try {
      console.log(`[Check] Attempting analysis with key: ${keyObj.label} (${keyObj.id})`);
      analysisResult = await analyzeContent({
        imageFiles: [], // KHÔNG gửi ảnh cho Gemini Vision
        textContent: effectiveTextContent,
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

  // ── Ghi nhận số liệu thống kê thực tế vào database Supabase ─────────────
  try {
    await recordScanInDB({
      platform,
      isScam: Boolean(analysisResult.isScam),
      confidenceScore: Number(analysisResult.confidenceScore) || 0,
      scamType: analysisResult.scamType || null,
    });
  } catch (statErr) {
    console.warn('[Check] Could not record scan stats:', statErr.message);
  }

  // ── Trả về kết quả cho Frontend ──────────────────────────────────────────
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
