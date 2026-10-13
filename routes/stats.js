import express from 'express';
import { getSupabaseClient } from '../lib/supabase.js';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const router = express.Router();

// These values are only a temporary fallback when the database is unavailable.
export const cachedStats = { totalScans: 0, warnedScans: 0, maxConfidence: 0 };
export const sessionStats = { sessionScans: 0, sessionWarned: 0, sessionMaxConfidence: 0 };
const scanIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const localScanSessions = new Map();
const SESSION_TTL_MS = 60 * 60 * 1000;

function pendingSessionSecret() {
  return process.env.JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function pendingSessionId(scanId) {
  const secret = pendingSessionSecret();
  if (!secret) return scanId;
  const payload = `${scanId}.${Date.now().toString(36)}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function verifiedPendingScanId(value) {
  const secret = pendingSessionSecret();
  if (!secret) return null;
  const match = /^([0-9a-f-]{36})\.([0-9a-z]+)\.([0-9a-f]{64})$/i.exec(value || '');
  if (!match || !scanIdPattern.test(match[1])) return null;
  const createdAt = Number.parseInt(match[2], 36);
  const age = Date.now() - createdAt;
  if (!Number.isSafeInteger(createdAt) || age < 0 || age > SESSION_TTL_MS) return null;
  const payload = `${match[1]}.${match[2]}`;
  const expected = createHmac('sha256', secret).update(payload).digest();
  return timingSafeEqual(Buffer.from(match[3], 'hex'), expected) ? match[1] : null;
}

function rememberSession(scanId, { isScam = false, pending = false } = {}) {
  const now = Date.now();
  localScanSessions.set(scanId, { createdAt: now, isScam: Boolean(isScam), pending });
  for (const [id, session] of localScanSessions) {
    if (now - session.createdAt > SESSION_TTL_MS) localScanSessions.delete(id);
  }
}

/** Keep an inconclusive scan in memory until a later reply produces a verdict. */
export function createPendingScanSession() {
  const scanId = randomUUID();
  rememberSession(scanId, { pending: true });
  return pendingSessionId(scanId);
}

export async function isActiveScanSession(scanId) {
  if (verifiedPendingScanId(scanId)) return true;
  if (!scanIdPattern.test(scanId || '')) return false;
  const local = localScanSessions.get(scanId);
  if (local && Date.now() - local.createdAt <= SESSION_TTL_MS) return true;
  if (local) localScanSessions.delete(scanId);
  try {
    const { data, error } = await getSupabaseClient().from('scan_logs')
      .select('id, created_at').eq('id', scanId).maybeSingle();
    return !error && Boolean(data) && Number.isFinite(Date.parse(data.created_at))
      && Date.now() - Date.parse(data.created_at) <= 60 * 60 * 1000;
  } catch (_) {
    return false;
  }
}

/** Record metadata only. Raw text and images are never written to scan_logs. */
export async function recordScanInDB({ platform, isScam, confidenceScore, scamType, scanId = randomUUID() }) {
  const score = Number(confidenceScore) || 0;
  rememberSession(scanId, { isScam });
  sessionStats.sessionScans += 1;
  if (isScam) sessionStats.sessionWarned += 1;
  sessionStats.sessionMaxConfidence = Math.max(sessionStats.sessionMaxConfidence, score);
  cachedStats.totalScans += 1;
  if (isScam) cachedStats.warnedScans += 1;
  cachedStats.maxConfidence = Math.max(cachedStats.maxConfidence, score);

  try {
    const { error } = await getSupabaseClient().from('scan_logs').insert({
      id: scanId,
      platform: platform || 'SMS',
      is_scam: Boolean(isScam),
      confidence_score: score,
      scam_type: scamType || null,
    });
    if (error) console.warn('[Stats] Could not insert scan log:', error.message);
  } catch (error) {
    console.warn('[Stats] Scan log unavailable:', error.message);
  }
  return scanId;
}

/** A follow-up updates the original scan; it is not a second user scan. */
export async function reviseScanInDB({ scanId, platform, isScam, confidenceScore, scamType }) {
  const signedScanId = verifiedPendingScanId(scanId);
  const resolvedScanId = signedScanId || scanId;
  if (!scanIdPattern.test(resolvedScanId || '')) {
    return false;
  }
  const local = localScanSessions.get(resolvedScanId);
  if (local && Date.now() - local.createdAt <= SESSION_TTL_MS) {
    if (local.pending) {
      await recordScanInDB({ scanId: resolvedScanId, platform, isScam, confidenceScore, scamType });
      return true;
    }
    const delta = Number(Boolean(isScam)) - Number(local.isScam);
    local.isScam = Boolean(isScam);
    sessionStats.sessionWarned += delta;
    cachedStats.warnedScans += delta;
    try {
      await getSupabaseClient().from('scan_logs').update({
        is_scam: Boolean(isScam),
        confidence_score: Number(confidenceScore) || 0,
        scam_type: scamType || null,
      }).eq('id', resolvedScanId);
    } catch (error) {
      console.warn('[Stats] Could not revise scan log:', error.message);
    }
    return true;
  }
  try {
    const db = getSupabaseClient();
    const { data: old, error: readError } = await db.from('scan_logs')
      .select('id, is_scam, created_at').eq('id', resolvedScanId).maybeSingle();
    if (readError) return false;
    if (!old && signedScanId) {
      await recordScanInDB({ scanId: resolvedScanId, platform, isScam, confidenceScore, scamType });
      return true;
    }
    if (!old || Date.now() - Date.parse(old.created_at) > SESSION_TTL_MS) return false;
    const { error } = await db.from('scan_logs').update({
      is_scam: Boolean(isScam),
      confidence_score: Number(confidenceScore) || 0,
      scam_type: scamType || null,
    }).eq('id', resolvedScanId);
    if (error) return false;
    const delta = Number(Boolean(isScam)) - Number(Boolean(old.is_scam));
    sessionStats.sessionWarned += delta;
    cachedStats.warnedScans += delta;
    return true;
  } catch (error) {
    console.warn('[Stats] Could not revise scan log:', error.message);
    return false;
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
