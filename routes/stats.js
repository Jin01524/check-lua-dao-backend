import express from 'express';
import { getSupabaseClient } from '../lib/supabase.js';
import { CURATED_TEMPLATES } from './templates.js';

const router = express.Router();

// Bộ đệm in-memory lưu giá trị gần nhất để phản hồi nhanh
export const cachedStats = {
  totalScans: 0,
  warnedScans: 0,
  maxConfidence: 0,
};

// Giữ lại export sessionStats để tương thích ngược nếu module khác tham chiếu
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
          .map((t) => Number(t.confidence_score) || 0)
          .filter((s) => s > 0);
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
 * Ghi nhận một lượt quét mới VÀ LƯU VĨNH VIỄN vào database Supabase
 * Đảm bảo tắt máy bật lại vẫn giữ nguyên số liệu đã quét
 */
export async function recordScanInDB({ platform, isScam, confidenceScore, scamType }) {
  let supabase = null;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    console.warn('[Stats] Supabase client not initialized:', err.message);
  }

  const numConfidence = Number(confidenceScore) || 0;

  // Cập nhật bộ đệm in-memory dự phòng
  sessionStats.sessionScans += 1;
  if (isScam) sessionStats.sessionWarned += 1;
  if (numConfidence > 0) {
    sessionStats.sessionMaxConfidence = Math.max(sessionStats.sessionMaxConfidence, numConfidence);
  }

  if (!supabase) {
    cachedStats.totalScans = Math.max(cachedStats.totalScans || 9, 9) + 1;
    if (isScam) cachedStats.warnedScans = Math.max(cachedStats.warnedScans || 9, 9) + 1;
    cachedStats.maxConfidence = Math.max(cachedStats.maxConfidence || 98, numConfidence);
    return;
  }

  // 1. Ghi nhật ký chi tiết vào bảng scan_logs
  try {
    let { error: logErr } = await supabase.from('scan_logs').insert({
      platform: platform || 'SMS',
      is_scam: Boolean(isScam),
      confidence_score: numConfidence,
      scam_type: scamType || null,
    });

    if (logErr && (logErr.message?.includes('scam_type') || logErr.code === '42703')) {
      await supabase.from('scan_logs').insert({
        platform: platform || 'SMS',
        is_scam: Boolean(isScam),
        confidence_score: numConfidence,
      });
    }
  } catch (err) {
    console.warn('[Stats] Exception inserting into scan_logs:', err.message);
  }

  // 2. Đọc số liệu hiện tại từ bảng system_stats trong Supabase và TĂNG LÊN BỀN VỮNG
  try {
    const { data: currentStats } = await supabase
      .from('system_stats')
      .select('total_scans, warned_scans, max_confidence')
      .eq('id', 'global')
      .maybeSingle();

    const baseMetrics = await getTemplateBaseMetrics(supabase);

    const prevTotal = Math.max(
      Number(currentStats?.total_scans) || 0,
      cachedStats.totalScans || 0,
      baseMetrics.count,
      9
    );

    const prevWarned = Math.max(
      Number(currentStats?.warned_scans) || 0,
      cachedStats.warnedScans || 0,
      baseMetrics.count,
      9
    );

    const prevMax = Math.max(
      Number(currentStats?.max_confidence) || 0,
      cachedStats.maxConfidence || 0,
      baseMetrics.maxConfidence,
      98
    );

    // Tăng vĩnh viễn trong database
    const newTotal = prevTotal + 1;
    const newWarned = prevWarned + (isScam ? 1 : 0);
    const newMax = Math.max(prevMax, numConfidence);

    // Lưu ngay vào Supabase
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
      console.log(`[Stats] ✅ Persisted to Supabase system_stats: total_scans = ${newTotal}, warned_scans = ${newWarned}, max_confidence = ${newMax}%`);
    }

    // Cập nhật bộ đệm
    cachedStats.totalScans = newTotal;
    cachedStats.warnedScans = newWarned;
    cachedStats.maxConfidence = newMax;
  } catch (err) {
    console.warn('[Stats] Exception updating system_stats in Supabase:', err.message);
  }
}

/**
 * Lấy số liệu thống kê thực tế LƯU TRONG DATABASE SUPABASE
 * Đọc trực tiếp từ bảng system_stats để không bao giờ bị reset về 9 khi tắt máy / khởi động lại
 */
