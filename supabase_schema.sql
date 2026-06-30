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

-- Row Level Security (RLS) - Tùy chọn, có thể bỏ qua nếu dùng service role key
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE scam_templates ENABLE ROW LEVEL SECURITY;

-- Policy: Service role bypass all RLS
CREATE POLICY "Service role full access on api_keys"
  ON api_keys FOR ALL
  USING (true);

CREATE POLICY "Service role full access on scam_templates"
  ON scam_templates FOR ALL
  USING (true);
