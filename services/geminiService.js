import { GoogleGenAI } from '@google/genai';

/**
 * Danh sách model Gemini Flash được hỗ trợ từ 2.5 Flash đến 3.5 Flash (KHÔNG dùng dòng Lite)
 * Ưu tiên mặc định: gemini-3.5-flash
 */
export const SUPPORTED_MODELS = [
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    badge: 'Khuyên dùng',
    description: 'Thế hệ mới nhất, tối ưu lý luận an ninh mạng, phản hồi tức thì và chính xác cao.',
    isDefault: true,
  },
  {
    id: 'gemini-3.0-flash',
    name: 'Gemini 3.0 Flash',
    badge: 'Tốc độ cao',
    description: 'Cân bằng tối ưu giữa tốc độ phân tích và khả năng phát hiện thủ đoạn tinh vi.',
    isDefault: false,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    badge: 'Chuyên sâu',
    description: 'Xử lý ổn định cao, nhận diện cấu trúc lừa đảo và tin nhắn mẫu chuẩn xác.',
    isDefault: false,
  },
];

// Lưu model active trong bộ nhớ để phản hồi realtime 0ms cho toàn hệ thống
let activeGeminiModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

export function getActiveGeminiModel() {
  return activeGeminiModel;
}

export function setActiveGeminiModel(modelId) {
  const exists = SUPPORTED_MODELS.some((m) => m.id === modelId);
  if (!exists) {
    throw new Error(`Model "${modelId}" không hợp lệ. Chỉ hỗ trợ các model Flash từ 2.5 đến 3.5 (không dùng Lite).`);
  }
  activeGeminiModel = modelId;
  console.log(`[GeminiService] Realtime active model switched to: ${activeGeminiModel}`);
  return activeGeminiModel;
}

