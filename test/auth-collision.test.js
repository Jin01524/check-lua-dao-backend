import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import bcrypt from 'bcryptjs';
import authRoutes from '../routes/auth.js';

test('database admin wins a username collision with environment admin', async (context) => {
  const previous = Object.fromEntries([
    'JWT_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH',
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  ].map((key) => [key, process.env[key]]));

  const dbHash = await bcrypt.hash('database-test-password', 4);
  let active = true;
  const database = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/rest/v1/users?')) {
      res.end(JSON.stringify([{ id: 'db-admin-id', username: 'admin', role: 'admin', is_active: active, password_hash: dbHash }]));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  database.listen(0, '127.0.0.1');
  await new Promise((resolve) => database.once('listening', resolve));

  process.env.JWT_SECRET = 'collision-test-secret';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash('environment-test-password', 4);
  process.env.SUPABASE_URL = `http://127.0.0.1:${database.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => database.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const login = (password) => fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password }),
  });

  const accepted = await login('database-test-password');
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).user.role, 'admin');
  assert.equal((await login('environment-test-password')).status, 401);
  active = false;
  assert.equal((await login('database-test-password')).status, 403);
});
