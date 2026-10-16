import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { abortable, withScanCancellation } from '../lib/scanCancellation.js';
import { createOcrQueue } from '../services/ocrService.js';
import { persistScanOutcome } from '../services/scanPersistence.js';
import { analyzeContent } from '../services/geminiService.js';

const cancelled = () => new DOMException('Test scan cancelled', 'AbortError');
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

test('disconnect while awaiting analysis rejects pipeline before persistence', { timeout: 3000 }, async t => {
  const entered = deferred(), finished = deferred();
  let saved = false;
  const server = http.createServer((req, res) => {
    withScanCancellation(req, res, async signal => {
      entered.resolve();
      await abortable(new Promise(() => {}), signal);
      saved = true;
      res.end('unexpected');
    }).then(finished.resolve);
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = http.request(`http://127.0.0.1:${server.address().port}`, { method: 'POST' });
  request.on('error', () => {});
  request.end();
  await entered.promise;
  request.destroy();
  await finished.promise;
  assert.equal(saved, false);
});

test('normal response completion does not cancel and listeners are removed', async () => {
  const req = new EventEmitter(), res = new EventEmitter();
  let captured;
  await withScanCancellation(req, res, async signal => {
    captured = signal;
    res.writableEnded = true;
    res.emit('close');
    assert.equal(signal.aborted, false);
  });
  assert.equal(captured.aborted, false);
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
});

test('cancelling active OCR terminates its worker and next scan gets a fresh worker', async () => {
  const entered = deferred();
  let terminated = 0, workers = 0;
  const extract = createOcrQueue({ workerFactory: async () => {
    const first = ++workers === 1;
    return {
      recognize: async () => {
        if (first) { entered.resolve(); return new Promise(() => {}); }
        return { data: { text: 'Fresh scan' } };
      },
      terminate: async () => { terminated++; },
    };
  } });
  const controller = new AbortController();
  const first = extract([{ buffer: Buffer.from('first') }], { signal: controller.signal });
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await entered.promise;
  controller.abort(cancelled());
  await rejected;
  const text = await extract([{ buffer: Buffer.from('next') }]);
  assert.equal(text, 'Ảnh 1:\nFresh scan');
  assert.equal(terminated, 1);
  assert.equal(workers, 2);
});

test('cancelled queued OCR never recognizes its image or terminates another scan', async () => {
  const entered = deferred(), release = deferred();
  const recognized = [];
  let terminated = 0;
  const extract = createOcrQueue({ workerFactory: async () => ({
    recognize: async buffer => {
      recognized.push(buffer.toString());
      if (recognized.length === 1) { entered.resolve(); await release.promise; }
      return { data: { text: 'ok' } };
    },
    terminate: async () => { terminated++; },
  }) });
  const active = extract([{ buffer: Buffer.from('active') }]);
  await entered.promise;
  const controller = new AbortController();
  const queued = extract([{ buffer: Buffer.from('cancelled') }], { signal: controller.signal });
  const rejected = assert.rejects(queued, { name: 'AbortError' });
  controller.abort(cancelled());
  await rejected;
  release.resolve();
  await active;
  await extract([{ buffer: Buffer.from('next') }]);
  assert.deepEqual(recognized, ['active', 'next']);
  assert.equal(terminated, 0);
});

test('cancelled analysis never writes templates or statistics', async () => {
  const controller = new AbortController();
  controller.abort(cancelled());
  const writes = [];
  await assert.rejects(persistScanOutcome({
    assessment: { status: 'high_risk', riskScore: 90 },
    analysisResult: { isScam: true, confidenceScore: 90 },
    signal: controller.signal,
  }, {
    saveTemplate: async () => { writes.push('template'); },
    recordScan: async () => { writes.push('stats'); },
  }), { name: 'AbortError' });
  assert.deepEqual(writes, []);
});

test('cancellation during save does not continue into statistics', async () => {
  const controller = new AbortController();
  let recorded = false;
  await assert.rejects(persistScanOutcome({
    assessment: { status: 'high_risk', riskScore: 90 },
    analysisResult: { isScam: true, confidenceScore: 90 },
    signal: controller.signal,
  }, {
    saveTemplate: async () => { controller.abort(cancelled()); return { id: 'id', status: 'saved' }; },
    recordScan: async () => { recorded = true; },
  }), { name: 'AbortError' });
  assert.equal(recorded, false);
});

test('AI cancellation closes SDK request without model retry', { timeout: 3000 }, async t => {
  const originalFetch = globalThis.fetch;
  const entered = deferred();
  let attempts = 0;
  globalThis.fetch = async (_url, options) => {
    attempts++;
    entered.resolve();
    return abortable(new Promise(() => {}), options.signal);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const controller = new AbortController();
  const analysis = analyzeContent({ textContent: 'Synthetic conversation', apiKey: 'test-only', signal: controller.signal });
  const rejected = assert.rejects(analysis, { name: 'AbortError' });
  await entered.promise;
  controller.abort(cancelled());
  await rejected;
  assert.equal(attempts, 1);
});
