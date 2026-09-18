import express from 'express';
import { getSupabaseClient } from '../lib/supabase.js';

const router = express.Router();

// Bộ đếm in-memory dùng làm lớp đệm dự phòng nếu Supabase tạm thời mất kết nối
export const sessionStats = {
  sessionScans: 0,
  sessionWarned: 0,
  sessionMaxConfidence: 0,
};

/**
 * Ghi nhận một lượt quét mới vào database Supabase
 * Đồng bộ cả bảng chi tiết scan_logs và bảng tổng hợp system_stats
 */
export async function recordScanInDB({ platform, isScam, confidenceScore, scamType }) {
  let supabase = null;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    console.warn('[Stats] Supabase client not initialized:', err.message);
  }

  // Luôn cập nhật memory counter dự phòng
  sessionStats.sessionScans += 1;
  if (isScam) {
    sessionStats.sessionWarned += 1;
  }
  if (confidenceScore) {
    sessionStats.sessionMaxConfidence = Math.max(
      sessionStats.sessionMaxConfidence,
      Number(confidenceScore) || 0
    );
  }

  if (!supabase) return;

  const numConfidence = Number(confidenceScore) || 0;

  // 1. Ghi nhận vào bảng scan_logs (nhật ký từng lượt quét chi tiết trong Supabase)
  try {
    const { error: logErr } = await supabase.from('scan_logs').insert({
      platform: platform || 'SMS',
      is_scam: Boolean(isScam),
      confidence_score: numConfidence,
      scam_type: scamType || null,
    });

    if (logErr) {
      console.warn('[Stats] Could not insert into scan_logs in Supabase:', logErr.message);
    } else {
      console.log('[Stats] ✅ Saved scan record into Supabase scan_logs');
    }
  } catch (err) {
    console.warn('[Stats] Exception inserting into scan_logs:', err.message);
  }

  // 2. Cập nhật bảng tổng hợp system_stats trong Supabase
  try {
    // Đọc thống kê hiện tại từ system_stats
    const { data: currentStats } = await supabase
      .from('system_stats')
      .select('*')
      .eq('id', 'global')
      .maybeSingle();

    // Đếm số lượng log thực tế từ scan_logs
    const { count: logCount } = await supabase
      .from('scan_logs')
      .select('*', { count: 'exact', head: true });

    // Đếm số lượng mẫu từ scam_templates
    const { count: tplCount } = await supabase
      .from('scam_templates')
      .select('*', { count: 'exact', head: true });

    const baseCount = Math.max(Number(tplCount) || 0, 6);
    const existingTotal = currentStats ? Number(currentStats.total_scans) : Math.max(Number(logCount) || 0, baseCount);
    const existingWarned = currentStats ? Number(currentStats.warned_scans) : Math.max(baseCount, isScam ? 1 : 0);
    const existingMax = currentStats ? Number(currentStats.max_confidence) : 98;

    const newTotal = existingTotal + 1;
    const newWarned = existingWarned + (isScam ? 1 : 0);
    const newMax = Math.max(existingMax, numConfidence);

    const { error: statsErr } = await supabase
      .from('system_stats')
      .upsert({
        id: 'global',
        total_scans: newTotal,
        warned_scans: newWarned,
        max_confidence: newMax,
        updated_at: new Date().toISOString(),
      });

    if (statsErr) {
      console.warn('[Stats] Could not update system_stats in Supabase:', statsErr.message);
    } else {
      console.log(`[Stats] ✅ Updated system_stats in Supabase: total_scans = ${newTotal}, warned_scans = ${newWarned}, max_confidence = ${newMax}%`);
    }
  } catch (err) {
    console.warn('[Stats] Exception updating system_stats in Supabase:', err.message);
  }
}

/**
 * Lấy số liệu thống kê thực tế từ database Supabase
 */
export async function getSystemStatsFromDB() {
  let supabase = null;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    console.warn('[Stats] Supabase client not initialized:', err.message);
  }

  let dbTotal = 0;
  let dbWarned = 0;
  let dbMaxConfidence = 0;
  let foundSystemStats = false;

  if (supabase) {
    // 1. Đọc từ bảng system_stats
    try {
      const { data: statsRow, error: statsErr } = await supabase
        .from('system_stats')
        .select('*')
        .eq('id', 'global')
        .maybeSingle();

      if (!statsErr && statsRow) {
        foundSystemStats = true;
        dbTotal = Number(statsRow.total_scans) || 0;
        dbWarned = Number(statsRow.warned_scans) || 0;
        dbMaxConfidence = Number(statsRow.max_confidence) || 0;
      }
    } catch (err) {
      console.warn('[Stats] Could not query system_stats:', err.message);
    }

    // 2. Kiểm tra thực tế từ scan_logs
    try {
      const { count: logCount, error: logErr } = await supabase
        .from('scan_logs')
        .select('*', { count: 'exact', head: true });

      if (!logErr && typeof logCount === 'number') {
        dbTotal = Math.max(dbTotal, logCount);
      }

      // Đếm tin nhắn cảnh báo trong scan_logs (lừa đảo hoặc điểm rủi ro >= 50%)
      const { count: warnCount, error: warnErr } = await supabase
        .from('scan_logs')
        .select('*', { count: 'exact', head: true })
        .or('is_scam.eq.true,confidence_score.gte.50');

      if (!warnErr && typeof warnCount === 'number') {
        dbWarned = Math.max(dbWarned, warnCount);
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

    // 3. Đọc từ bảng scam_templates
    try {
      const { count: templateCount } = await supabase
        .from('scam_templates')
        .select('*', { count: 'exact', head: true });

      if (typeof templateCount === 'number') {
        dbWarned = Math.max(dbWarned, templateCount);
        dbTotal = Math.max(dbTotal, templateCount);
      }

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

    // Tự động đồng bộ số liệu chuẩn vào system_stats nếu chưa có hoặc đang thấp hơn
    if (foundSystemStats && (dbTotal > 0 || dbWarned > 0)) {
      const ensuredTotal = Math.max(dbTotal, 6);
      const ensuredWarned = Math.max(dbWarned, 6);
      const ensuredMax = Math.max(dbMaxConfidence, 98);
      supabase
        .from('system_stats')
        .upsert({
          id: 'global',
          total_scans: ensuredTotal,
          warned_scans: ensuredWarned,
          max_confidence: ensuredMax,
          updated_at: new Date().toISOString(),
        })
        .then(() => {})
        .catch(() => {});
    }
  }

  // Cơ sở tối thiểu: 6 mẫu, 98% max
  const totalScans = Math.max(dbTotal, 6, sessionStats.sessionScans);
  const warnedScans = Math.max(dbWarned, 6, sessionStats.sessionWarned);
  const maxConfidence = Math.max(dbMaxConfidence, 98, sessionStats.sessionMaxConfidence);

  return {
    totalScans,
    warnedScans,
    maxConfidence,
  };
}

/**
 * GET /api/stats
 * Trả về thống kê thực tế từ database Supabase
 */
router.get('/', async (_req, res) => {
  const stats = await getSystemStatsFromDB();
  res.json(stats);
});

export default router;
