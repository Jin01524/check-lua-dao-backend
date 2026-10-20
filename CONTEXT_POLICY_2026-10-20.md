# Chính sách nhận định thiếu ngữ cảnh — 20/10/2026

Phiên bản prompt: `context-2026-10-20`. Áp dụng tại backend chung cho app, overlay và web; giữ định dạng API hiện có.

## Nguyên nhân được xử lý

- Quy tắc cũ chỉ chắc chắn giữ câu ngắn ở trạng thái thiếu ngữ cảnh khi tối đa 12 từ và mô hình tách ít tin. Câu mở lời nhắc quen biết dài hơn ngưỡng đó phụ thuộc vào `isScam`, điểm và cách tách tin do mô hình trả về.
- Nhánh `isScam=true` chạy trước đánh giá thiếu ngữ cảnh nên một dự đoán thiếu bằng chứng có thể thành cảnh báo. JSON minh họa trong prompt cũ còn neo sẵn điểm 5 và câu hỏi chung chung.
- Đầu vào và chỉ dẫn nằm cùng một chuỗi; kết quả chưa có schema ràng buộc kiểu dữ liệu. Tập ví dụ tham chiếu chưa có thứ tự chọn ổn định.

## Quy trình mới

1. Ưu tiên yêu cầu nguy hiểm cụ thể: OTP/mật khẩu, chuyển tiền đáng ngờ, link dẫn dụ, APK, đe dọa. Không trì hoãn cảnh báo vì thiếu danh tính.
2. Nhận diện các khoảng trống rõ trong nội dung gốc: gợi nhớ quen biết chưa nói tên/mục đích; mở lời tuyển dụng chưa nêu vị trí hoặc đơn vị. Những tín hiệu này không phụ thuộc cách mô hình tách messages hay điểm mô hình đoán.
3. Nội dung mở lời trung tính như ví dụ họp lớp giữ `insufficient_context`, điểm null. Phần công khai được đồng bộ trạng thái, lý do và gợi ý; không còn kèm phân tích khẳng định rủi ro hoặc an toàn mâu thuẫn.
4. Đánh giá các nội dung khác theo mô hình và các kiểm tra nhất quán hiện có. Bỏ quy tắc ép thiếu ngữ cảnh chỉ dựa số từ; hẹn họp, lời cảm ơn, lời khuyên không gửi OTP có thể đủ nội dung dù ngắn.
5. Gợi ý hỏi đúng một điều chưa biết. Đã nói tên thì hỏi mục đích; chưa có vai trò tuyển dụng thì hỏi vị trí; đã có vị trí nhưng chưa rõ đơn vị thì hỏi công ty. Câu hỏi không xin bí mật xác thực, hồ sơ cá nhân hay gợi ý làm theo yêu cầu nguy hiểm.
6. Prompt dùng system instruction riêng, nội dung/OCR/ví dụ nằm trong JSON dữ liệu. Schema quy định boolean, điểm nguyên hoặc null, trạng thái sufficient/insufficient và ba phần phân tích.
7. Chọn ví dụ theo thứ tự id ổn định, giới hạn độ dài. API trả thêm `analysisModel` và `analysisPolicyVersion` để truy vết thay đổi mô hình/prompt.

Lượt thiếu ngữ cảnh tiếp tục không lưu mẫu, scan_logs, phiên chờ hay phản hồi cache. Khi có thêm tin, quét toàn bộ hội thoại như một lượt mới.

## Kiểm chứng

- `node --test`: 33 ca đạt, gồm 22 ca có sẵn và 11 ca bổ sung.
- Ca họp lớp được kiểm tra với 192 tổ hợp phản hồi mô hình giả lập: true/false, các điểm cao/thấp/null, sufficient/insufficient, tách 0/1/5 messages và cờ nhận diện ảnh. Cả 192 giữ thiếu ngữ cảnh, không có điểm và không ghi dữ liệu. Đây là kiểm thử quy tắc hậu xử lý, không phải 192 lần gọi AI thật.
- Đối chiếu lời mở đầu có thêm OTP/link/APK, tin không dấu, lời nhắc phòng tránh, hẹn họp, cảm ơn, thông tin tuyển dụng đủ/thiếu và đầu vào không phải tin nhắn.
- `node scripts/evaluate-context.mjs` tái hiện sự dao động trạng thái của mã cũ bằng phản hồi mô hình giả lập.
- `node scripts/evaluate-context.mjs --live` gọi API công khai với clientRequestId mới cho mỗi lượt; kết quả và thời gian được lưu trong `../outputs/context-eval-2026-10-20`. Có thể chọn `--only=reunion-1,otp-risk` để kiểm tra một nhóm.

## Tham khảo và giới hạn

- [Google: Gemini 3 developer guide](https://ai.google.dev/gemini-api/docs/gemini-3) khuyến nghị giữ temperature 1.0 cho Gemini 3. Cấu hình giữ giá trị này; nhánh 2.5 dùng temperature 0. Không coi nhiệt độ thấp là bảo đảm kết luận giống hệt.
- [Google: Structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) hướng dẫn JSON Schema; schema giúp giữ cấu trúc, không bảo đảm nội dung suy luận đúng.
- Các quy tắc nội dung bổ sung bao phủ nhóm mở lời được xác định, không thay thế khả năng hiểu mọi tình huống của mô hình. Kết quả kiểm thử được báo theo bộ ca và số lượt thực sự chạy; không khẳng định độ chính xác tuyệt đối cho mọi tin nhắn.
