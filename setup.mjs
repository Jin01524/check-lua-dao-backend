/**
 * setup.mjs - Chạy một lần để setup hash mật khẩu admin
 * Cách dùng: node setup.mjs
 *
 * Script này sẽ:
 * 1. Generate bcrypt hash cho password admin
 * 2. Cập nhật file .env với hash mới
 */

import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ENV_FILE = path.join(__dirname, '.env');

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  throw new Error('Set ADMIN_PASSWORD (at least 12 characters) in the environment before running setup.');
}

console.log('🔑 Generating bcrypt hash for admin password...');
const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
console.log('✅ Hash generated:', hash);

// Đọc file .env hiện tại
let envContent = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf-8') : '';

// Thay thế dòng ADMIN_PASSWORD_HASH
if (envContent.includes('ADMIN_PASSWORD_HASH=')) {
  envContent = envContent.replace(
    /ADMIN_PASSWORD_HASH=.*/,
    `ADMIN_PASSWORD_HASH=${hash}`
  );
} else {
  envContent += `\nADMIN_PASSWORD_HASH=${hash}\n`;
}

fs.writeFileSync(ENV_FILE, envContent, 'utf-8');
console.log('✅ .env updated with new password hash');
console.log('Admin password hash configured. Keep the plaintext password outside the repository.');
