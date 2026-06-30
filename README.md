# CheckLuaDao - Backend

Backend API cho ứng dụng kiểm tra tin nhắn lừa đảo, sử dụng Node.js + Express + Supabase + Google Gemini AI.

## 📋 Yêu cầu hệ thống

- Node.js >= 18.x
- npm >= 9.x

## 🚀 Cài đặt và chạy

### 1. Cài đặt dependencies

```bash
cd backend
npm install
```

### 2. Cấu hình biến môi trường

File `.env` đã được tạo sẵn với các giá trị mặc định. Kiểm tra và chỉnh sửa nếu cần:

```env
PORT=5000
SUPABASE_URL=https://eesmptzrdlcdzdygblfm.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
GEMINI_API_KEY=...
JWT_SECRET=checkluadao_jwt_secret_2024_very_long_random_string
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=...   # bcrypt hash của password admin
```

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
| `POST` | `/api/check` | Phân tích ảnh (multipart) |
| `GET`  | `/api/templates` | Danh sách mẫu đã duyệt |
| `GET`  | `/api/templates/:id` | Chi tiết mẫu đã duyệt |

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
  -d '{"username": "admin", "password": "admin@checkluadao2024"}'
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
    └── geminiService.js    # Gemini AI integration
```

---

## ⚠️ Lưu ý

- File `.env` **không được commit** lên git (đã có trong `.gitignore`)
- Chạy `supabase_schema.sql` trong **Supabase SQL Editor** trước khi dùng
- API key Gemini có thể thêm qua `/api/admin/api-keys` sau khi login
- Mẫu lừa đảo khi phát hiện sẽ được lưu với `is_approved=false`, admin cần duyệt qua `/api/admin/templates`
