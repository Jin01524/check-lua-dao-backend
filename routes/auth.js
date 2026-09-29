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
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Tên đăng nhập và mật khẩu là bắt buộc' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(503).json({ error: 'Hệ thống đăng nhập chưa được cấu hình' });
  }

  // A database account takes precedence when it shares the environment admin's name.
  // Otherwise the environment password can hide a valid database password forever.
  let user = null;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data, error } = await getSupabaseClient()
      .from('users')
      .select('id, username, password_hash, role, is_active')
      .eq('username', cleanUsername)
      .maybeSingle();

    if (error) {
      return res.status(503).json({ error: 'Không thể kiểm tra tài khoản lúc này. Vui lòng thử lại.' });
    }
    user = data;
  }

  if (user) {
    if (user.is_active === false) {
      return res.status(403).json({ error: 'Tài khoản này đã bị khóa bởi Quản trị viên. Vui lòng liên hệ hỗ trợ.' });
    }

    if (!user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Thông tin đăng nhập không chính xác' });
    }

    const assignedRole = ['admin', 'moderator', 'user'].includes(user.role) ? user.role : 'user';
    const token = jwt.sign(
      { username: user.username, role: assignedRole, id: user.id },
      jwtSecret,
      { expiresIn: '24h' }
    );

    return res.json({
      message: 'Đăng nhập thành công',
      token,
      user: { username: user.username, role: assignedRole },
    });
  }

  // Environment admin remains available only when no database row has this name.
  if (process.env.ADMIN_USERNAME && cleanUsername === process.env.ADMIN_USERNAME.toLowerCase()) {
    const passwordHash = process.env.ADMIN_PASSWORD_HASH;
    const isMatch = passwordHash ? await bcrypt.compare(password, passwordHash) : false;

    if (!isMatch) {
      return res.status(401).json({ error: 'Thông tin đăng nhập không chính xác' });
    }

    // Tạo token Admin
    const token = jwt.sign(
      { username: cleanUsername, role: 'admin' },
      jwtSecret,
      { expiresIn: '24h' }
    );

    return res.json({
      message: 'Đăng nhập admin thành công',
      token,
      user: { username: cleanUsername, role: 'admin' },
    });
  }

  return res.status(401).json({ error: 'Thông tin đăng nhập không chính xác' });
});

export default router;
