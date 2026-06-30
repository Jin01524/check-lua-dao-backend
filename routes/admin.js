import express from 'express';
import { getSupabaseClient } from '../lib/supabase.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

// Áp dụng auth middleware cho tất cả routes trong /api/admin
router.use(authMiddleware);

// ══════════════════════════════════════════════════════════════════════════════
// API KEYS Management
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/api-keys
 * Lấy danh sách API key (ẩn key, chỉ hiện 4 ký tự cuối)
 */
router.get('/api-keys', async (_req, res) => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, key, label, is_active, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch API keys' });
  }

  // Mask key: chỉ hiện 4 ký tự cuối
  const masked = data.map((item) => ({
    ...item,
    key: item.key ? `${'*'.repeat(Math.max(0, item.key.length - 4))}${item.key.slice(-4)}` : '****',
  }));

  res.json({ data: masked });
});

/**
 * POST /api/admin/api-keys
 * Thêm API key mới
 * Body: { key, label }
 */
router.post('/api-keys', async (req, res) => {
  const supabase = getSupabaseClient();
  const { key, label } = req.body;

  if (!key || !key.trim()) {
    return res.status(400).json({ error: 'API key is required' });
  }

  const { data, error } = await supabase
    .from('api_keys')
    .insert({ key: key.trim(), label: label || 'API Key', is_active: true })
    .select('id, label, is_active, created_at')
    .single();

  if (error) {
    return res.status(500).json({ error: 'Failed to create API key' });
  }

  res.status(201).json({ message: 'API key created', data });
});

/**
 * PUT /api/admin/api-keys/:id
 * Sửa API key (toggle is_active, sửa label)
 * Body: { is_active?, label? }
 */
router.put('/api-keys/:id', async (req, res) => {
  const supabase = getSupabaseClient();
  const { id } = req.params;
  const { is_active, label } = req.body;

  const updateFields = {};
  if (typeof is_active === 'boolean') updateFields.is_active = is_active;
  if (label !== undefined) updateFields.label = label;

  if (Object.keys(updateFields).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const { data, error } = await supabase
    .from('api_keys')
    .update(updateFields)
    .eq('id', id)
    .select('id, label, is_active, created_at')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return res.status(404).json({ error: 'API key not found' });
    }
    return res.status(500).json({ error: 'Failed to update API key' });
  }

  res.json({ message: 'API key updated', data });
});

/**
 * DELETE /api/admin/api-keys/:id
 * Xóa API key
 */
router.delete('/api-keys/:id', async (req, res) => {
  const supabase = getSupabaseClient();
  const { id } = req.params;

  const { error } = await supabase
    .from('api_keys')
    .delete()
    .eq('id', id);

  if (error) {
    return res.status(500).json({ error: 'Failed to delete API key' });
  }

  res.json({ message: 'API key deleted' });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATES Management
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/templates
 * Lấy TẤT CẢ mẫu (kể cả chưa duyệt)
 */
router.get('/templates', async (req, res) => {
  const supabase = getSupabaseClient();
  const { limit = 50, offset = 0, approved } = req.query;

  let query = supabase
    .from('scam_templates')
    .select('id, title, platform, scam_type, is_approved, created_at')
    .order('created_at', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  // Filter by approval status nếu có
  if (approved === 'true') query = query.eq('is_approved', true);
  else if (approved === 'false') query = query.eq('is_approved', false);

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch templates' });
  }

  res.json({ data, count: data.length });
});

/**
 * PUT /api/admin/templates/:id
 * Sửa mẫu (title, analysis, messages_json, is_approved, scam_type)
 */
router.put('/templates/:id', async (req, res) => {
  const supabase = getSupabaseClient();
  const { id } = req.params;
  const { title, analysis, messages_json, is_approved, scam_type, platform } = req.body;

  const updateFields = {};
  if (title !== undefined) updateFields.title = title;
  if (analysis !== undefined) updateFields.analysis = analysis;
  if (messages_json !== undefined) updateFields.messages_json = messages_json;
  if (typeof is_approved === 'boolean') updateFields.is_approved = is_approved;
  if (scam_type !== undefined) updateFields.scam_type = scam_type;
  if (platform !== undefined) updateFields.platform = platform;

  if (Object.keys(updateFields).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const { data, error } = await supabase
    .from('scam_templates')
    .update(updateFields)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return res.status(404).json({ error: 'Template not found' });
    }
    return res.status(500).json({ error: 'Failed to update template' });
  }

  res.json({ message: 'Template updated', data });
});

/**
 * DELETE /api/admin/templates/:id
 * Xóa mẫu
 */
router.delete('/templates/:id', async (req, res) => {
  const supabase = getSupabaseClient();
  const { id } = req.params;

  const { error } = await supabase
    .from('scam_templates')
    .delete()
    .eq('id', id);

  if (error) {
    return res.status(500).json({ error: 'Failed to delete template' });
  }

  res.json({ message: 'Template deleted' });
});

export default router;
