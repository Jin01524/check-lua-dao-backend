import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedStats, createPendingScanSession, isActiveScanSession, recordScanInDB, reviseScanInDB } from '../routes/stats.js';

test('pending scan stays out of statistics until a verdict is available', async () => {
  const before = { ...cachedStats };
  const scanId = createPendingScanSession();
  assert.equal(await isActiveScanSession(scanId), true);
  assert.equal(cachedStats.totalScans, before.totalScans);
  await reviseScanInDB({ scanId, platform: 'sms', isScam: true, confidenceScore: 85, scamType: 'OTP' });
  assert.equal(cachedStats.totalScans, before.totalScans + 1);
  assert.equal(cachedStats.warnedScans, before.warnedScans + 1);
  await reviseScanInDB({ scanId, platform: 'sms', isScam: true, confidenceScore: 85, scamType: 'OTP' });
  assert.equal(cachedStats.totalScans, before.totalScans + 1);
  assert.equal(cachedStats.warnedScans, before.warnedScans + 1);
});

test('signed pending session survives a backend restart without a database row', async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-only-pending-session-secret';
  try {
    const before = { ...cachedStats };
    const token = createPendingScanSession();
    assert.equal(token.split('.').length, 3);
    const restarted = await import(`../routes/stats.js?restart=${Date.now()}`);
    assert.equal(await restarted.isActiveScanSession(token), true);
    const altered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    assert.equal(await restarted.isActiveScanSession(altered), false);
    assert.equal(cachedStats.totalScans, before.totalScans);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

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
