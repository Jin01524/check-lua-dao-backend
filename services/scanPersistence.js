import { recordScanInDB } from '../routes/stats.js';
import { saveScanTemplate } from './templateStorage.js';
import { riskScoreAssessment } from '../lib/contextFlow.js';

export function hasConclusiveAssessment(assessment) {
  return ['high_risk', 'low_risk'].includes(assessment?.status);
}

/** Inconclusive inputs never create a template, scan log or resumable session. */
export async function persistScanOutcome({ assessment, analysisResult, platform, supabase, signal }, {
  recordScan = recordScanInDB,
  saveTemplate = saveScanTemplate,
  logger = console,
} = {}) {
  signal?.throwIfAborted();
  if (!hasConclusiveAssessment(assessment)) {
    return { scanSessionId: null, templateSave: { id: null, status: 'deferred_insufficient_context' } };
  }
  const { conflictsWithVerdict } = riskScoreAssessment(analysisResult);
  const disagreement = assessment.status === 'high_risk' && !analysisResult.isScam;
  let templateSave = { id: null, status: 'database_error' };
  if (disagreement || conflictsWithVerdict) {
    templateSave.status = 'deferred_review';
  } else {
    try {
      templateSave = await saveTemplate({ supabase, analysisResult, platform, signal });
    } catch (error) {
      signal?.throwIfAborted();
      logger.warn('[Check] Could not save template:', error.message);
    }
  }
  let scanSessionId = null;
  signal?.throwIfAborted();
  try {
    scanSessionId = await recordScan({
      platform,
      isScam: assessment.status === 'high_risk',
      confidenceScore: assessment.riskScore,
      scamType: analysisResult.scamType || null,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    signal?.throwIfAborted();
    logger.warn('[Check] Could not record scan stats:', error.message);
  }
  signal?.throwIfAborted();
  return { scanSessionId, templateSave };
}
