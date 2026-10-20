import { GoogleGenAI } from '@google/genai';
import { completeMultiAgentDebate } from '../lib/multiAgentDebate.js';
import { abortable } from '../lib/scanCancellation.js';
import { ANALYSIS_POLICY_VERSION, ANALYSIS_SCHEMA, buildAnalysisPrompt } from './analysisPrompt.js';

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
const modelUnavailableUntil = new Map();

export function getActiveGeminiModel() {
  return activeGeminiModel;
}

export function setActiveGeminiModel(modelId) {
  const exists = SUPPORTED_MODELS.some((m) => m.id === modelId);
  if (!exists) {
    throw new Error(`Model "${modelId}" không hợp lệ. Chỉ hỗ trợ các model Flash từ 2.5 đến 3.5 (không dùng Lite).`);
  }
  activeGeminiModel = modelId;
  modelUnavailableUntil.delete(modelId);
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
 * Phân tích văn bản người dùng nhập và văn bản OCR bằng Gemini AI.
 *
 * @param {Object} options
 * @param {string} options.textContent     - Văn bản/đường link tin nhắn và kết quả OCR
 * @param {number} options.imageCount      - Số ảnh đã OCR
 * @param {string} options.platform        - Tên nền tảng (SMS, Zalo, Facebook, Telegram, v.v.)
 * @param {string} options.apiKey          - Gemini API key
 * @param {Array}  options.fewShotExamples - Mảng mẫu lừa đảo đã duyệt từ DB
 * @returns {Object}                       - Kết quả phân tích JSON chuẩn hóa
 */
export async function analyzeContent({
  textContent = '',
  imageCount = 0,
  platform = 'Không xác định',
  apiKey,
  fewShotExamples = [],
  safeExamples = [],
  signal,
}) {
  signal?.throwIfAborted();
  const ai = new GoogleGenAI({ apiKey });

  const prompt = buildAnalysisPrompt({
    textContent, platform, imageCount, fewShotExamples, safeExamples,
  });

  // ── Call Gemini API (Flash models 2.5 - 3.5, ưu tiên activeGeminiModel và 3.5 Flash trước) ──
  const active = getActiveGeminiModel();
  const candidateModels = [active, 'gemini-3.5-flash', 'gemini-2.5-flash'].filter(Boolean);

  const uniqueModels = [...new Set(candidateModels)];
  const readyModels = uniqueModels.filter((model) => (modelUnavailableUntil.get(model) || 0) <= Date.now());
  const modelsToTry = readyModels.length > 0 ? readyModels : uniqueModels;
  const needsDeeperReasoning = textContent.length > 2500 || imageCount > 2;

  let lastModelError = null;
  let response = null;
  let usedModel = null;

  for (const modelName of modelsToTry) {
    signal?.throwIfAborted();
    try {
      response = await abortable(ai.models.generateContent({
        model: modelName,
        config: {
          abortSignal: signal,
          responseMimeType: 'application/json',
          responseJsonSchema: ANALYSIS_SCHEMA,
          systemInstruction: prompt.systemInstruction,
          temperature: modelName.startsWith('gemini-2.5-') ? 0 : 1,
          thinkingConfig: modelName.startsWith('gemini-2.5-')
            ? { thinkingBudget: needsDeeperReasoning ? 2048 : 1024 }
            : { thinkingLevel: needsDeeperReasoning ? 'medium' : 'low' },
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt.contents }],
          },
        ],
      }), signal);
      signal?.throwIfAborted();
      if (response && response.text) {
        usedModel = modelName;
        modelUnavailableUntil.delete(modelName);
        break;
      }
    } catch (err) {
      signal?.throwIfAborted();
      lastModelError = err;
      console.warn(`[GeminiService] Model ${modelName} failed, trying next:`, err.message);
      if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(err.message)) throw err;
      if (/"code":503|"status":"UNAVAILABLE"/i.test(err.message)) {
        modelUnavailableUntil.set(modelName, Date.now() + 60_000);
      }
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
    if (typeof parsed.isChatScreenshot !== 'boolean' || typeof parsed.isScam !== 'boolean'
        || !['sufficient', 'insufficient'].includes(parsed.contextSufficiency)) {
      throw new Error('Invalid analysis field types');
    }

    const validVectors = ['none', 'phishing_link', 'otp_theft', 'money_transfer', 'apk_malware', 'unauthorized_contact'];
    const exfiltrationVector = validVectors.includes(parsed.exfiltrationVector)
      ? parsed.exfiltrationVector
      : (parsed.isScam ? 'phishing_link' : 'none');

    const multiAgentDebate = completeMultiAgentDebate(parsed.multiAgentDebate);

    return {
      isChatScreenshot: parsed.isChatScreenshot ?? true,
      isScam: parsed.isScam,
      scamType: parsed.scamType || null,
      title: parsed.title || null,
      attackTarget: (parsed.attackTarget && String(parsed.attackTarget).trim()) || 'Không rõ',
      confidenceScore: Number.isInteger(parsed.confidenceScore) && parsed.confidenceScore >= 0 && parsed.confidenceScore <= 100
        ? parsed.confidenceScore : null,
      contextSufficiency: parsed.contextSufficiency,
      contextReason: typeof parsed.contextReason === 'string' ? parsed.contextReason : null,
      missingInformation: Array.isArray(parsed.missingInformation) ? parsed.missingInformation : [],
      analysisModel: usedModel,
      analysisPolicyVersion: ANALYSIS_POLICY_VERSION,
      suggestedReply: typeof parsed.suggestedReply === 'string' ? parsed.suggestedReply : null,
      exfiltrationVector,
      multiAgentDebate,
      analysis: parsed.isChatScreenshot === false
        ? (parsed.analysis || 'Không tìm thấy nội dung tin nhắn cần kiểm tra. Vui lòng chụp lại màn hình rõ ràng hơn.')
        : (multiAgentDebate?.arbiterVerdict || parsed.analysis || ''),
      warningPoints: Array.isArray(parsed.warningPoints) ? parsed.warningPoints : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      extractedUrls: Array.isArray(parsed.extractedUrls) ? parsed.extractedUrls : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch (parseError) {
    console.error('[GeminiService] Failed to parse AI response JSON; raw content omitted.');
    throw new Error('Dữ liệu phân tích từ AI không đúng định dạng JSON chuẩn');
  }
}
