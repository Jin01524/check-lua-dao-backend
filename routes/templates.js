import express from 'express';
import { getSupabaseClient } from '../lib/supabase.js';

const router = express.Router();

/**
 * GET /api/templates
 * Lấy danh sách mẫu đã được duyệt (is_approved = true)
 * Không trả messages_json để tránh payload nặng
 */
router.get('/', async (req, res) => {
  const supabase = getSupabaseClient();
  const { platform, limit = 20, offset = 0 } = req.query;

  let query = supabase
    .from('scam_templates')
    .select('id, title, platform, scam_type, created_at')
    .eq('is_approved', true)
    .order('created_at', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (platform) {
    query = query.ilike('platform', `%${platform}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[Templates] Error fetching templates:', error.message);
    return res.status(500).json({ error: 'Failed to fetch templates' });
  }

  res.json({ data, count: data.length });
});

/**
 * GET /api/templates/:id
 * Lấy chi tiết 1 mẫu đã duyệt kèm messages_json
 */
router.get('/:id', async (req, res) => {
  const supabase = getSupabaseClient();
  const { id } = req.params;

  const { data, error } = await supabase
    .from('scam_templates')
    .select('*')
    .eq('id', id)
    .eq('is_approved', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return res.status(404).json({ error: 'Template not found' });
    }
    console.error('[Templates] Error fetching template:', error.message);
    return res.status(500).json({ error: 'Failed to fetch template' });
  }

  res.json({ data });
});

export default router;
