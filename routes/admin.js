import express from 'express';
import bcrypt from 'bcryptjs';
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
 * PATCH /api/admin/api-keys/:id
 * Sửa API key (toggle is_active, sửa label)
 * Body: { isActive?, label? }
 */
router.patch('/api-keys/:id', async (req, res) => {
  const supabase = getSupabaseClient();
  const { id } = req.params;
  const { isActive, label } = req.body;

  const updateFields = {};
  if (typeof isActive === 'boolean') updateFields.is_active = isActive;
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

// Giữ lại PUT làm fallback
router.put('/api-keys/:id', async (req, res) => {
  const supabase = getSupabaseClient();
  const { id } = req.params;
  const { is_active, label } = req.body;
  const { isActive } = req.body;

  const updateFields = {};
  const activeStatus = typeof isActive === 'boolean' ? isActive : is_active;
  if (typeof activeStatus === 'boolean') updateFields.is_active = activeStatus;
  if (label !== undefined) updateFields.label = label;

  const { data, error } = await supabase
    .from('api_keys')
    .update(updateFields)
    .eq('id', id)
    .select('id, label, is_active, created_at')
    .single();

  if (error) return res.status(500).json({ error: 'Failed to update API key' });
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
    .select('*')
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
 * PATCH /api/admin/templates/:id/approve
 * Phê duyệt mẫu tin nhắn lừa đảo
 */
router.patch('/templates/:id/approve', async (req, res) => {
  const supabase = getSupabaseClient();
  const { id } = req.params;

  const { data, error } = await supabase
    .from('scam_templates')
    .update({ is_approved: true })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return res.status(404).json({ error: 'Template not found' });
    }
    return res.status(500).json({ error: 'Failed to approve template' });
  }

  res.json({ message: 'Template approved successfully', data });
});

/**
 * PATCH /api/admin/templates/:id
 * Sửa mẫu (title, analysis, messages_json, is_approved, scam_type, confidence_score, warning_points)
 */
router.patch('/templates/:id', async (req, res) => {
  const supabase = getSupabaseClient();
  const { id } = req.params;
  const {
    title,
    analysis,
    messages_json,
    is_approved,
    isApproved,
    scam_type,
    platform,
    confidence_score,
    confidenceScore,
    warning_points,
    warningPoints,
  } = req.body;

  const updateFields = {};
  if (title !== undefined) updateFields.title = title;
  if (analysis !== undefined) updateFields.analysis = analysis;
  if (messages_json !== undefined) updateFields.messages_json = messages_json;

  const approvedVal = typeof isApproved === 'boolean' ? isApproved : (typeof is_approved === 'boolean' ? is_approved : undefined);
  if (approvedVal !== undefined) updateFields.is_approved = approvedVal;

  if (scam_type !== undefined) updateFields.scam_type = scam_type;
  if (platform !== undefined) updateFields.platform = platform;

  const scoreVal = confidenceScore !== undefined ? confidenceScore : confidence_score;
  if (scoreVal !== undefined) updateFields.confidence_score = Number(scoreVal);

  const warnVal = warningPoints !== undefined ? warningPoints : warning_points;
  if (warnVal !== undefined) updateFields.warning_points = warnVal;

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
 * PUT /api/admin/templates/:id
 * Giữ lại làm fallback
 */
router.put('/templates/:id', async (req, res) => {
  const supabase = getSupabaseClient();
  const { id } = req.params;
  const {
    title,
    analysis,
    messages_json,
    is_approved,
    isApproved,
    scam_type,
    platform,
    confidence_score,
    confidenceScore,
    warning_points,
    warningPoints,
  } = req.body;

  const updateFields = {};
  if (title !== undefined) updateFields.title = title;
  if (analysis !== undefined) updateFields.analysis = analysis;
  if (messages_json !== undefined) updateFields.messages_json = messages_json;

  const approvedVal = typeof isApproved === 'boolean' ? isApproved : (typeof is_approved === 'boolean' ? is_approved : undefined);
  if (approvedVal !== undefined) updateFields.is_approved = approvedVal;

  if (scam_type !== undefined) updateFields.scam_type = scam_type;
  if (platform !== undefined) updateFields.platform = platform;

  const scoreVal = confidenceScore !== undefined ? confidenceScore : confidence_score;
  if (scoreVal !== undefined) updateFields.confidence_score = Number(scoreVal);

  const warnVal = warningPoints !== undefined ? warningPoints : warning_points;
  if (warnVal !== undefined) updateFields.warning_points = warnVal;

  const { data, error } = await supabase
    .from('scam_templates')
    .update(updateFields)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: 'Failed to update template' });
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

// ══════════════════════════════════════════════════════════════════════════════
// USERS & MODERATORS Management (Quản lý phân quyền & tài khoản kiểm duyệt viên)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/users
 * Lấy danh sách tài khoản (chỉ admin có quyền)
 */
router.get('/users', async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền quản lý phân quyền' });
  }

  let supabase = null;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    return res.status(500).json({ error: 'Database chưa sẵn sàng' });
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, username, role, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: 'Không thể lấy danh sách tài khoản: ' + error.message });
  }

  const list = data || [];
  // Đảm bảo có tài khoản admin master
  if (!list.some((u) => u.username.toLowerCase() === 'admin')) {
    list.unshift({
      id: 'master-admin',
      username: 'admin',
      role: 'admin',
      created_at: new Date().toISOString(),
    });
  }

  res.json({ data: list });
});

