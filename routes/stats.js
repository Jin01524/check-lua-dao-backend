import express from 'express';
import { getSupabaseClient } from '../lib/supabase.js';

const router = express.Router();

// These values are only a temporary fallback when the database is unavailable.
export const cachedStats = { totalScans: 0, warnedScans: 0, maxConfidence: 0 };
export const sessionStats = { sessionScans: 0, sessionWarned: 0, sessionMaxConfidence: 0 };

/** Record metadata only. Raw text and images are never written to scan_logs. */
export async function recordScanInDB({ platform, isScam, confidenceScore, scamType }) {
  const score = Number(confidenceScore) || 0;
  sessionStats.sessionScans += 1;
  if (isScam) sessionStats.sessionWarned += 1;
  sessionStats.sessionMaxConfidence = Math.max(sessionStats.sessionMaxConfidence, score);
  cachedStats.totalScans += 1;
  if (isScam) cachedStats.warnedScans += 1;
  cachedStats.maxConfidence = Math.max(cachedStats.maxConfidence, score);

  try {
    const { error } = await getSupabaseClient().from('scan_logs').insert({
      platform: platform || 'SMS',
      is_scam: Boolean(isScam),
      confidence_score: score,
      scam_type: scamType || null,
    });
    if (error) console.warn('[Stats] Could not insert scan log:', error.message);
  } catch (error) {
    console.warn('[Stats] Scan log unavailable:', error.message);
  }
}

/** Read real scan logs; never derive scan counts from curated templates. */
export async function getSystemStatsFromDB() {
  try {
    const supabase = getSupabaseClient();
    const [total, warned, highest] = await Promise.all([
      supabase.from('scan_logs').select('id', { count: 'exact', head: true }),
      supabase.from('scan_logs').select('id', { count: 'exact', head: true }).eq('is_scam', true),
      supabase.from('scan_logs').select('confidence_score').order('confidence_score', { ascending: false }).limit(1),
    ]);
    if (total.error || warned.error || highest.error) {
      throw total.error || warned.error || highest.error;
    }
    cachedStats.totalScans = total.count ?? 0;
    cachedStats.warnedScans = warned.count ?? 0;
    cachedStats.maxConfidence = Number(highest.data?.[0]?.confidence_score) || 0;
  } catch (error) {
    console.warn('[Stats] Could not read scan logs:', error.message);
  }
  return { ...cachedStats };
}

router.get('/', async (_req, res) => {
  res.json(await getSystemStatsFromDB());
});

export default router;
