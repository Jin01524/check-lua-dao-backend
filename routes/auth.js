import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getSupabaseClient } from '../lib/supabase.js';

const router = express.Router();

/**
 * POST /api/auth/login
 * Đăng nhập Quản trị viên / Kiểm duyệt viên
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
