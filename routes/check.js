import express from 'express';
import multer from 'multer';
import { getSupabaseClient } from '../lib/supabase.js';
import { analyzeImages } from '../services/geminiService.js';

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
 * Phân tích ảnh tin nhắn để phát hiện lừa đảo
 *
 * Body (multipart/form-data):
 *   images  - Tối đa 5 file ảnh (field name: images)
 *   platform - Tên nền tảng (Zalo, Facebook, SMS, v.v.)
 */
router.post('/', upload.array('images', 5), async (req, res) => {
  const supabase = getSupabaseClient();

  // Validate input
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'At least one image is required' });
  }

  const platform = req.body.platform || 'Không xác định';

  // ── Lấy API key active từ Supabase ───────────────────────────────────────
  const { data: dbKeys, error: dbError } = await supabase
    .from('api_keys')
    .select('id, key, label, is_active');

  let activeKeys = [];
  if (!dbError && dbKeys && dbKeys.length > 0) {
    activeKeys = dbKeys.filter(k => k.is_active);
  }

  // Fallback nếu không có key nào trong DB
  if (activeKeys.length === 0) {
    const fallbackKey = process.env.GEMINI_API_KEY;
    if (fallbackKey) {
      activeKeys.push({
        id: 'fallback',
        key: fallbackKey,
        label: 'Fallback Env Key',
        is_active: true
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
      .select('id, title, platform, scam_type, analysis, messages_json')
      .eq('is_approved', true)
      .ilike('platform', `%${platform}%`)
      .limit(2);

    if (samePlatformExamples && samePlatformExamples.length > 0) {
      fewShotExamples = samePlatformExamples;
    } else {
      const { data: anyExamples } = await supabase
        .from('scam_templates')
        .select('id, title, platform, scam_type, analysis, messages_json')
        .eq('is_approved', true)
        .limit(2);
      fewShotExamples = anyExamples || [];
    }
  } catch (err) {
    console.error('[Check] Failed to fetch few-shot examples:', err.message);
  }

  // ── Gọi Gemini để phân tích (thử xoay tua các key) ─────────────────────────
  let analysisResult = null;
  let lastError = null;

  for (const keyObj of shuffledKeys) {
    try {
      console.log(`[Check] Attempting analysis with key: ${keyObj.label} (${keyObj.id})`);
      analysisResult = await analyzeImages(req.files, platform, keyObj.key, fewShotExamples);
      console.log(`[Check] Success using key: ${keyObj.label}`);
      break; // Thành công, thoát vòng lặp
    } catch (err) {
      lastError = err;
      console.error(`[Check] Error with key "${keyObj.label}" (${keyObj.id}):`, err.message);

      // Kiểm tra xem có phải lỗi vĩnh viễn không (403 Forbidden, 400 Bad Request, API key invalid, leaked, v.v.)
      // Lỗi 429 (Rate Limit / Quota) thì không tắt key trong DB, chỉ chuyển sang key tiếp theo.
      const isPermanentError = 
        err.status === 403 || 
        err.status === 400 || 
        err.message.includes('API key') || 
        err.message.includes('API_KEY') || 
        err.message.includes('PERMISSION_DENIED') ||
        err.message.includes('invalid');

      if (isPermanentError && keyObj.id !== 'fallback') {
        console.warn(`[Check] Key "${keyObj.label}" (${keyObj.id}) failed permanently. Automatically disabling it in DB.`);
        // Tắt trạng thái key trong DB bất đồng bộ (không cần await để tránh block request)
        supabase
          .from('api_keys')
          .update({ is_active: false })
          .eq('id', keyObj.id)
          .then(({ error }) => {
            if (error) console.error(`[Check] Failed to auto-disable key ${keyObj.id}:`, error.message);
            else console.log(`[Check] Key ${keyObj.id} is now disabled in DB.`);
          });
      }
    }
  }

  if (!analysisResult) {
    const errorMsg = lastError ? lastError.message : 'Tất cả API key đều thất bại';
    return res.status(500).json({ error: `Phân tích thất bại: ${errorMsg}` });
  }

  // ── Nếu là lừa đảo: lưu vào DB (pending approval) ────────────────────────
  let savedTemplateId = null;
  if (analysisResult.isChatScreenshot && analysisResult.isScam && analysisResult.title) {
    const { data: savedTemplate, error: saveError } = await supabase
      .from('scam_templates')
      .insert({
        title: analysisResult.title,
        platform,
        scam_type: analysisResult.scamType,
        analysis: analysisResult.analysis,
        messages_json: analysisResult.messages,
        is_approved: false,
      })
      .select('id')
      .single();

    if (saveError) {
      console.error('[Check] Failed to save template:', saveError.message);
    } else {
      savedTemplateId = savedTemplate?.id;
      console.log(`[Check] Scam template saved with id: ${savedTemplateId} (pending approval)`);
    }
  }

  // ── Trả về kết quả ────────────────────────────────────────────────────────
  res.json({
    ...analysisResult,
    platform,
    imageCount: req.files.length,
    savedTemplateId,
  });
});

export default router;
