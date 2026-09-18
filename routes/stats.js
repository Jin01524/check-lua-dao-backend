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

/**
 * Đếm tổng số lượng tin nhắn thực tế nằm trong các mẫu tin nhắn (messages_json)
 */
export function getTemplateMessagesCount(templates) {
  const source = Array.isArray(templates) && templates.length > 0 ? templates : CURATED_TEMPLATES;
  return source.reduce((sum, t) => {
    if (!t) return sum;
    let msgs = t.messages_json;
    if (typeof msgs === 'string') {
      try {
        msgs = JSON.parse(msgs);
      } catch (_) {
        msgs = [];
      }
    }
    return sum + (Array.isArray(msgs) && msgs.length > 0 ? msgs.length : 1);
  }, 0);
}

const DEFAULT_BASE_COUNT = getTemplateMessagesCount(CURATED_TEMPLATES); // 16 tin nhắn mẫu
const BASE_MAX = 98;

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
  let scanLogInserted = false;
  try {
    let { error: logErr } = await supabase.from('scan_logs').insert({
      platform: platform || 'SMS',
      is_scam: Boolean(isScam),
      confidence_score: numConfidence,
      scam_type: scamType || null,
    });

    // Fallback: nếu Supabase chưa có cột scam_type
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
      scanLogInserted = true;
      console.log('[Stats] ✅ Saved scan record into Supabase scan_logs');
    }
  } catch (err) {
    console.warn('[Stats] Exception inserting into scan_logs:', err.message);
  }

  // 3. Cập nhật bảng tổng hợp system_stats trong Supabase
  try {
    // Đọc số liệu hiện tại từ system_stats
    const { data: currentStats } = await supabase
      .from('system_stats')
      .select('*')
      .eq('id', 'global')
      .maybeSingle();

    // Đếm số lượng log thực tế từ scan_logs
    const { count: logCount } = await supabase
      .from('scan_logs')
      .select('*', { count: 'exact', head: true });

    // Đếm số lượng log bị cảnh báo
    const { count: warnLogCount } = await supabase
      .from('scan_logs')
      .select('*', { count: 'exact', head: true })
      .or('is_scam.eq.true,confidence_score.gte.50');

    const actualLogs = typeof logCount === 'number' ? logCount : (scanLogInserted ? 1 : 0);
    const actualWarnLogs = typeof warnLogCount === 'number' ? warnLogCount : (isScam ? 1 : 0);

    // Lấy tổng số tin nhắn thực tế nằm trong các mẫu tin nhắn (messages_json)
    let baseTemplateMessages = 0;
    try {
      const { data: tplData, error: tplErr } = await supabase
        .from('scam_templates')
        .select('messages_json');
      if (!tplErr && Array.isArray(tplData)) {
        baseTemplateMessages = getTemplateMessagesCount(tplData);
      }
    } catch (_) {}

    // Mức cơ sở ban đầu từ tổng số tin nhắn mẫu
    let currentTotal = baseTemplateMessages;
    let currentWarned = baseTemplateMessages;
    let currentMax = 0;

    if (currentStats) {
      currentTotal = Number(currentStats.total_scans) || 0;
      currentWarned = Number(currentStats.warned_scans) || 0;
      currentMax = Number(currentStats.max_confidence) || 0;
    } else {
      currentTotal = baseTemplateMessages + Math.max(0, actualLogs - 1);
      currentWarned = baseTemplateMessages + Math.max(0, actualWarnLogs - (isScam ? 1 : 0));
    }

    // Tăng chính xác +1 lượt quét mới
    const newTotal = currentTotal + 1;
    const newWarned = currentWarned + (isScam ? 1 : 0);
    const newMax = Math.max(currentMax, numConfidence);

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
  let hasSystemStatsRow = false;
  let actualLogCount = 0;
  let actualWarnCount = 0;
  let baseTemplateMessages = DEFAULT_BASE_COUNT;

  if (supabase) {
    // 1. Đọc từ bảng system_stats
    try {
      const { data: statsRow, error: statsErr } = await supabase
        .from('system_stats')
        .select('*')
        .eq('id', 'global')
        .maybeSingle();

      if (!statsErr && statsRow) {
        hasSystemStatsRow = true;
        dbTotal = Number(statsRow.total_scans) || 0;
        dbWarned = Number(statsRow.warned_scans) || 0;
        dbMaxConfidence = Number(statsRow.max_confidence) || 0;
      }
    } catch (err) {
      console.warn('[Stats] Could not query system_stats:', err.message);
    }

    // 2. Đọc từ scan_logs
    try {
      const { count: logCount, error: logErr } = await supabase
        .from('scan_logs')
        .select('*', { count: 'exact', head: true });

      if (!logErr && typeof logCount === 'number') {
        actualLogCount = logCount;
      }

      // Đếm tin nhắn cảnh báo trong scan_logs (lừa đảo hoặc điểm rủi ro >= 50%)
      const { count: warnCount, error: warnErr } = await supabase
        .from('scan_logs')
        .select('*', { count: 'exact', head: true })
        .or('is_scam.eq.true,confidence_score.gte.50');

      if (!warnErr && typeof warnCount === 'number') {
        actualWarnCount = warnCount;
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

    // 3. Đọc từ scam_templates để lấy tổng số tin nhắn thực tế nằm trong các mẫu
    try {
      const { data: tplData, error: tplErr } = await supabase
        .from('scam_templates')
        .select('messages_json');

      if (!tplErr && Array.isArray(tplData)) {
        baseTemplateMessages = getTemplateMessagesCount(tplData);
      }
    } catch (err) {
      console.warn('[Stats] Could not query scam_templates messages:', err.message);
    }
  }

  // Số lượng quét tăng thêm thực tế: lấy giá trị lớn nhất giữa số log trong DB và số lượt quét trong session
  const additionalScans = Math.max(actualLogCount, sessionStats.sessionScans);
  const additionalWarned = Math.max(actualWarnCount, sessionStats.sessionWarned);

  // Tổng số tin nhắn đã quét và được cảnh báo
  const totalScans = hasSystemStatsRow
    ? Math.max(dbTotal, baseTemplateMessages + additionalScans)
    : (baseTemplateMessages + additionalScans);

  const warnedScans = hasSystemStatsRow
    ? Math.max(dbWarned, baseTemplateMessages + additionalWarned)
    : (baseTemplateMessages + additionalWarned);

  const maxConfidence = Math.max(dbMaxConfidence, sessionStats.sessionMaxConfidence);

  // Nếu bảng system_stats đã tồn tại trong Supabase mà số liệu đang thấp hơn số liệu tính toán, tự động đồng bộ lên
  if (hasSystemStatsRow && (totalScans > dbTotal || warnedScans > dbWarned || maxConfidence > dbMaxConfidence)) {
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
      .catch(() => {});
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