// Khởi tạo model đã lưu từ DB khi server khởi động (nếu có)
export async function initActiveModelFromDB() {
  try {
    const { getSupabaseClient } = await import('../lib/supabase.js');
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('system_stats')
      .select('active_model')
      .eq('id', 'global')
      .maybeSingle();

    if (data?.active_model && SUPPORTED_MODELS.some((m) => m.id === data.active_model)) {
      activeGeminiModel = data.active_model;
      console.log(`[GeminiService] Initialized active model from DB: ${activeGeminiModel}`);
    }
  } catch (err) {
    // Graceful fallback nếu Supabase chưa có cột
  }
}
initActiveModelFromDB().catch(() => {});

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
  safeExamples = [],
}) {
  const ai = new GoogleGenAI({ apiKey });

  // ── Build image parts ──────────────────────────────────────────────────────
  const imageParts = (imageFiles || []).map((file) => ({
    inlineData: {
      mimeType: file.mimetype,
      data: file.buffer.toString('base64'),
    },
  }));

  // ── Build few-shot examples section (mẫu lừa đảo đối chiếu) ────────────────
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
---VÍ DỤ MẪU LỪA ĐẢO---
${examplesText}
---
`;
  }

  // ── Build safe examples section (mẫu an toàn để AI đối chiếu phân biệt) ────
  let safeExamplesSection = '';
  if (safeExamples && safeExamples.length > 0) {
    const safeText = safeExamples
      .map((ex, idx) => {
        const messages = Array.isArray(ex.messages_json)
          ? ex.messages_json.map((m) => `  [${m.sender}]: ${m.text}`).join('\n')
          : '';
        return `Mẫu an toàn ${idx + 1} - ${ex.title} (${ex.platform}):
Nội dung hội thoại:
${messages}
Nhận định an toàn: ${ex.analysis || 'Tin nhắn hợp lệ, không có dấu hiệu lừa đảo'}`;
      })
      .join('\n\n---\n\n');

    safeExamplesSection = `
Dưới đây là các ví dụ về tin nhắn AN TOÀN / BÌNH THƯỜNG được hệ thống lưu trữ để đối chiếu (giúp tránh đánh giá nhầm):
---VÍ DỤ TIN NHẮN AN TOÀN ĐỐI CHIẾU---
${safeText}
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

  // ── Build full prompt (Kiến trúc Đa Tác Tử Phản Biện & Ma Trận Kênh Chiếm Đoạt) ──
  const prompt = `Bạn là hệ thống AI Giám định An ninh mạng đa tác tử chuyên sâu (Cyber Threat Multi-Agent Deliberation System) tại Việt Nam.

Thông tin đầu vào:
- Nền tảng ghi nhận: ${platform}
- Số lượng ảnh chụp màn hình: ${imageParts.length}
${textInputSection}
${fewShotSection}
${safeExamplesSection}

======================================================================
QUY TRÌNH TRANH LUẬN ĐA TÁC TỬ (MULTI-AGENT DELIBERATION PIPELINE):
Hệ thống vận hành thông qua sự phản biện giữa 3 tác tử AI logic chuyên biệt:

1. TÁC TỬ 1 - THREAT HUNTER (Săn tìm rủi ro & thao túng tâm lý):
   - Đóng vai trò Red Team / Hunter: Quét tìm các từ khóa rủi ro, yếu tố kích động tâm lý khẩn cấp, sợ hãi, lòng tham, giả mạo danh xưng ngân hàng/công an/nhà mạng.

2. TÁC TỬ 2 - VERIFICATION AUDITOR (Phản biện độc lập & Kiểm định kênh chiếm đoạt):
   - Đóng vai trò Devil's Advocate / Blue Team: Tìm kiếm các bằng chứng chứng minh tin nhắn có thể là hợp lệ, ngăn chặn BÁO ĐỘNG GIẢ (False Positive).
   - KIỂM ĐỊNH MA TRẬN KÊNH CHIẾM ĐOẠT (EXFILTRATION VECTOR MATRIX):
     Để một vụ lừa đảo trực tuyến chiếm đoạt tài sản xảy ra, kẻ gian BẮT BUỘC phải cung cấp Kênh Chiếm Đoạt từ xa (Exfiltration Vector). Chọn chính xác 1 trong các giá trị sau:
     * "none": KHÔNG CÓ KÊNH CHIẾM ĐOẠT TỪ XA. (Ví dụ: Thông báo hướng dẫn khách hàng đến quầy giao dịch vật lý, nhắc nhở định kỳ không kèm link/yêu cầu tiền).
     * "phishing_link": Chứa liên kết, website, tên miền lạ hoặc rút gọn để lừa đăng nhập/đánh cắp thông tin.
     * "otp_theft": Yêu cầu cung cấp mã OTP, mã xác thực Smart OTP, mật khẩu, thông tin thẻ/tài khoản.
     * "money_transfer": Yêu cầu chuyển tiền, nộp lệ phí, nộp tiền bảo lãnh vào tài khoản cá nhân.
     * "apk_malware": Dụ dỗ cài đặt ứng dụng ngoài (file .apk), dịch vụ công giả mạo, quét mã QR cài mã độc.
     * "unauthorized_contact": Yêu cầu gọi vào số hotline lạ hoặc kết bạn Zalo/Telegram cá nhân không chính thức.

   - NGUYÊN TẮC VÀNG VỀ QUẦY GIAO DỊCH VẬT LÝ (PHYSICAL COUNTER AXIOM):
     * Kẻ lừa đảo KHÔNG BAO GIỜ yêu cầu nạn nhân mang giấy tờ đến trực tiếp quầy giao dịch/phòng giao dịch ngân hàng hoặc trụ sở công an để làm việc mà KHÔNG kèm bất kỳ liên kết, số điện thoại lạ, đòi chuyển tiền hay OTP nào.
     * Nếu tin nhắn chỉ mang tính chất thông báo: Yêu cầu khách hàng đến trực tiếp chi nhánh/phòng giao dịch ngân hàng (ví dụ: MB Bank, Vietcombank, Techcombank...) để tra soát giao dịch bất thường hoặc cập nhật sinh trắc học mà KHÔNG có link lạ, KHÔNG đòi OTP, KHÔNG đòi chuyển tiền -> ĐÂY LÀ NGHIỆP VỤ BÌNH THƯỜNG CỦA NGÂN HÀNG (AN TOÀN TUYỆT ĐỐI).
     * BẮT BUỘC: Khi exfiltrationVector là "none" và nội dung hướng dẫn ra quầy vật lý, confidenceScore PHẢI nằm trong khoảng 0 - 15%, isScam = false! Tuyệt đối không được gán nhãn lừa đảo chỉ vì có từ khóa "Ngân hàng", "giao dịch bất thường" hay "tra soát".

3. TÁC TỬ 3 - CONSENSUS ARBITER (Trọng tài tối cao & Phán quyết đồng thuận):
   - Cân nhắc lập luận giữa Hunter và Auditor.
   - Nếu Hunter cảnh báo từ khóa nhưng Auditor chứng minh không có kênh chiếm đoạt ("none") và hướng dẫn ra quầy vật lý -> Phán quyết: AN TOÀN (Gỡ cảnh báo sai lệch).
   - Nếu có Kênh Chiếm Đoạt rõ ràng -> Phán quyết: LỪA ĐẢO / RỦI RO CAO.

======================================================================
QUY CHUẨN ĐẦU VÀO:
- Nếu ảnh hoàn toàn KHÔNG phải ảnh tin nhắn/thông báo (ảnh phong cảnh, đồ vật, selfie...):
  "isChatScreenshot": false, "isScam": false, "scamType": null, "title": null, "confidenceScore": 0, "exfiltrationVector": "none", "messages": [], "warningPoints": [], "recommendations": [], "extractedUrls": [],
  "analysis": "Ảnh tải lên không hiển thị nội dung tin nhắn hoặc giao diện giao dịch cần kiểm tra. Vui lòng chụp lại màn hình rõ ràng hơn."
- Nếu là tin nhắn/giao diện giao dịch/văn bản:
  "isChatScreenshot": true.
  Bóc tách hội thoại, thay thế số điện thoại thật, CCCD, STK bằng 'xxxx' để bảo mật.

TRẢ VỀ DUY NHẤT MỘT JSON OBJECT HỢP LỆ, KHÔNG CHỨA BẤT KỲ VĂN BẢN NÀO NGOÀI JSON:
{
  "isChatScreenshot": true,
  "isScam": false,
  "scamType": "Tên loại lừa đảo nếu có, nếu an toàn thì ghi null",
  "title": "Tiêu đề hồ sơ thẩm định",
  "attackTarget": "Mục tiêu tấn công (hoặc 'Không có' nếu an toàn)",
  "confidenceScore": 5,
  "exfiltrationVector": "none",
  "multiAgentDebate": {
    "threatHunterAnalysis": "Nhận định ngắn gọn của Tác tử Săn tìm Rủi ro về từ khóa và ngữ cảnh",
    "auditorDefense": "Lý lẽ phản biện của Tác tử Kiểm định về sự tồn tại của Kênh chiếm đoạt và tính hợp pháp",
    "arbiterVerdict": "Phán quyết đồng thuận cuối cùng của Trọng tài AI giải thích rõ ràng tại sao an toàn hoặc lừa đảo"
  },
  "analysis": "Phân tích tổng hợp ngắn gọn, khách quan, súc tích",
  "warningPoints": [
    "Dấu hiệu cảnh báo nếu có"
  ],
  "recommendations": [
    "Khuyến nghị hành động thiết thực cho người dùng"
  ],
  "extractedUrls": [],
  "messages": [
    {"sender": "Tên người gửi", "text": "Nội dung tin nhắn đã khử nhạy cảm"}
  ]
}`;

  // ── Call Gemini API (Flash models 2.5 - 3.5, ưu tiên activeGeminiModel và 3.5 Flash trước) ──
  const active = getActiveGeminiModel();
  const candidateModels = [
    active,
    'gemini-3.5-flash',
    'gemini-3.0-flash',
    'gemini-2.5-flash',
    'gemini-3.5-flash-preview',
    'gemini-3.0-flash-preview',
    'gemini-2.5-flash-preview',
  ].filter(Boolean);

  const uniqueModels = [...new Set(candidateModels)];

  let lastModelError = null;
  let response = null;

  for (const modelName of uniqueModels) {
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

    const validVectors = ['none', 'phishing_link', 'otp_theft', 'money_transfer', 'apk_malware', 'unauthorized_contact'];
    const exfiltrationVector = validVectors.includes(parsed.exfiltrationVector)
      ? parsed.exfiltrationVector
      : (parsed.isScam ? 'phishing_link' : 'none');

    const multiAgentDebate = {
      threatHunterAnalysis: parsed.multiAgentDebate?.threatHunterAnalysis || 'Đã phân tích các chỉ số rủi ro ngôn ngữ và tâm lý.',
      auditorDefense: parsed.multiAgentDebate?.auditorDefense || 'Đã kiểm tra ma trận kênh chiếm đoạt dữ liệu và tài sản.',
      arbiterVerdict: parsed.multiAgentDebate?.arbiterVerdict || 'Đạt đồng thuận phán quyết an toàn an ninh mạng.',
    };

    return {
      isChatScreenshot: parsed.isChatScreenshot ?? true,
      isScam: Boolean(parsed.isScam),
      scamType: parsed.scamType || null,
      title: parsed.title || null,
      attackTarget: (parsed.attackTarget && String(parsed.attackTarget).trim()) || 'Không rõ',
      confidenceScore: typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0,
      exfiltrationVector,
      multiAgentDebate,
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
