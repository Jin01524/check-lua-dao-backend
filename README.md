# CheckLuaDao - Backend

Backend API cho ứng dụng kiểm tra tin nhắn lừa đảo, sử dụng Node.js + Express + Supabase, Tesseract.js OCR và Google Gemini phân tích văn bản.

## 📋 Yêu cầu hệ thống

- Node.js >= 18.x
- npm >= 9.x
- Lần OCR đầu cần Internet để tải dữ liệu ngôn ngữ Việt/Anh; Tesseract.js cache dữ liệu cho các lần sau

## 🚀 Cài đặt và chạy

Supabase CLI được khóa phiên bản trong dev dependencies. Từ thư mục backend, chạy `npm ci` rồi dùng `npx --no-install supabase --version` để kiểm tra. Các lệnh trong `../supabase.txt` cần thêm tiền tố `npx --no-install`, ví dụ `npx --no-install supabase login` và `npx --no-install supabase link --project-ref <project-ref>`. Chỉ chạy `link` sau khi đăng nhập đúng tài khoản; không đưa mật khẩu database hoặc access token vào lệnh hay Git.

### 1. Cài đặt dependencies

```bash
cd backend
npm install
```

### 2. Cấu hình biến môi trường

Tạo `.env` cục bộ hoặc đặt biến môi trường trên dịch vụ deploy. Không dùng mật khẩu hay khóa mẫu trong source:

```env
PORT=5000
SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=...
GEMINI_API_KEY=...
JWT_SECRET=<long-random-secret>
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=...   # bcrypt hash của password admin
STORE_SCAN_TEMPLATES=false
```

API public trả cả mẫu `is_approved=true` và `is_approved=false`. Không bật `STORE_SCAN_TEMPLATES` trước khi có cơ chế xin phép và che dữ liệu cá nhân: mẫu mới lưu sẽ có thể được đọc công khai ngay. Khách truy cập không bị giới hạn số lượt quét ở tầng ứng dụng.

### 3. Setup Supabase Database

Chạy file SQL trong **Supabase SQL Editor**:

1. Truy cập [Supabase Dashboard](https://app.supabase.com)
2. Vào project → **SQL Editor**
3. Copy và chạy toàn bộ nội dung file `supabase_schema.sql`

### 4. Chạy server

```bash
# Development (với nodemon, tự động reload)
npm run dev

# Production
npm start
```

Server sẽ chạy tại: `http://localhost:5000`

---

## 🔗 API Endpoints

### Public

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET`  | `/api/health` | Health check |
| `POST` | `/api/auth/login` | Đăng nhập admin |
| `POST` | `/api/check` | OCR ảnh cục bộ rồi phân tích văn bản (multipart) |
| `GET`  | `/api/templates` | Danh sách mẫu đã và chưa kiểm duyệt, có `is_approved` |
| `GET`  | `/api/templates/:id` | Chi tiết mẫu đã và chưa kiểm duyệt |

### Admin (yêu cầu Bearer Token)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET`  | `/api/admin/api-keys` | Danh sách API keys (masked) |
| `POST` | `/api/admin/api-keys` | Thêm API key mới |
| `PUT`  | `/api/admin/api-keys/:id` | Sửa API key |
| `DELETE` | `/api/admin/api-keys/:id` | Xóa API key |
| `GET`  | `/api/admin/templates` | Tất cả mẫu (kể cả chưa duyệt) |
| `PUT`  | `/api/admin/templates/:id` | Sửa/duyệt mẫu |
| `DELETE` | `/api/admin/templates/:id` | Xóa mẫu |

---

## 📤 POST /api/check - Cách sử dụng

Request: `multipart/form-data`
- `images` - 1-5 file ảnh PNG/JPG
- `platform` - Tên nền tảng (Zalo, Facebook, SMS, Telegram, v.v.)

Ảnh chỉ được gửi tới backend của ứng dụng. Tesseract.js chạy OCR trên backend; chỉ văn bản OCR và văn bản người dùng nhập được gửi tới Gemini. OCR có thể đọc sai hoặc thiếu chữ ở ảnh mờ; nếu không có văn bản để phân tích, API trả về lỗi yêu cầu ảnh rõ hơn.

```bash
curl -X POST http://localhost:5000/api/check \
  -F "images=@screenshot1.jpg" \
  -F "images=@screenshot2.jpg" \
  -F "platform=Zalo"
```

Response:
```json
{
  "isScam": true,
  "scamType": "Giả mạo ngân hàng",
  "title": "Lừa đảo yêu cầu xác minh tài khoản ngân hàng",
  "confidenceScore": 92,
  "analysis": "Tin nhắn có nhiều dấu hiệu lừa đảo...",
  "warningPoints": ["Yêu cầu OTP", "Đường link lạ"],
  "messages": [
    {"sender": "scammer", "text": "Tài khoản của bạn bị khoá, nhập OTP xxxx"}
  ],
  "platform": "Zalo",
  "imageCount": 2,
  "savedTemplateId": "uuid-here"
}
```

---

## 🔐 Admin Login

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "<your-admin-password>"}'
```

Response:
```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "expiresIn": 86400
}
```

Dùng token trong header:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

---

## 📂 Cấu trúc thư mục

```
backend/
├── .env                    # Biến môi trường (không commit)
├── .gitignore
├── package.json
├── server.js               # Entry point
├── supabase_schema.sql     # SQL tạo bảng Supabase
├── README.md
├── middleware/
│   └── auth.js             # JWT middleware
├── routes/
│   ├── auth.js             # POST /api/auth/login
│   ├── check.js            # POST /api/check
│   ├── templates.js        # GET /api/templates
│   └── admin.js            # /api/admin/* (protected)
└── services/
    ├── geminiService.js    # Gemini phân tích văn bản
    └── ocrService.js       # Tesseract.js OCR cục bộ
```

---

## ⚠️ Lưu ý

- File `.env` **không được commit** lên git (đã có trong `.gitignore`)
- Chạy `supabase_schema.sql` trong **Supabase SQL Editor** trước khi dùng
- API key Gemini có thể thêm qua `/api/admin/api-keys` sau khi login
- Mặc định lượt quét không được lưu thành mẫu (`STORE_SCAN_TEMPLATES=false`). Nếu bật lưu sau khi có cơ chế đồng ý và xóa dữ liệu, mọi mẫu mới có `is_approved=false` nhưng vẫn công khai ngay; `/api/admin/templates` dùng để cập nhật trạng thái kiểm duyệt.
