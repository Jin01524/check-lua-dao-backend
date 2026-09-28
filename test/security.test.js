import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import authRoutes from '../routes/auth.js';
import adminRoutes from '../routes/admin.js';
import templatesRoutes, { getConsistentScore } from '../routes/templates.js';

const originalEnv = {
  jwt: process.env.JWT_SECRET,
  username: process.env.ADMIN_USERNAME,
  hash: process.env.ADMIN_PASSWORD_HASH,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

test('login, admin roles and public templates', async (context) => {
  process.env.JWT_SECRET = 'security-test-secret-not-for-production';
  process.env.ADMIN_USERNAME = 'test-admin';
  process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash('strong-test-password', 4);
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/templates', templatesRoutes);
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const [name, value] of Object.entries({
      JWT_SECRET: originalEnv.jwt,
      ADMIN_USERNAME: originalEnv.username,
      ADMIN_PASSWORD_HASH: originalEnv.hash,
      SUPABASE_URL: originalEnv.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: originalEnv.supabaseKey,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const login = (password) => fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'test-admin', password }),
  });
  assert.equal((await login('123456')).status, 401);
  assert.equal((await login('strong-test-password')).status, 200);

  const userToken = jwt.sign({ username: 'guest', role: 'user' }, process.env.JWT_SECRET);
  const adminToken = jwt.sign({ username: 'test-admin', role: 'admin' }, process.env.JWT_SECRET);
  assert.equal((await fetch(`${base}/api/admin/active-model`, { headers: { authorization: `Bearer ${userToken}` } })).status, 403);
  assert.equal((await fetch(`${base}/api/admin/active-model`, { headers: { authorization: `Bearer ${adminToken}` } })).status, 200);

  const templates = await fetch(`${base}/api/templates?approved=false&limit=3`);
  assert.equal(templates.status, 200);
  const body = await templates.json();
  assert.ok(body.data.length <= 3);
  assert.ok(body.data.every((item) => typeof item.is_approved === 'boolean'));
  assert.equal(typeof body.hasMore, 'boolean');
});

test('template score is never invented when absent', () => {
  assert.equal(getConsistentScore({ id: 'missing-score' }), null);
  assert.equal(getConsistentScore({ confidence_score: 0.91 }), 91);
});
