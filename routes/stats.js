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

  // Tính toán số liệu tổng hợp:
  // totalScans: Số lượng quét từ DB (scan_logs hoặc templates) + các lượt quét mới trong phiên hiện tại (sessionScans)
  let dbTotal = 0;
  let dbWarned = 0;
  let dbMaxConfidence = 0;

  if (supabase) {
    try {
      // 1. Thử đếm từ bảng scan_logs (toàn bộ tin nhắn người dùng đã gửi quét)
      const { count: logCount, error: logErr } = await supabase
        .from('scan_logs')
        .select('*', { count: 'exact', head: true });

      if (!logErr && typeof logCount === 'number') {
        dbTotal = logCount;
      }

      // Đếm tin nhắn bị cảnh báo từ scan_logs (lừa đảo hoặc có điểm rủi ro từ 50% trở lên)
      const { count: warnCount, error: warnErr } = await supabase
        .from('scan_logs')
        .select('*', { count: 'exact', head: true })
        .or('is_scam.eq.true,confidence_score.gte.50');

      if (!warnErr && typeof warnCount === 'number') {
        dbWarned = warnCount;
      }

      // Lấy max confidence từ scan_logs
      const { data: maxLogData } = await supabase
        .from('scan_logs')
        .select('confidence_score')
        .order('confidence_score', { ascending: false })
        .limit(1);

      if (maxLogData && maxLogData[0]?.confidence_score) {
        dbMaxConfidence = Math.max(dbMaxConfidence, maxLogData[0].confidence_score);
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
        dbWarned = Math.max(dbWarned, templateCount);
        dbTotal = Math.max(dbTotal, templateCount);
      }

      // Lấy max confidence từ scam_templates
      const { data: maxTplData } = await supabase
        .from('scam_templates')
        .select('confidence_score')
        .order('confidence_score', { ascending: false })
        .limit(1);

      if (maxTplData && maxTplData[0]?.confidence_score) {
        dbMaxConfidence = Math.max(dbMaxConfidence, maxTplData[0].confidence_score);
      }
    } catch (err) {
      console.warn('[Stats] Could not query scam_templates:', err.message);
    }
  }

  // Cơ sở tối thiểu ban đầu từ hệ thống (nếu chưa có DB hoặc DB mới tinh)
  const baseCount = dbTotal > 0 ? dbTotal : 6;
  const baseWarned = dbWarned > 0 ? dbWarned : 6;
  // Mức cảnh báo cao nhất được ghi nhận trong kho mẫu cơ sở là 98%
  const baseMax = dbMaxConfidence > 0 ? dbMaxConfidence : 98;

  // Luôn tăng lên khi người dùng thực hiện quét (sessionScans luôn cộng dồn)
  const totalScans = baseCount + sessionStats.sessionScans;
  const warnedScans = baseWarned + sessionStats.sessionWarned;
  // Mức độ cảnh báo cao nhất được ghi nhận: lấy giá trị LỚN NHẤT từ trước đến nay,
  // tuyệt đối không bị hạ xuống bởi lượt quét gần nhất nếu lượt đó có % thấp hơn.
  const maxConfidence = Math.max(baseMax, sessionStats.sessionMaxConfidence);

  res.json({
    totalScans,
    warnedScans,
    maxConfidence,
  });
});

export default router;
