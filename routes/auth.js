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

  res.status(201).json({
    message: 'Đăng ký tài khoản thành công',
    user: newUser,
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
    if (!passwordHash) {
      console.error('[Auth] ADMIN_PASSWORD_HASH not configured in .env');
      return res.status(500).json({ error: 'Lỗi cấu hình server' });
    }

    const isMatch = await bcrypt.compare(password, passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Thông tin đăng nhập không chính xác' });
    }

    // Tạo token Admin
    const token = jwt.sign(
      { username: cleanUsername, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.json({
      message: 'Đăng nhập admin thành công',
      token,
      user: { username: cleanUsername, role: 'admin' },
    });
  }

  // 2. Nếu không phải Admin, kiểm tra tài khoản người dùng thường trong DB
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', cleanUsername)
    .maybeSingle();

  if (error || !user) {
    return res.status(401).json({ error: 'Thông tin đăng nhập không chính xác' });
  }

  // So sánh password
  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    return res.status(401).json({ error: 'Thông tin đăng nhập không chính xác' });
  }

  // Tạo token User
  const token = jwt.sign(
    { username: user.username, role: 'user', id: user.id },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    message: 'Đăng nhập thành công',
    token,
    user: { username: user.username, role: 'user' },
  });
});

export default router;
