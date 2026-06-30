-- =====================================================
-- CheckLuaDao - Supabase SQL Schema
-- Chạy file này trong Supabase SQL Editor
-- =====================================================

-- Bảng lưu API Keys Gemini
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL,
  label TEXT DEFAULT 'API Key',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bảng lưu mẫu tin nhắn lừa đảo
CREATE TABLE IF NOT EXISTS scam_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  platform TEXT NOT NULL,
  scam_type TEXT,
  analysis TEXT,
  messages_json JSONB NOT NULL DEFAULT '[]',
  is_approved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index để query nhanh hơn
CREATE INDEX IF NOT EXISTS idx_scam_templates_is_approved ON scam_templates(is_approved);
CREATE INDEX IF NOT EXISTS idx_scam_templates_platform ON scam_templates(platform);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active);

-- Tắt RLS để service role key có thể truy cập toàn bộ không bị chặn
ALTER TABLE api_keys DISABLE ROW LEVEL SECURITY;
ALTER TABLE scam_templates DISABLE ROW LEVEL SECURITY;

-- Thêm API Key Gemini mặc định nếu chưa có
INSERT INTO api_keys (key, label, is_active)
SELECT 'AIzaSyD5GFjBWabnb9yoYt3samA8mZojkJNW4rQ', 'Gemini Key Mặc định', true
WHERE NOT EXISTS (SELECT 1 FROM api_keys WHERE key = 'AIzaSyD5GFjBWabnb9yoYt3samA8mZojkJNW4rQ');

