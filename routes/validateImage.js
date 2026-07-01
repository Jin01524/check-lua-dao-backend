import express from 'express';
import multer from 'multer';
import { detectChatStructure } from '../utils/detectChat.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

/**
 * POST /api/validate-image
 * Nhận 1 ảnh, phân tích cấu trúc cạnh (Canny) để xác định có phải screenshot chat không.
 *
 * Body: multipart/form-data với field "image"
 * Response: { valid: boolean, reason: string, hLines: number, rects: number }
 */
router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Không có ảnh được gửi lên.' });
  }

  const result = await detectChatStructure(req.file.buffer);
  return res.json(result);
});

export default router;
