import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Auto-generate bcrypt hash if needed ─────────────────────────────────────
// Kiểm tra và generate bcrypt hash cho admin password khi startup
const DEFAULT_ADMIN_PASSWORD = 'admin@checkluadao2024';
const BCRYPT_REGEX = /^\$2[ab]?\$\d{2}\$.{53}$/;

const existingHash = process.env.ADMIN_PASSWORD_HASH || '';
let hashIsValid = false;

if (BCRYPT_REGEX.test(existingHash)) {
  try {
    hashIsValid = await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, existingHash);
  } catch (_) {
    hashIsValid = false;
  }
}

if (!hashIsValid) {
  console.log('[Startup] Generating bcrypt hash for admin password...');
  const hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
  process.env.ADMIN_PASSWORD_HASH = hash;

  // Ghi vào .env để lần sau không cần generate lại
  try {
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf-8');
    if (envContent.includes('ADMIN_PASSWORD_HASH=')) {
      envContent = envContent.replace(/ADMIN_PASSWORD_HASH=.*/, `ADMIN_PASSWORD_HASH=${hash}`);
    } else {
      envContent += `\nADMIN_PASSWORD_HASH=${hash}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf-8');
    console.log('[Startup] ✅ bcrypt hash saved to .env');
  } catch (e) {
    console.warn('[Startup] Could not write hash to .env:', e.message);
  }
}


import authRoutes from './routes/auth.js';
import checkRoutes from './routes/check.js';
import templatesRoutes from './routes/templates.js';
import adminRoutes from './routes/admin.js';

const app = express();
const PORT = process.env.PORT || 5000;

// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
];

app.use(cors({
  origin: (origin, callback) => {
    // Cho phép requests không có origin (mobile apps, curl, v.v.)
    if (!origin) return callback(null, true);
    // Cho phép localhost
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Cho phép vercel.app subdomains
    if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return callback(null, true);
    callback(new Error(`CORS policy: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ─── Body Parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/check', checkRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/admin', adminRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR] Message:', err.message || err);
  console.error('[ERROR] Stack:', err.stack);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('╔════════════════════════════════════════╗');
  console.log(`║  CheckLuaDao Backend - Port ${PORT}      ║`);
  console.log('╠════════════════════════════════════════╣');
  console.log(`║  Supabase URL: ${process.env.SUPABASE_URL ? '✓ Connected' : '✗ Not set'}           ║`);
  console.log(`║  Gemini API : ${process.env.GEMINI_API_KEY ? '✓ Configured' : '✗ Not set'}          ║`);
  console.log(`║  JWT Secret : ${process.env.JWT_SECRET ? '✓ Set' : '✗ Not set'}               ║`);
  console.log('╚════════════════════════════════════════╝');
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/health\n`);
});
