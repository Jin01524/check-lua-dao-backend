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
  attack_target TEXT DEFAULT 'Không rõ',
  confidence_score INTEGER,
  warning_points JSONB DEFAULT '[]',
  exfiltration_vector TEXT DEFAULT 'none',
  multi_agent_debate JSONB,
  messages_json JSONB NOT NULL DEFAULT '[]',
  is_approved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration nếu bảng đã tồn tại từ trước
ALTER TABLE scam_templates ADD COLUMN IF NOT EXISTS confidence_score INTEGER;
ALTER TABLE scam_templates ALTER COLUMN confidence_score DROP DEFAULT;
ALTER TABLE scam_templates ADD COLUMN IF NOT EXISTS warning_points JSONB DEFAULT '[]';
ALTER TABLE scam_templates ADD COLUMN IF NOT EXISTS attack_target TEXT DEFAULT 'Không rõ';
ALTER TABLE scam_templates ADD COLUMN IF NOT EXISTS exfiltration_vector TEXT DEFAULT 'none';
ALTER TABLE scam_templates ADD COLUMN IF NOT EXISTS multi_agent_debate JSONB;

-- Bảng lưu tài khoản người dùng
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
-- Existing deployments may have stored readable passwords. Remove that column.
ALTER TABLE users DROP COLUMN IF EXISTS password_display;

-- Bảng lưu nhật ký quét tin nhắn thực tế
CREATE TABLE IF NOT EXISTS scan_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT,
  is_scam BOOLEAN DEFAULT false,
  confidence_score INTEGER DEFAULT 0,
  scam_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bảng lưu số liệu thống kê hệ thống (đồng bộ trong database Supabase)
CREATE TABLE IF NOT EXISTS system_stats (
  id TEXT PRIMARY KEY DEFAULT 'global',
  total_scans INTEGER DEFAULT 0,
  warned_scans INTEGER DEFAULT 0,
  max_confidence INTEGER DEFAULT 0,
  active_model TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE system_stats ADD COLUMN IF NOT EXISTS active_model TEXT;

-- Index để query nhanh hơn
CREATE INDEX IF NOT EXISTS idx_scam_templates_is_approved ON scam_templates(is_approved);
CREATE INDEX IF NOT EXISTS idx_scam_templates_platform ON scam_templates(platform);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_scan_logs_created_at ON scan_logs(created_at);

-- Chỉ backend dùng service-role key; service_role vượt RLS. Chặn truy cập trực tiếp
-- bằng anon/authenticated, kể cả khi các bảng đã tồn tại từ bản triển khai cũ.
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE scam_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON api_keys, scam_templates, users, scan_logs, system_stats FROM anon, authenticated;

-- Khởi tạo thống kê mới từ 0; không biến mẫu tham khảo thành lượt quét thật.
INSERT INTO system_stats (id, total_scans, warned_scans, max_confidence)
VALUES ('global', 0, 0, 0)
ON CONFLICT (id) DO NOTHING;

