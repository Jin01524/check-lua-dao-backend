import { GoogleGenAI } from '@google/genai';

/**
 * Phân tích ảnh và/hoặc nội dung tin nhắn bằng Gemini AI để phát hiện lừa đảo.
 * Hỗ trợ đa phương thức: chỉ ảnh, chỉ văn bản, hoặc kết hợp cả hai.
 *
 * @param {Object} options
 * @param {Array}  options.imageFiles      - Mảng file objects từ multer (buffer, mimetype)
 * @param {string} options.textContent     - Văn bản/đường link tin nhắn bổ sung
 * @param {string} options.platform        - Tên nền tảng (SMS, Zalo, Facebook, Telegram, v.v.)
 * @param {string} options.apiKey          - Gemini API key
 * @param {Array}  options.fewShotExamples - Mảng mẫu lừa đảo đã duyệt từ DB
 * @returns {Object}                       - Kết quả phân tích JSON chuẩn hóa
 */
export async function analyzeContent({
  imageFiles = [],
  textContent = '',
  platform = 'Không xác định',
  apiKey,
  fewShotExamples = [],
}) {
  const ai = new GoogleGenAI({ apiKey });

  // ── Build image parts ──────────────────────────────────────────────────────
  const imageParts = (imageFiles || []).map((file) => ({
    inlineData: {
      mimeType: file.mimetype,
      data: file.buffer.toString('base64'),
    },
  }));

  // ── Build few-shot examples section ───────────────────────────────────────
  let fewShotSection = '';
  if (fewShotExamples && fewShotExamples.length > 0) {
    const examplesText = fewShotExamples
      .map((ex, idx) => {
        const messages = Array.isArray(ex.messages_json)
          ? ex.messages_json.map((m) => `  [${m.sender}]: ${m.text}`).join('\n')
          : '';
        return `Ví dụ ${idx + 1} - ${ex.title} (${ex.platform}):
Loại lừa đảo: ${ex.scam_type || 'Chưa phân loại'}
Nội dung hội thoại:
${messages}
Phân tích: ${ex.analysis || ''}`;
      })
      .join('\n\n---\n\n');

    fewShotSection = `
Dưới đây là một số ví dụ thực tế về các thủ đoạn lừa đảo đã được xác minh để đối chiếu:
---VÍ DỤ MẪU---
${examplesText}
---
`;
  }

  // ── Text Content Note ──────────────────────────────────────────────────────
  let textInputSection = '';
  if (textContent && textContent.trim()) {
    textInputSection = `
Người dùng có cung cấp thêm đoạn văn bản/URL nghi vấn đi kèm:
"""
${textContent.trim()}
"""
Hãy kết hợp phân tích kỹ lưỡng đoạn văn bản/URL này cùng với các hình ảnh đính kèm (nếu có).
`;
  }

  const hasImages = imageParts.length > 0;

  // ── Build full prompt ──────────────────────────────────────────────────────
  const prompt = `Bạn là chuyên gia giám định an ninh mạng và phân tích lừa đảo trực tuyến (Cyber Threat Intelligence Analyst) hàng đầu tại Việt Nam.

Thông tin đầu vào từ người dùng:
- Nền tảng ghi nhận: ${platform}
- Số lượng ảnh chụp màn hình: ${imageParts.length}
${textInputSection}
${fewShotSection}

NHIỆM VỤ GIÁM ĐỊNH:
1. Xác định tính hợp lệ của dữ liệu đầu vào:
   - Nếu có ảnh, kiểm tra xem ảnh có phải là ảnh chụp màn hình tin nhắn / giao diện chat / thông báo / trang web hay không.
   - Nếu hoàn toàn KHÔNG phải ảnh tin nhắn hoặc nội dung liên quan (ví dụ: ảnh động vật, phong cảnh, selfie, đồ gia dụng ngẫu nhiên), hãy đặt:
     "isChatScreenshot": false, "isScam": false, "scamType": null, "title": null, "confidenceScore": 0, "messages": [], "warningPoints": [], "recommendations": [], "extractedUrls": [],
     và "analysis": "Ảnh tải lên không hiển thị nội dung tin nhắn hoặc giao diện giao dịch cần kiểm tra. Vui lòng chụp lại màn hình rõ ràng hơn."
2. Nếu là nội dung tin nhắn / giao dịch / văn bản liên quan:
   - Đặt "isChatScreenshot": true.
   - Bóc tách toàn bộ hội thoại theo trình tự thời gian hợp lý.
     QUAN TRỌNG: Thay thế số điện thoại thực tế, số CCCD, số thẻ/tài khoản ngân hàng cụ thể bằng 'xxxx' để bảo vệ quyền riêng tư.
   - Đánh giá mức độ rủi ro (confidenceScore từ 0 đến 100):
     * 70 - 100: RỦI RO CỰC KỲ CAO / LỪA ĐẢO RÕ RÀNG (Giả mạo ngân hàng, dọa khóa tài khoản, link phishing, mạo danh cơ quan công an, tuyển dụng việc làm nạp tiền, v.v.)
     * 40 - 69: NGHI VẤN / DẤU HIỆU BẤT THƯỜNG
     * 0 - 39: AN TOÀN / KHÔNG PHÁT HIỆN DẤU HIỆU LỪA ĐẢO
   - Liệt kê các dấu hiệu nhận biết cốt lõi (warningPoints) ngắn gọn, đanh thép (ví dụ: "Tên miền giả mạo .vip thay vì cổng chính thức", "Thao túng tâm lý khẩn cấp đe dọa khóa tài khoản trong 24h", "Yêu cầu cung cấp mã OTP bí mật").
   - Đưa ra khuyến nghị an toàn tức thì (recommendations) cho nạn nhân.
   - Trích xuất các tên miền, liên kết hoặc số điện thoại đáng ngờ (extractedUrls).

TRẢ VỀ DUY NHẤT MỘT JSON OBJECT HỢP LỆ, KHÔNG CHỨA BẤT KỲ VĂN BẢN NÀO NGOÀI JSON:
{
  "isChatScreenshot": true,
  "isScam": true,
  "scamType": "Tên loại hình lừa đảo (ví dụ: Giả mạo ngân hàng Vietcombank chiếm đoạt mã OTP)",
  "title": "Tiêu đề ngắn gọn hồ sơ vụ việc",
  "confidenceScore": 94,
  "analysis": "Phân tích chi tiết thủ đoạn tấn công và cơ chế thao túng tâm lý",
  "warningPoints": [
    "Dấu hiệu cảnh báo 1",
    "Dấu hiệu cảnh báo 2"
  ],
  "recommendations": [
    "Khuyến nghị 1",
    "Khuyến nghị 2"
  ],
  "extractedUrls": [
    "vcb-digi-bank.vip"
  ],
  "messages": [
    {"sender": "scammer", "text": "Nội dung tin nhắn đã khử nhạy cảm"}
  ]
}`;

  // ── Call Gemini API with Fallback Models ────────────────────────────────────
  const candidateModels = [
    process.env.GEMINI_MODEL,
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ].filter(Boolean);

  let lastModelError = null;
  let response = null;

  for (const modelName of candidateModels) {
    try {
      response = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [...imageParts, { text: prompt }],
          },
        ],
      });
      if (response && response.text) break;
    } catch (err) {
      lastModelError = err;
      console.warn(`[GeminiService] Model ${modelName} failed, trying next:`, err.message);
    }
  }

  if (!response || !response.text) {
    throw lastModelError || new Error('Không nhận được phản hồi từ AI Gemini');
  }

  const rawText = response.text;

  // ── Parse JSON response ────────────────────────────────────────────────────
  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    return {
      isChatScreenshot: parsed.isChatScreenshot ?? true,
      isScam: Boolean(parsed.isScam),
      scamType: parsed.scamType || null,
      title: parsed.title || null,
      confidenceScore: typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0,
      analysis: parsed.analysis || '',
      warningPoints: Array.isArray(parsed.warningPoints) ? parsed.warningPoints : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      extractedUrls: Array.isArray(parsed.extractedUrls) ? parsed.extractedUrls : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch (parseError) {
    console.error('[GeminiService] Failed to parse JSON from AI response:', rawText);
    throw new Error('Dữ liệu phân tích từ AI không đúng định dạng JSON chuẩn');
  }
}

// Backward compatibility alias
export async function analyzeImages(imageFiles, platform, apiKey, fewShotExamples = []) {
  return analyzeContent({
    imageFiles,
    platform,
    apiKey,
    fewShotExamples,
  });
}
