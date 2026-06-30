import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = express.Router();

/**
 * POST /api/auth/login
 * Đăng nhập admin bằng username/password
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  // Kiểm tra username
  if (username !== process.env.ADMIN_USERNAME) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // So sánh password với bcrypt hash
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!passwordHash) {
    console.error('[Auth] ADMIN_PASSWORD_HASH not configured in .env');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const isMatch = await bcrypt.compare(password, passwordHash);
  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Tạo JWT token (expires 24h)
  const token = jwt.sign(
    { username, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    message: 'Login successful',
    token,
    expiresIn: 86400, // seconds
    user: { username, role: 'admin' },
  });
});

export default router;
