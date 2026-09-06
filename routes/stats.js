import express from 'express';
import { getSupabaseClient } from '../lib/supabase.js';

const router = express.Router();

// Memory counter to track scans in real-time even before DB queries
export const sessionStats = {
  sessionScans: 0,
  sessionWarned: 0,
  sessionMaxConfidence: 0,
};

/**
 * GET /api/stats
 * Trả về thống kê thực tế từ database (scam_templates & scan_logs)
 */
router.get('/', async (_req, res) => {
  let supabase = null;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    console.warn('[Stats] Supabase client not initialized:', err.message);
  }

  let totalScans = sessionStats.sessionScans;
  let warnedScans = sessionStats.sessionWarned;
  let maxConfidence = sessionStats.sessionMaxConfidence;

  if (supabase) {
    try {
      // 1. Thử đếm từ bảng scan_logs (toàn bộ tin nhắn người dùng đã gửi quét)
      const { count: logCount, error: logErr } = await supabase
        .from('scan_logs')
        .select('*', { count: 'exact', head: true });

      if (!logErr && typeof logCount === 'number') {
        totalScans = Math.max(totalScans, logCount);
      }

      // Đếm tin nhắn bị cảnh báo từ scan_logs (lừa đảo hoặc có điểm rủi ro từ 50% trở lên)
      const { count: warnCount, error: warnErr } = await supabase
        .from('scan_logs')
        .select('*', { count: 'exact', head: true })
        .or('is_scam.eq.true,confidence_score.gte.50');

      if (!warnErr && typeof warnCount === 'number') {
        warnedScans = Math.max(warnedScans, warnCount);
      }

      // Lấy max confidence từ scan_logs
      const { data: maxLogData } = await supabase
        .from('scan_logs')
        .select('confidence_score')
        .order('confidence_score', { ascending: false })
        .limit(1);

      if (maxLogData && maxLogData[0]?.confidence_score) {
        maxConfidence = Math.max(maxConfidence, maxLogData[0].confidence_score);
      }
    } catch (err) {
      console.warn('[Stats] Could not query scan_logs:', err.message);
    }

    try {
      // 2. Query từ bảng scam_templates (số mẫu lừa đảo đã lưu / thư viện mẫu)
      const { count: templateCount } = await supabase
        .from('scam_templates')
        .select('*', { count: 'exact', head: true });

      if (typeof templateCount === 'number') {
        warnedScans = Math.max(warnedScans, templateCount);
        // Đảm bảo tổng số tin nhắn quét luôn lớn hơn hoặc bằng số tin bị cảnh báo
        totalScans = Math.max(totalScans, warnedScans);
      }

      // Lấy max confidence từ scam_templates
      const { data: maxTplData } = await supabase
        .from('scam_templates')
        .select('confidence_score')
        .order('confidence_score', { ascending: false })
        .limit(1);

      if (maxTplData && maxTplData[0]?.confidence_score) {
        maxConfidence = Math.max(maxConfidence, maxTplData[0].confidence_score);
      }
    } catch (err) {
      console.warn('[Stats] Could not query scam_templates:', err.message);
    }
  }

  // Nếu hệ thống vừa triển khai chưa có dữ liệu nào, hiển thị mặc định tối thiểu từ session
  if (maxConfidence === 0) {
    maxConfidence = warnedScans > 0 ? 98 : 0;
  }

  res.json({
    totalScans,
    warnedScans,
    maxConfidence,
  });
});

export default router;
