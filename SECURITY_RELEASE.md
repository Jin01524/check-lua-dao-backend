# Checklist triển khai bản backend cho Flutter

Bản local cho phép API public đọc cả mẫu đã và chưa kiểm duyệt, trả `is_approved` để giao diện gắn nhãn. Đây là quyết định sản phẩm ngày 29/09/2026; cần kiểm tra dữ liệu đang có trước khi triển khai lên Render.

## Kiểm tra Supabase trực tiếp ngày 29/09/2026 (chỉ đọc)

- Project trong `../supabase.txt` có 33 mẫu `is_approved=true` và 7 mẫu `false`. Cả 7 mẫu chưa duyệt đều có `messages_json` không rỗng.
- Truy vấn `../AUDIT_PENDING_TEMPLATES.sql` gắn cờ 3 mẫu có từ khóa giống OTP/mật khẩu, 1 mẫu có dãy 9–12 chữ số giống số điện thoại/tài khoản, 0 mẫu khớp mẫu email. Cờ chỉ là sàng lọc; cần xem riêng cả 7 mẫu để phát hiện tên, địa chỉ và dữ liệu nhạy cảm khác. Chưa thay đổi bản ghi nào.
- Đã xem bản hội thoại/phân tích được che số và liên kết của cả 7 mẫu. Các tình huống đều mang tiêu đề và nội dung cảnh báo chung; một bản phân tích có số liên hệ 10 chữ số. Backend local hiện che số liên hệ/email/mã xác thực trong phản hồi public, nhưng bản Render đang chạy chưa có lớp che này. Không coi regex là thay thế cho kiểm duyệt thủ công dữ liệu mới.
- Bảng `users` có 2 tài khoản (1 admin, 1 user), đều có `password_hash`; cột `password_display` không còn. Trước migration, bảng `users` thiếu `is_active`, `system_stats` thiếu `active_model` và `scam_templates` thiếu các cột phân tích mới.
- Trước migration, RLS đã bật và không có policy public, nhưng `anon`/`authenticated` vẫn có quyền `SELECT` ở cấp bảng. Sau migration, quyền `SELECT` trực tiếp của hai role này đã được thu hồi trên cả 5 bảng.
- Supabase CLI không liệt kê bản sao lưu vật lý cho project. Đã tạo và giải mã kiểm tra thành công bản sao dữ liệu của 5 bảng bằng Windows DPAPI tại `%LOCALAPPDATA%\CheckLuaDao\backups\p0-supabase-20260929-010741.dpapi`. Bản này chỉ mở được bằng tài khoản Windows hiện tại, không phải bản sao lưu PostgreSQL đầy đủ (schema/roles/extensions vẫn cần migration và cấu hình Supabase). Không đưa file vào Git.
- Đã áp dụng `MIGRATION_P0_2026_09_29.sql` trên project thật và kiểm tra các cột, RLS, quyền `anon`/`authenticated`; 40 mẫu vẫn nguyên. Cột `confidence_score` làm bản backend Render cũ trả danh sách rỗng vì điểm cũ đều `NULL`, nên đã hoàn tác riêng cột này bằng `ROLLBACK_LEGACY_CONFIDENCE_COLUMN.sql`. Danh sách Render đã trở lại 21 mẫu (7 chưa duyệt). Chỉ thêm lại cột bằng `MIGRATION_P0_POST_BACKEND.sql` sau khi backend mới chạy ổn.

## Trước khi triển khai

1. Trong Render, xác nhận `JWT_SECRET` là giá trị ngẫu nhiên dài, `ADMIN_USERNAME` đúng tài khoản quản trị và `ADMIN_PASSWORD_HASH` là bcrypt hash của mật khẩu riêng tối thiểu 12 ký tự. Không đặt mật khẩu hoặc hash vào Git.
2. Xoay khóa Gemini từng xuất hiện trong lịch sử/schema cũ, rồi cập nhật biến môi trường hoặc bản ghi `api_keys` tương ứng. Kiểm tra quyền truy cập Supabase service role key; không đưa khóa này vào app Flutter/web.
3. Sao lưu Supabase trước migration. Kiểm tra tài khoản trong `users` có `password_hash` hợp lệ; sau sửa backend không còn cơ chế đăng nhập bằng mật khẩu mặc định.
4. Rà toàn bộ mẫu chưa duyệt đang có trong Supabase, xóa hoặc che thông tin cá nhân/OTP trước khi triển khai vì chúng sẽ được công khai. Duyệt chính sách đồng ý lưu, thời hạn giữ và xóa nội dung quét trước khi cân nhắc bật `STORE_SCAN_TEMPLATES`. Giữ giá trị mặc định `false` khi chưa có chính sách.

## Trình tự

1. Migration trước deploy đã áp dụng: thêm các cột tương thích ngoại trừ `confidence_score`, bật RLS và thu hồi quyền trực tiếp `anon`/`authenticated`. `supabase_schema.sql` là bản schema tổng hợp dành cho thiết lập mới.
2. Triển khai backend đã sửa lên Render với `STORE_SCAN_TEMPLATES=false`. Kiểm tra danh sách/chi tiết mẫu ngay khi backend mới chạy, sau đó áp dụng `MIGRATION_P0_POST_BACKEND.sql` và kiểm tra lại. Khách truy cập không có giới hạn lượt quét ở tầng ứng dụng; theo dõi chi phí Gemini và năng lực máy chủ.
3. Triển khai frontend đã bỏ hiển thị mật khẩu sau backend; kiểm tra trang quản trị, phân quyền và đăng nhập bằng tài khoản mới.
4. Chỉ bật `BACKEND_PRIVACY_READY=true` khi build Flutter release sau khi các phép kiểm dưới đây đạt.

## Kiểm tra sau triển khai

- `GET /api/health` trả `status=ok`.
- `GET /api/templates` và `GET /api/templates/:id` trả cả mẫu `is_approved=true/false` với trạng thái chính xác; giao diện web/Flutter gắn nhãn kiểm duyệt.
- Mật khẩu mặc định cũ không đăng nhập được; admin đúng mật khẩu vào được; token role `user` không truy cập `/api/admin/active-model`.
- Quét bằng **dữ liệu giả lập** trả kết quả nhưng `savedTemplateId=null` khi `STORE_SCAN_TEMPLATES=false`. Không thử bằng tin nhắn cá nhân.
- `/api/stats` phản ánh `scan_logs`; không còn số lượt quét giả từ mẫu có sẵn.
- Khách truy cập có thể gửi nhiều lượt quét liên tiếp mà không gặp giới hạn lượt quét do ứng dụng áp đặt.

Không bật phát hành công khai chỉ dựa vào test local: cần xác nhận các phép kiểm trên chính bản Render vừa triển khai và kiểm tra schema trong đúng project Supabase.
