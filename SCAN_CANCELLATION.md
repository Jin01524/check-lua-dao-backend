# Hủy lượt quét khi đóng lớp phủ

Cập nhật 16/10/2026, app 1.2.2+8.

- Khi app ngắt HTTP, các endpoint quét nhận `res.close` trước `writableEnded` và hủy AbortController của lượt đó.
- Truy vấn chuẩn bị và ghi Supabase nhận cùng AbortSignal. Hàng đợi OCR bỏ job đã hủy; nếu đang OCR thì dừng worker của job hiện tại và tạo worker mới cho lượt kế tiếp, không hủy job khác đang chạy.
- Kết nối Gemini nhận AbortSignal, không thử model/key tiếp theo sau khi hủy. Pipeline kiểm tra hủy trước khi lưu mẫu hoặc thống kê; yêu cầu v2 đã hủy được dọn khỏi bộ nhớ chống gửi lặp.
- Áp dụng cho API v2, legacy và endpoint continue tương thích cũ.

Kiểm thử: `node --test` đạt 22 ca, trong đó 7 ca mới kiểm tra ngắt kết nối thật, hoàn tất phản hồi bình thường, hủy OCR đang chạy/đang đợi, không ghi dữ liệu sau hủy, không chạy bước thống kê sau hủy và không thử model khác.

Giới hạn: AbortSignal của Google GenAI chỉ hủy chờ/kết nối phía client; theo mô tả trong SDK, tác vụ đã tới dịch vụ Google vẫn có thể được xử lý và tính phí. Không thể thu hồi một thao tác cơ sở dữ liệu đã hoàn tất trước thời điểm hủy.
