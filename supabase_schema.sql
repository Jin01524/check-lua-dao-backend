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
  confidence_score INTEGER DEFAULT 90,
  warning_points JSONB DEFAULT '[]',
  messages_json JSONB NOT NULL DEFAULT '[]',
  is_approved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration nếu bảng đã tồn tại từ trước
ALTER TABLE scam_templates ADD COLUMN IF NOT EXISTS confidence_score INTEGER DEFAULT 90;
ALTER TABLE scam_templates ADD COLUMN IF NOT EXISTS warning_points JSONB DEFAULT '[]';
ALTER TABLE scam_templates ADD COLUMN IF NOT EXISTS attack_target TEXT DEFAULT 'Không rõ';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_display TEXT DEFAULT '123456';

-- Bảng lưu tài khoản người dùng
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_display TEXT DEFAULT '123456',
  role TEXT DEFAULT 'user',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bảng lưu nhật ký quét tin nhắn thực tế
CREATE TABLE IF NOT EXISTS scan_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT,
  is_scam BOOLEAN DEFAULT false,
  confidence_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index để query nhanh hơn
CREATE INDEX IF NOT EXISTS idx_scam_templates_is_approved ON scam_templates(is_approved);
CREATE INDEX IF NOT EXISTS idx_scam_templates_platform ON scam_templates(platform);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_scan_logs_created_at ON scan_logs(created_at);

-- Tắt RLS để service role key có thể truy cập toàn bộ không bị chặn
ALTER TABLE api_keys DISABLE ROW LEVEL SECURITY;
ALTER TABLE scam_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE scan_logs DISABLE ROW LEVEL SECURITY;

-- Thêm API Key Gemini mặc định nếu chưa có
INSERT INTO api_keys (key, label, is_active)
SELECT 'AIzaSyD5GFjBWabnb9yoYt3samA8mZojkJNW4rQ', 'Gemini Key Mặc định', true
WHERE NOT EXISTS (SELECT 1 FROM api_keys WHERE key = 'AIzaSyD5GFjBWabnb9yoYt3samA8mZojkJNW4rQ');

-- Thêm tài khoản Admin mặc định (username: admin, mật khẩu: 123456)
-- Hash bcrypt của 123456: $2b$10$PkGUEDWv7ZgTPYNVmJNdfuUq/4Rp0NdwrBfrw5xIxKN8MUcSKYTGm
INSERT INTO users (username, password_hash, password_display, role, is_active)
VALUES ('admin', '$2b$10$PkGUEDWv7ZgTPYNVmJNdfuUq/4Rp0NdwrBfrw5xIxKN8MUcSKYTGm', '123456', 'admin', true)
ON CONFLICT (username)
DO UPDATE SET password_hash = '$2b$10$PkGUEDWv7ZgTPYNVmJNdfuUq/4Rp0NdwrBfrw5xIxKN8MUcSKYTGm', password_display = '123456', role = 'admin', is_active = true;

-- Cập nhật điểm rủi ro và mục tiêu tấn công chuẩn cho các mẫu cũ
UPDATE scam_templates SET confidence_score = 98, attack_target = 'Tài khoản ngân hàng & Mã OTP' WHERE title ILIKE '%Vietcombank%';
UPDATE scam_templates SET confidence_score = 96, attack_target = 'Tiền tiết kiệm / Tài khoản tạm giữ' WHERE title ILIKE '%Công an%';
UPDATE scam_templates SET confidence_score = 94, attack_target = 'Tiền nạp nhiệm vụ & Giật đơn' WHERE title ILIKE '%Cộng tác viên%' OR title ILIKE '%Shopee%';
UPDATE scam_templates SET confidence_score = 97, attack_target = 'Quyền kiểm soát điện thoại (Trợ năng)' WHERE title ILIKE '%Thuế%' OR title ILIKE '%Trojan%';
UPDATE scam_templates SET confidence_score = 93, attack_target = 'Quyền kiểm soát SIM & Mã OTP SMS' WHERE title ILIKE '%khóa thuê bao%' OR title ILIKE '%SIM%';
UPDATE scam_templates SET confidence_score = 92, attack_target = 'Tiền phí hồ sơ / Phí trước bạ' WHERE title ILIKE '%trúng thưởng%' OR title ILIKE '%Honda SH%';



