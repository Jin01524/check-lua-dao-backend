import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedStats, isActiveScanSession, recordScanInDB, reviseScanInDB } from '../routes/stats.js';

test('follow-up revises one scan session and warned count instead of adding a scan', async () => {
  const before = { ...cachedStats };
  const scanId = await recordScanInDB({ platform: 'sms', isScam: false, confidenceScore: null });
  assert.equal(await isActiveScanSession(scanId), true);
  assert.equal(cachedStats.totalScans, before.totalScans + 1);
  await reviseScanInDB({ scanId, isScam: true, confidenceScore: 85, scamType: 'OTP' });
  assert.equal(cachedStats.totalScans, before.totalScans + 1);
  assert.equal(cachedStats.warnedScans, before.warnedScans + 1);
  await reviseScanInDB({ scanId, isScam: true, confidenceScore: 85, scamType: 'OTP' });
  assert.equal(cachedStats.warnedScans, before.warnedScans + 1);
});
