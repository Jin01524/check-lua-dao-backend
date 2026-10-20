import { contextPlan, foldVietnamese } from './contextSignals.js';

const DIRECT_DANGER = [
  /(?:gửi|đưa|cung cấp|nhập|đọc)[^.!?\n]{0,55}(?:otp|mã xác thực|mật khẩu|password|pin)/i,
  /(?:chuyển|nộp|đặt cọc)[^.!?\n]{0,45}(?:tiền|phí|đồng|vnd|vnđ|triệu|nghìn|stk|số tài khoản)/i,
  /(?:cài|tải)[^.!?\n]{0,35}(?:apk|ứng dụng lạ|app lạ)/i,
  /(?:bấm|nhấn|truy cập|mở)[^.!?\n]{0,40}(?:https?:\/\/|www\.|đường link|liên kết)/i,
  /(?:ngân hàng|công an|cơ quan thuế)[^.!?\n]{0,60}(?:khóa tài khoản|điều tra|xác minh gấp)/i,
  /(?:đe dọa|bắt giữ|khóa tài khoản)[^.!?\n]{0,50}(?:ngay|gấp|trong hôm nay)/i,
];
const FORBIDDEN_REPLY = /(?:https?:\/\/|www\.|\b\d{5,}\b|otp|mật khẩu|password|chuyển tiền|số tài khoản|tài khoản ngân hàng|căn cước|cccd|số điện thoại|email|họ tên|ngày sinh|địa chỉ|thông tin cá nhân|bấm vào|nhấp vào|cài ứng dụng|mã xác thực)/i;
const FALLBACK_REPLY = 'Bạn muốn trao đổi cụ thể về việc gì vậy?';

export function hasDirectDanger(text) {
  const original = String(text || '').normalize('NFKC');
  const value = foldVietnamese(original);
  return DIRECT_DANGER.some((pattern) => {
    for (const match of value.matchAll(new RegExp(foldVietnamese(pattern.source), 'gi'))) {
      const prefix = original.slice(Math.max(0, match.index - 35), match.index);
      if (!/(?:không|đừng|chớ|khong|dung|cho)(?:\s+(?:bao giờ|bao gio))?\s*$/i.test(prefix)) return true;
    }
    return false;
  });
}

export function safeSuggestedReply(value, { plan = null } = {}) {
  // Known gaps have one focused, conversational question, independent of model drift.
  if (plan?.question && plan.kind !== 'generic_opening') return plan.question;
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const fallback = plan?.question || FALLBACK_REPLY;
  if (!text || text.length > 160 || FORBIDDEN_REPLY.test(text)) return fallback;
  if ((text.match(/\?/g) || []).length !== 1 || /[.!]\s+\S/.test(text)) return fallback;
  if (/bạn (?:hãy|nên) (?:trả lời|phản hồi)|lừa đảo|kẻ gian|đối tượng|nạn nhân/i.test(text)) return fallback;
  return text;
}

// confidenceScore is the risk score on a 0–100 scale, not confidence in the verdict.
export function riskScoreAssessment(analysisResult) {
  const raw = analysisResult?.confidenceScore;
  const value = raw == null ? null : Number(raw);
  const valid = value != null && Number.isInteger(value) && value >= 0 && value <= 100;
  const conflictsWithVerdict = valid && (analysisResult.isScam === true ? value < 40 : value >= 40);
  return { score: valid && !conflictsWithVerdict ? value : null, conflictsWithVerdict };
}

export function assessContext({ analysisResult, textContent, contextText = textContent, round = 1 }) {
  const directDanger = hasDirectDanger(textContent);
  const plan = contextPlan(contextText);
  if (analysisResult.isChatScreenshot === false && !directDanger && !plan.kind) {
    return { status: 'invalid_input', riskScore: null, reason: 'Không đọc được nội dung tin nhắn.', suggestedReply: null, allowedActions: ['add_context'] };
  }
  const { score, conflictsWithVerdict } = riskScoreAssessment(analysisResult);
  const modelRisk = analysisResult.isScam === true;
  // A neutral introduction cannot become a fraud verdict just because the model
  // guessed an identity or assigned a high score. Concrete danger always wins.
  if (!directDanger && plan.kind) {
    return insufficientContext(analysisResult, round, plan);
  }
  if (directDanger || modelRisk) {
    return {
      status: 'high_risk',
      riskScore: modelRisk ? score : null,
      reason: directDanger && !modelRisk
        ? 'Nội dung có yêu cầu nhạy cảm; cần cảnh giác dù điểm AI chưa nhất quán.'
        : 'Có dấu hiệu rủi ro cần cảnh báo.',
      suggestedReply: null,
      allowedActions: ['add_context', 'verify_official_channel'],
    };
  }
  if (conflictsWithVerdict) {
    return {
      status: 'insufficient_context', riskScore: null,
      reason: 'Kết luận và điểm rủi ro của AI chưa thống nhất; cần kiểm tra lại với thêm ngữ cảnh.',
      suggestedReply: null,
      allowedActions: ['add_context', 'verify_official_channel'],
    };
  }
  // Length alone cannot make a complete appointment or ordinary thanks inconclusive.
  const missingContext = analysisResult.contextSufficiency === 'insufficient' || score == null;
  if (missingContext) {
    return insufficientContext(analysisResult, round, plan);
  }
  return {
    status: 'low_risk', riskScore: score,
    reason: 'Chưa phát hiện dấu hiệu rủi ro rõ trong ngữ cảnh hiện có.',
    suggestedReply: null, allowedActions: ['add_context'],
  };
}
function insufficientContext(analysisResult, round, plan) {
  const canAsk = round <= 2;
  return {
    status: 'insufficient_context', riskScore: null,
    reason: plan.reason || 'Đoạn tin thiếu bối cảnh để kết luận.',
    missingInformation: plan.kind
      ? [plan.kind === 'generic_opening' ? 'sender_purpose' : plan.kind]
      : (analysisResult.missingInformation || []),
    suggestedReply: canAsk ? {
      text: safeSuggestedReply(analysisResult.suggestedReply, { plan }),
      purpose: plan.purpose || 'Làm rõ điều người gửi chưa nói trong đoạn tin', round,
    } : null,
    allowedActions: canAsk
      ? ['copy_suggested_reply', 'add_context', 'verify_official_channel']
      : ['add_context', 'verify_official_channel'],
  };
}

/** Do not expose a confident model verdict beside an inconclusive assessment. */
export function publicAnalysis(analysisResult, assessment) {
  if (assessment.status === 'high_risk' && analysisResult.isChatScreenshot === false) {
    return { ...analysisResult, isChatScreenshot: true };
  }
  if (assessment.status !== 'insufficient_context') return analysisResult;
  return {
    ...analysisResult, isChatScreenshot: true, isScam: false, confidenceScore: null,
    contextSufficiency: 'insufficient', scamType: null,
    contextReason: assessment.reason, missingInformation: assessment.missingInformation || [],
    title: 'Tin nhắn cần thêm ngữ cảnh', attackTarget: 'Chưa xác định',
    analysis: assessment.reason, multiAgentDebate: null,
    exfiltrationVector: 'none', warningPoints: [],
    recommendations: ['Chỉ phản hồi nếu bạn thấy phù hợp; khi có tin mới, quét lại toàn bộ cuộc trò chuyện như một lượt mới.'],
  };
}
