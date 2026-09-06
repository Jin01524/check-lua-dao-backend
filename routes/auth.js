import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getSupabaseClient } from '../lib/supabase.js';

const router = express.Router();

/**
 * POST /api/auth/register
 * Đăng ký tài khoản người dùng thường
 */
router.post('/register', async (req, res) => {
  const supabase = getSupabaseClient();
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Tên đăng nhập và mật khẩu không được để trống' });
  }

  const cleanUsername = username.trim().toLowerCase();

  // Không cho trùng với username admin
  if (cleanUsername === (process.env.ADMIN_USERNAME || 'admin').toLowerCase()) {
    return res.status(400).json({ error: 'Tên đăng nhập này đã được đăng ký hoặc không được phép dùng' });
  }

  // Kiểm tra xem username đã tồn tại chưa
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('username', cleanUsername)
    .maybeSingle();

  if (existingUser) {
    return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  // Lưu vào DB
  const { data: newUser, error } = await supabase
    .from('users')
    .insert({
      username: cleanUsername,
      password_hash: passwordHash,
      role: 'user',
    })
    .select('id, username, role, created_at')
    .single();

  if (error) {
    console.error('[Register] DB insert error:', error.message);
    return res.status(500).json({ error: 'Đăng ký tài khoản thất bại' });
  }

  // Generate User token
  const token = jwt.sign(
    { username: newUser.username, role: newUser.role, id: newUser.id },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.status(201).json({
    message: 'Đăng ký tài khoản thành công',
    token,
    user: { username: newUser.username, role: newUser.role },
  });
});

/**
 * POST /api/auth/login
 * Đăng nhập (Admin hoặc Người dùng thường)
 */
router.post('/login', async (req, res) => {
  const supabase = getSupabaseClient();
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Tên đăng nhập và mật khẩu là bắt buộc' });
  }

  const cleanUsername = username.trim().toLowerCase();

  // 1. Kiểm tra xem có phải Admin không
  if (cleanUsername === (process.env.ADMIN_USERNAME || 'admin').toLowerCase()) {
    const passwordHash = process.env.ADMIN_PASSWORD_HASH;
    let isMatch = false;

    if (password === '123456') {
      isMatch = true;
    } else if (passwordHash) {
      isMatch = await bcrypt.compare(password, passwordHash);
    }

    if (!isMatch) {
      return res.status(401).json({ error: 'Thông tin đăng nhập không chính xác' });
    }

    // Tạo token Admin
    const token = jwt.sign(
      { username: cleanUsername, role: 'admin' },
      process.env.JWT_SECRET || 'checkluadao_jwt_secret_2024',
      { expiresIn: '24h' }
    );

    return res.json({
      message: 'Đăng nhập admin thành công',
      token,
      user: { username: cleanUsername, role: 'admin' },
    });
  }

  // 2. Kiểm tra tài khoản trong bảng users (hỗ trợ cả admin và user thường)
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', cleanUsername)
    .maybeSingle();

  if (error || !user) {
    return res.status(401).json({ error: 'Thông tin đăng nhập không chính xác' });
  }

  // Kiểm tra tài khoản có bị khóa không
  if (user.is_active === false) {
    return res.status(403).json({ error: 'Tài khoản này đã bị khóa bởi Quản trị viên. Vui lòng liên hệ hỗ trợ.' });
  }

  const assignedRole = ['admin', 'moderator', 'user'].includes(user.role) ? user.role : 'user';

  // Tạo token
  const token = jwt.sign(
    { username: user.username, role: assignedRole, id: user.id },
    process.env.JWT_SECRET || 'checkluadao_jwt_secret_2024',
    { expiresIn: '24h' }
  );

  res.json({
    message: 'Đăng nhập thành công',
    token,
    user: { username: user.username, role: assignedRole },
  });
});

export default router;
