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
  const { data: apiKeyData, error: apiKeyError } = await supabase
    .from('api_keys')
    .select('id, key')
    .eq('is_active', true)
    .limit(1)
    .single();

  // Nếu không tìm thấy API key trong DB, dùng từ .env
  let geminiApiKey = process.env.GEMINI_API_KEY;
  if (!apiKeyError && apiKeyData) {
    geminiApiKey = apiKeyData.key;
  } else {
    console.warn('[Check] No active API key in DB, using GEMINI_API_KEY from .env');
  }

  if (!geminiApiKey) {
    return res.status(500).json({ error: 'No Gemini API key configured' });
  }

  // ── Lấy 1-2 mẫu few-shot từ DB (ưu tiên cùng platform) ──────────────────
  let fewShotExamples = [];

  // Thử lấy mẫu cùng platform trước
  const { data: samePlatformExamples } = await supabase
    .from('scam_templates')
    .select('id, title, platform, scam_type, analysis, messages_json')
    .eq('is_approved', true)
    .ilike('platform', `%${platform}%`)
    .limit(2);

  if (samePlatformExamples && samePlatformExamples.length > 0) {
    fewShotExamples = samePlatformExamples;
  } else {
    // Fallback: lấy mẫu bất kỳ
    const { data: anyExamples } = await supabase
      .from('scam_templates')
      .select('id, title, platform, scam_type, analysis, messages_json')
      .eq('is_approved', true)
      .limit(2);
    fewShotExamples = anyExamples || [];
  }

  // ── Gọi Gemini để phân tích ───────────────────────────────────────────────
  let analysisResult;
  try {
    analysisResult = await analyzeImages(req.files, platform, geminiApiKey, fewShotExamples);
  } catch (err) {
    console.error('[Check] Gemini analysis error:', err.message);
    return res.status(500).json({ error: `Analysis failed: ${err.message}` });
  }

  // ── Nếu là lừa đảo: lưu vào DB (pending approval) ────────────────────────
  let savedTemplateId = null;
  if (analysisResult.isScam && analysisResult.title) {
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
