import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import authRoutes from './routes/auth.js';
import checkRoutes from './routes/check.js';
import templatesRoutes, { CURATED_TEMPLATES } from './routes/templates.js';
import adminRoutes from './routes/admin.js';
import statsRoutes from './routes/stats.js';
import { getSupabaseClient } from './lib/supabase.js';

// Seed curated examples only when explicitly requested. Never create accounts or passwords at startup.
(async () => {
  try {
    const supabase = getSupabaseClient();

    // Chỉ seed curated templates nếu người dùng bật cấu hình SEED_TEMPLATES=true
    if (process.env.SEED_TEMPLATES === 'true') {
      const { count, error: countErr } = await supabase
        .from('scam_templates')
        .select('*', { count: 'exact', head: true });

      if (!countErr && (count === 0 || count === null)) {
        console.log('[Startup] Seeding curated threat templates into scam_templates...');
        for (const tpl of CURATED_TEMPLATES) {
          await supabase
            .from('scam_templates')
            .insert({
              title: tpl.title,
              platform: tpl.platform,
              scam_type: tpl.scam_type,
              analysis: tpl.analysis,
              attack_target: tpl.attack_target || 'Không rõ',
              confidence_score: tpl.confidence_score ?? null,
              warning_points: tpl.warning_points || [],
              messages_json: tpl.messages_json,
              is_approved: true,
            })
            .catch(() => {});
        }
        console.log('[Startup] ✅ Curated threat templates seeded successfully');
      }
    }

  } catch (e) {
    // Graceful silent skip if Supabase not yet configured locally
  }
})();

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
app.use('/api/stats', statsRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  if (process.env.RENDER_GIT_COMMIT) {
    res.set('X-Deploy-Revision', process.env.RENDER_GIT_COMMIT.slice(0, 12));
  }
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
  res.status(status).json({
    error: status >= 500 ? 'Lỗi máy chủ. Vui lòng thử lại sau.' : (err.message || 'Yêu cầu không hợp lệ'),
  });
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
