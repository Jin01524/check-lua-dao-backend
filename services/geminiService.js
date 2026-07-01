import { GoogleGenAI } from '@google/genai';

/**
 * Phân tích ảnh tin nhắn bằng Gemini AI để phát hiện lừa đảo.
 *
 * @param {Array} imageFiles    - Mảng file objects từ multer (có buffer, mimetype)
 * @param {string} platform     - Tên nền tảng (Zalo, Facebook, SMS, v.v.)
 * @param {string} apiKey       - Gemini API key lấy từ DB
 * @param {Array} fewShotExamples - Mảng mẫu lừa đảo đã duyệt từ DB
 * @returns {Object}            - Kết quả phân tích JSON
 */
export async function analyzeImages(imageFiles, platform, apiKey, fewShotExamples = []) {
  const ai = new GoogleGenAI({ apiKey });

  // ── Build image parts ──────────────────────────────────────────────────────
  const imageParts = imageFiles.map((file) => ({
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
          ? ex.messages_json
              .map((m) => `  [${m.sender}]: ${m.text}`)
              .join('\n')
          : '';
        return `Ví dụ ${idx + 1} - ${ex.title} (${ex.platform}):
Loại lừa đảo: ${ex.scam_type || 'Chưa phân loại'}
Nội dung hội thoại:
${messages}
Phân tích: ${ex.analysis || ''}`;
      })
      .join('\n\n---\n\n');

    fewShotSection = `
Dưới đây là ví dụ về các mẫu lừa đảo đã được xác nhận để tham khảo:
---VÍ DỤ MẪU---
${examplesText}
---
`;
  }

  // ── Build full prompt ──────────────────────────────────────────────────────
  const prompt = `Bạn là chuyên gia phân tích bảo mật người Việt Nam, chuyên phát hiện tin nhắn lừa đảo.

Người dùng đã gửi ${imageFiles.length} ảnh chụp màn hình tin nhắn từ nền tảng: ${platform || 'Không xác định'}.
Các ảnh có thể bị thiếu hoặc thứ tự lộn xộn - hãy sắp xếp lại theo trình tự thời gian hợp lý.
${fewShotSection}
Nhiệm vụ của bạn:
1. Xác định xem ảnh tải lên có phải là ảnh chụp màn hình tin nhắn/giao diện trò chuyện (chat screenshot) hay không.
   Nếu KHÔNG phải là ảnh chụp màn hình tin nhắn (ví dụ: ảnh chụp phong cảnh, đồ vật, người, quạt điện, v.v.), hãy đặt "isChatScreenshot": false, "isScam": false, "scamType": null, "title": null, "confidenceScore": 0, "messages": [], "warningPoints": [], và trường "analysis" chỉ cần ghi duy nhất nội dung là: "Có vẻ ảnh bạn tải lên không phải là ảnh chụp tin nhắn" mà không đưa ra bất kỳ phân tích hay văn bản dài dòng nào khác.
2. Nếu ĐÚNG là ảnh chụp màn hình tin nhắn:
   - Đặt "isChatScreenshot": true.
   - Phân tích toàn bộ ảnh, sắp xếp lại cuộc hội thoại theo đúng thứ tự.
   - Xác định đây có phải tin nhắn lừa đảo không.
   - Nếu là lừa đảo: trích xuất toàn bộ nội dung tin nhắn.
     QUAN TRỌNG: Thay thế số điện thoại, số tài khoản ngân hàng, địa chỉ nhà cụ thể bằng 'xxxx'.
   - Đặt tiêu đề mô tả loại hình lừa đảo bằng tiếng Việt.
   - Phân tích các dấu hiệu nhận biết bằng tiếng Việt thông dụng, dễ hiểu.

TRẢ VỀ DUY NHẤT một JSON object hợp lệ, không có text thừa, không có markdown code block:
{
  "isChatScreenshot": true hoặc false,
  "isScam": true hoặc false,
  "scamType": "tên loại hình lừa đảo hoặc null",
  "title": "Tiêu đề mẫu tin nhắn hoặc null",
  "confidenceScore": số từ 0-100,
  "analysis": "Phân tích chi tiết bằng ngôn ngữ đơn giản dễ hiểu hoặc thông báo nếu không phải ảnh chat",
  "warningPoints": ["dấu hiệu 1", "dấu hiệu 2"],
  "messages": [
    {"sender": "scammer" hoặc "user" hoặc "unknown", "text": "nội dung tin nhắn"}
  ]
}`;

  // ── Call Gemini API ────────────────────────────────────────────────────────
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: [
      {
        role: 'user',
        parts: [...imageParts, { text: prompt }],
      },
    ],
  });

  const rawText = response.text;

  // ── Parse JSON response ────────────────────────────────────────────────────
  try {
    // Loại bỏ markdown code block nếu AI vẫn thêm vào
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    // Validate required fields
    if (typeof parsed.isScam !== 'boolean') {
      throw new Error('Missing or invalid "isScam" field');
    }

    return {
      isChatScreenshot: typeof parsed.isChatScreenshot === 'boolean' ? parsed.isChatScreenshot : true,
      isScam: parsed.isScam,
      scamType: parsed.scamType || null,
      title: parsed.title || null,
      confidenceScore: typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0,
      analysis: parsed.analysis || '',
      warningPoints: Array.isArray(parsed.warningPoints) ? parsed.warningPoints : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch (parseError) {
    console.error('[GeminiService] Failed to parse AI response:', parseError.message);
    console.error('[GeminiService] Raw response:', rawText);
    throw new Error(`AI response parsing failed: ${parseError.message}`);
  }
}
