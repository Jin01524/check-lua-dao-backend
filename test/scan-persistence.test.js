import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hasConclusiveAssessment, persistScanOutcome } from '../services/scanPersistence.js';

test('inconclusive inputs create no template, log or pending-session identifier', async () => {
  const writes = [];
  const dependencies = {
    recordScan: async () => { writes.push('log'); },
    saveTemplate: async () => { writes.push('template'); },
  };
  for (const status of ['insufficient_context', 'invalid_input']) {
    const assessment = { status, riskScore: null };
    assert.equal(hasConclusiveAssessment(assessment), false);
    const outcome = await persistScanOutcome({
      assessment, analysisResult: { isScam: false, confidenceScore: 95 }, platform: 'SMS',
    }, dependencies);
    assert.deepEqual(outcome, {
      scanSessionId: null,
      templateSave: { id: null, status: 'deferred_insufficient_context' },
    });
  }
  assert.deepEqual(writes, []);
});

test('each conclusive request creates a separate scan and complete template', async () => {
  const logs = [], templates = [];
  const dependencies = {
    recordScan: async row => { logs.push(row); return randomUUID(); },
    saveTemplate: async row => { templates.push(row); return { id: 'template', status: 'saved' }; },
  };
  const input = {
    assessment: { status: 'high_risk', riskScore: 85 },
    analysisResult: { isScam: true, confidenceScore: 85, scamType: 'OTP' },
    platform: 'SMS',
  };
  const first = await persistScanOutcome(input, dependencies);
  const second = await persistScanOutcome(input, dependencies);
  assert.equal(hasConclusiveAssessment(input.assessment), true);
  assert.notEqual(first.scanSessionId, second.scanSessionId);
  assert.equal(logs.length, 2);
  assert.equal(templates.length, 2);
  assert.equal(logs[0].confidenceScore, 85);
  assert.equal('scanId' in logs[0], false);
});
