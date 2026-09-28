import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import templatesRoutes from '../routes/templates.js';

const approved = {
  id: 'a516dc7b-6f00-4297-b7b5-0ef6841e2a5b',
  title: 'Mẫu đã duyệt',
  platform: 'SMS',
  scam_type: 'Nghi vấn lừa đảo',
  analysis: 'Dữ liệu giả lập',
  confidence_score: 90,
  is_approved: true,
};
const pending = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Mẫu chưa duyệt',
  platform: 'SMS',
  scam_type: 'Nghi vấn lừa đảo',
  analysis: 'Gọi 0912345678 hoặc gửi thư tới fake@example.com để lấy mã OTP 123456.',
  confidence_score: 90,
  is_approved: false,
  messages_json: [{ sender: 'unknown', text: 'Mã xác thực 654321 gửi tới 0987654321' }],
};

test('public list and detail include both review states', async (context) => {
  const queries = [];
  const database = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    queries.push(url);
    assert.equal(url.pathname, '/rest/v1/scam_templates');

    if (url.searchParams.get('select')?.includes('confidence_score')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: '42703', message: 'column confidence_score does not exist' }));
      return;
    }

    const id = url.searchParams.get('id')?.replace(/^eq\./, '');
    const rows = [approved, pending].filter((item) => !id || item.id === id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Range', `0-${Math.max(0, rows.length - 1)}/${rows.length}`);
    res.end(JSON.stringify(rows));
  });
  database.listen(0, '127.0.0.1');
  await new Promise((resolve) => database.once('listening', resolve));

  process.env.SUPABASE_URL = `http://127.0.0.1:${database.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-fake-service-role-key';
  const app = express();
  app.use('/api/templates', templatesRoutes);
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => database.close(resolve));
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const list = await fetch(`${base}/api/templates?approved=false&limit=2`);
  assert.equal(list.status, 200);
  const body = await list.json();
  assert.deepEqual(body.data.map((item) => item.id), [approved.id, pending.id]);
  assert.deepEqual(body.data.map((item) => item.is_approved), [true, false]);
  assert.ok(!body.data[1].analysis.includes('0912345678'));
  assert.ok(!body.data[1].analysis.includes('fake@example.com'));
  assert.ok(!body.data[1].analysis.includes('123456'));

  const detail = await fetch(`${base}/api/templates/${pending.id}`);
  assert.equal(detail.status, 200);
  const detailBody = (await detail.json()).data;
  assert.equal(detailBody.is_approved, false);
  assert.ok(!JSON.stringify(detailBody).includes('0987654321'));
  assert.ok(!JSON.stringify(detailBody).includes('654321'));
  assert.ok(queries.every((url) => !url.searchParams.has('is_approved')));
  assert.ok(queries.some((url) => url.searchParams.get('select')?.includes('confidence_score')));
});