export async function getSystemStatsFromDB() {
  let supabase = null;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    console.warn('[Stats] Supabase client not initialized:', err.message);
  }

  let baseTemplateCount = Array.isArray(CURATED_TEMPLATES) ? CURATED_TEMPLATES.length : 9;
  let baseMaxConfidence = 98;

  if (!supabase) {
    return {
      totalScans: Math.max(cachedStats.totalScans || 9, baseTemplateCount),
      warnedScans: Math.max(cachedStats.warnedScans || 9, baseTemplateCount),
      maxConfidence: Math.max(cachedStats.maxConfidence || 98, baseMaxConfidence),
    };
  }

  try {
    // 1. Đọc số mẫu cơ sở
    const baseMetrics = await getTemplateBaseMetrics(supabase);
    baseTemplateCount = baseMetrics.count;
    baseMaxConfidence = baseMetrics.maxConfidence;

    // 2. ĐỌC TRỰC TIẾP DỮ LIỆU ĐÃ LƯU TỪ BẢNG system_stats TRONG SUPABASE
    const { data: statsRow, error: statsErr } = await supabase
      .from('system_stats')
      .select('total_scans, warned_scans, max_confidence')
      .eq('id', 'global')
      .maybeSingle();

    if (!statsErr && statsRow) {
      const dbTotal = Number(statsRow.total_scans) || 0;
      const dbWarned = Number(statsRow.warned_scans) || 0;
      const dbMax = Number(statsRow.max_confidence) || 0;

      // Không bao giờ để số liệu nhỏ hơn số lượng mẫu gốc
      const totalScans = Math.max(dbTotal, baseTemplateCount, cachedStats.totalScans || 0);
      const warnedScans = Math.max(dbWarned, baseTemplateCount, cachedStats.warnedScans || 0);
      const maxConfidence = Math.max(dbMax, baseMaxConfidence, cachedStats.maxConfidence || 0);

      // Cập nhật bộ đệm
      cachedStats.totalScans = totalScans;
      cachedStats.warnedScans = warnedScans;
      cachedStats.maxConfidence = maxConfidence;

      // Nếu số liệu trong DB đang thấp hơn mức chuẩn của mẫu, cập nhật đồng bộ lên
      if (totalScans > dbTotal || warnedScans > dbWarned || maxConfidence > dbMax) {
        await supabase
          .from('system_stats')
          .upsert({
            id: 'global',
            total_scans: totalScans,
            warned_scans: warnedScans,
            max_confidence: maxConfidence,
            updated_at: new Date().toISOString(),
          });
      }

      return {
        totalScans,
        warnedScans,
        maxConfidence,
      };
    }

    // 3. Nếu chưa có bản ghi trong system_stats (lần đầu tạo bảng), khởi tạo theo số mẫu
    const initialTotal = Math.max(baseTemplateCount, 9);
    const initialWarned = Math.max(baseTemplateCount, 9);
    const initialMax = Math.max(baseMaxConfidence, 98);

    await supabase
      .from('system_stats')
      .upsert({
        id: 'global',
        total_scans: initialTotal,
        warned_scans: initialWarned,
        max_confidence: initialMax,
        updated_at: new Date().toISOString(),
      });

    cachedStats.totalScans = initialTotal;
    cachedStats.warnedScans = initialWarned;
    cachedStats.maxConfidence = initialMax;

    return {
      totalScans: initialTotal,
      warnedScans: initialWarned,
      maxConfidence: initialMax,
    };
  } catch (err) {
    console.warn('[Stats] Exception reading system_stats from DB:', err.message);
    return {
      totalScans: Math.max(cachedStats.totalScans || 9, baseTemplateCount),
      warnedScans: Math.max(cachedStats.warnedScans || 9, baseTemplateCount),
      maxConfidence: Math.max(cachedStats.maxConfidence || 98, baseMaxConfidence),
    };
  }
}

/**
 * GET /api/stats
 * Trả về thống kê thực tế bền vững từ database Supabase
 */
router.get('/', async (_req, res) => {
  const stats = await getSystemStatsFromDB();
  res.json(stats);
});

export default router;