/**
 * POST /api/admin/users
 * Tạo tài khoản kiểm duyệt viên hoặc quản trị viên
 * Body: { username, password, role }
 */
router.post('/users', async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền tạo tài khoản' });
  }

  const { username, password, role = 'moderator' } = req.body;

  if (!username || !username.trim()) {
    return res.status(400).json({ error: 'Tên đăng nhập không được để trống' });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const validRole = ['moderator', 'admin', 'user'].includes(role) ? role : 'moderator';

  let supabase = null;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    return res.status(500).json({ error: 'Database chưa sẵn sàng' });
  }

  // Kiểm tra trùng username
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('username', cleanUsername)
    .maybeSingle();

  if (existing) {
    return res.status(400).json({ error: 'Tên đăng nhập này đã tồn tại trên hệ thống' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('users')
    .insert({
      username: cleanUsername,
      password_hash: passwordHash,
      role: validRole,
    })
    .select('id, username, role, created_at')
    .single();

  if (error) {
    return res.status(500).json({ error: 'Không thể tạo tài khoản: ' + error.message });
  }

  res.status(201).json({
    message: `Đã tạo tài khoản ${validRole === 'moderator' ? 'Kiểm duyệt viên' : 'Quản trị viên'} thành công`,
    data,
  });
});

/**
 * PATCH /api/admin/users/:id
 * Cập nhật vai trò hoặc đổi mật khẩu
 */
router.patch('/users/:id', async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền phân quyền' });
  }

  const { id } = req.params;
  const { role, password } = req.body;

  const updateFields = {};
  if (role && ['moderator', 'admin', 'user'].includes(role)) {
    updateFields.role = role;
  }
  if (password && password.length >= 6) {
    updateFields.password_hash = await bcrypt.hash(password, 10);
  }

  if (Object.keys(updateFields).length === 0) {
    return res.status(400).json({ error: 'Không có thông tin thay đổi' });
  }

  let supabase = null;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    return res.status(500).json({ error: 'Database chưa sẵn sàng' });
  }

  const { data, error } = await supabase
    .from('users')
    .update(updateFields)
    .eq('id', id)
    .select('id, username, role, created_at')
    .single();

  if (error) {
    return res.status(500).json({ error: 'Cập nhật tài khoản thất bại' });
  }

  res.json({ message: 'Cập nhật tài khoản thành công', data });
});

/**
 * DELETE /api/admin/users/:id
 * Xóa tài khoản
 */
router.delete('/users/:id', async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền xóa tài khoản' });
  }

  const { id } = req.params;

  let supabase = null;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    return res.status(500).json({ error: 'Database chưa sẵn sàng' });
  }

  const { data: targetUser } = await supabase
    .from('users')
    .select('username')
    .eq('id', id)
    .maybeSingle();

  if (targetUser?.username?.toLowerCase() === 'admin') {
    return res.status(400).json({ error: 'Không thể xóa tài khoản Quản trị viên mặc định (admin)' });
  }

  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', id);

  if (error) {
    return res.status(500).json({ error: 'Không thể xóa tài khoản: ' + error.message });
  }

  res.json({ message: 'Tài khoản đã được xóa' });
});

export default router;
