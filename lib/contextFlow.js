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
  const value = String(text || '');
  return DIRECT_DANGER.some((pattern) => {
    const match = pattern.exec(value);
    if (!match) return false;
    const prefix = value.slice(Math.max(0, match.index - 25), match.index);
    return !/(?:không|đừng|chớ)\s*$/i.test(prefix);
  });
}

export function safeSuggestedReply(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 160 || FORBIDDEN_REPLY.test(text)) return FALLBACK_REPLY;
  if ((text.match(/\?/g) || []).length !== 1 || /[.!]\s+\S/.test(text)) return FALLBACK_REPLY;
  return text;
}

export function assessContext({ analysisResult, textContent, contextText = textContent, round = 1 }) {
  if (analysisResult.isChatScreenshot === false) {
    return { status: 'invalid_input', riskScore: null, reason: 'Không đọc được nội dung tin nhắn.', suggestedReply: null, allowedActions: ['add_context'] };
  }
  const score = analysisResult.confidenceScore != null && Number.isFinite(Number(analysisResult.confidenceScore))
    ? Math.max(0, Math.min(100, Number(analysisResult.confidenceScore))) : null;
  const directDanger = hasDirectDanger(textContent);
  const modelRisk = analysisResult.isScam === true || (score != null && score >= 40);
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
  const words = String(contextText || '').trim().split(/\s+/).filter(Boolean);
  const shortMessage = words.length <= (round === 1 ? 12 : 20)
    && (analysisResult.messages?.length || 0) <= round;
  const missingContext = analysisResult.contextSufficiency === 'insufficient' || shortMessage || score == null;
  if (missingContext) {
    const canAsk = round <= 2;
    return {
      status: 'insufficient_context',
      riskScore: null,
      reason: 'Đoạn tin quá ngắn hoặc thiếu bối cảnh để kết luận.',
      suggestedReply: canAsk ? {
        text: safeSuggestedReply(analysisResult.suggestedReply),
        purpose: 'Làm rõ chủ đề người gửi đang đề cập',
        round,
      } : null,
      allowedActions: canAsk
        ? ['copy_suggested_reply', 'add_context', 'verify_official_channel']
        : ['add_context', 'verify_official_channel'],
    };
  }
  return {
    status: 'low_risk', riskScore: score,
    reason: 'Chưa phát hiện dấu hiệu rủi ro rõ trong ngữ cảnh hiện có.',
    suggestedReply: null, allowedActions: ['add_context'],
  };
}
