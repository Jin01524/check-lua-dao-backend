import express from 'express';
import { getSupabaseClient } from '../lib/supabase.js';
import { CURATED_TEMPLATES } from './templates.js';

const router = express.Router();

// Bộ đếm in-memory dùng làm lớp đệm dự phòng nếu Supabase tạm thời mất kết nối
export const sessionStats = {
  sessionScans: 0,
  sessionWarned: 0,
  sessionMaxConfidence: 0,
};

export function getTemplateMessagesCount(templates) {
  return Array.isArray(templates) ? templates.length : 9;
}

/**
 * Lấy số lượng mẫu tin nhắn lừa đảo và điểm cảnh báo cao nhất từ thư viện mẫu
 */
export async function getTemplateBaseMetrics(supabase) {
  let count = Array.isArray(CURATED_TEMPLATES) ? CURATED_TEMPLATES.length : 9;
  let maxConfidence = 98;

  if (!supabase) {
    return { count, maxConfidence };
  }

  try {
    const { data, count: exactCount, error } = await supabase
      .from('scam_templates')
      .select('confidence_score', { count: 'exact' })
      .eq('is_approved', true);

    if (!error) {
      if (typeof exactCount === 'number') {
        count = exactCount;
      } else if (Array.isArray(data)) {
        count = data.length;
      }

      if (Array.isArray(data) && data.length > 0) {
        const scores = data
          .map(t => Number(t.confidence_score) || 0)
          .filter(s => s > 0);
        if (scores.length > 0) {
          maxConfidence = Math.max(...scores);
        }
      } else if (count === 0) {
        maxConfidence = 0;
      }
    }
  } catch (err) {
    console.warn('[Stats] Could not query scam_templates metrics:', err.message);
  }

  return { count, maxConfidence };
}

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

  // 1. Luôn cập nhật memory counter dự phòng
  sessionStats.sessionScans += 1;
  if (isScam) {
    sessionStats.sessionWarned += 1;
  }
  const numConfidence = Number(confidenceScore) || 0;
  if (numConfidence > 0) {
    sessionStats.sessionMaxConfidence = Math.max(
      sessionStats.sessionMaxConfidence,
      numConfidence
    );
  }

  if (!supabase) return;

  // 2. Ghi nhận vào bảng scan_logs (nhật ký từng lượt quét trong Supabase)
  try {
    let { error: logErr } = await supabase.from('scan_logs').insert({
      platform: platform || 'SMS',
      is_scam: Boolean(isScam),
      confidence_score: numConfidence,
      scam_type: scamType || null,
    });

    if (logErr && (logErr.message?.includes('scam_type') || logErr.code === '42703')) {
      const retryResult = await supabase.from('scan_logs').insert({
        platform: platform || 'SMS',
        is_scam: Boolean(isScam),
        confidence_score: numConfidence,
      });
      logErr = retryResult.error;
    }

    if (logErr) {
      console.warn('[Stats] Could not insert into scan_logs in Supabase:', logErr.message);
    } else {
      console.log('[Stats] ✅ Saved scan record into Supabase scan_logs');
    }
  } catch (err) {
    console.warn('[Stats] Exception inserting into scan_logs:', err.message);
  }

  // 3. Cập nhật bảng tổng hợp system_stats trong Supabase
  try {
    const { count: logCount } = await supabase
      .from('scan_logs')
      .select('*', { count: 'exact', head: true });

    const { count: warnLogCount } = await supabase
      .from('scan_logs')
      .select('*', { count: 'exact', head: true })
      .or('is_scam.eq.true,confidence_score.gte.50');

    const { data: maxLogData } = await supabase
      .from('scan_logs')
      .select('confidence_score')
      .order('confidence_score', { ascending: false })
      .limit(1);

    const userLogMax = (maxLogData && maxLogData[0]?.confidence_score) ? Number(maxLogData[0].confidence_score) : 0;

    const { count: baseCount, maxConfidence: baseMax } = await getTemplateBaseMetrics(supabase);

    const additionalScans = Math.max(typeof logCount === 'number' ? logCount : 0, sessionStats.sessionScans);
    const additionalWarned = Math.max(typeof warnLogCount === 'number' ? warnLogCount : 0, sessionStats.sessionWarned);
    const userMax = Math.max(userLogMax, sessionStats.sessionMaxConfidence);

    const newTotal = baseCount + additionalScans;
    const newWarned = baseCount + additionalWarned;
    const newMax = Math.max(baseMax, userMax, numConfidence);

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
 * Lấy số liệu thống kê thực tế đồng nhất giữa hệ thống và thư viện mẫu
 */
export async function getSystemStatsFromDB() {
  let supabase = null;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    console.warn('[Stats] Supabase client not initialized:', err.message);
  }

  let actualLogCount = 0;
  let actualWarnCount = 0;
  let logMaxConfidence = 0;
  let baseTemplateCount = Array.isArray(CURATED_TEMPLATES) ? CURATED_TEMPLATES.length : 9;
  let baseMaxConfidence = 98;

  if (supabase) {
    // 1. Đọc số liệu từ scam_templates (dữ liệu gốc)
    const baseMetrics = await getTemplateBaseMetrics(supabase);
    baseTemplateCount = baseMetrics.count;
    baseMaxConfidence = baseMetrics.maxConfidence;

    // 2. Đọc từ scan_logs
    try {
      const { count: logCount, error: logErr } = await supabase
        .from('scan_logs')
        .select('*', { count: 'exact', head: true });

      if (!logErr && typeof logCount === 'number') {
        actualLogCount = logCount;
      }

      const { count: warnCount, error: warnErr } = await supabase
        .from('scan_logs')
        .select('*', { count: 'exact', head: true })
        .or('is_scam.eq.true,confidence_score.gte.50');

      if (!warnErr && typeof warnCount === 'number') {
        actualWarnCount = warnCount;
      }

      const { data: maxLogData } = await supabase
        .from('scan_logs')
        .select('confidence_score')
        .order('confidence_score', { ascending: false })
        .limit(1);

      if (maxLogData && maxLogData[0]?.confidence_score) {
        logMaxConfidence = Number(maxLogData[0].confidence_score) || 0;
      }
    } catch (err) {
      console.warn('[Stats] Could not query scan_logs:', err.message);
    }
  }

  // Số lượng quét tăng thêm từ người dùng
  const additionalScans = Math.max(actualLogCount, sessionStats.sessionScans);
  const additionalWarned = Math.max(actualWarnCount, sessionStats.sessionWarned);
  const userMax = Math.max(logMaxConfidence, sessionStats.sessionMaxConfidence);

  // Tổng số tin nhắn đã quét và được cảnh báo (đồng bộ chính xác theo số mẫu lừa đảo gốc + lượt quét thực tế)
  const totalScans = baseTemplateCount + additionalScans;
  const warnedScans = baseTemplateCount + additionalWarned;
  const maxConfidence = Math.max(baseMaxConfidence, userMax);

  // Tự động đồng bộ lên Supabase system_stats nếu đang kết nối
  if (supabase) {
    supabase
      .from('system_stats')
      .upsert({
        id: 'global',
        total_scans: totalScans,
        warned_scans: warnedScans,
        max_confidence: maxConfidence,
        updated_at: new Date().toISOString(),
      })
      .then(() => {})
      .catch((e) => console.warn('[Stats] Async system_stats upsert warning:', e.message));
  }

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
