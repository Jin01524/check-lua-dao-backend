/** Content-only signals. Never use the model's message splitting to count context. */
export function cleanContextText(value) {
  return String(value || '').normalize('NFKC')
    .replace(/\[(?:Văn bản OCR từ ảnh|Tin nhắn ban đầu|Người dùng đã hỏi|Phản hồi mới của người gửi)\]\s*:?/gi, ' ')
    .replace(/\bẢnh\s+\d+\s*:/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function foldVietnamese(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

function plain(value) { return foldVietnamese(cleanContextText(value)); }

// These only prevent a neutral-opening override. They never declare a scam.
const POTENTIAL_RISK = /https?:\/\/|www\.|\b[\w-]+\.(?:com|net|org|vn|cc|top|xyz|site|online|app|info|io|me|click|zip|shop)\b|\b(?:otp|pin|mat khau|password|xac thuc|cccd|can cuoc|tai khoan|apk|dau tu|loi nhuan|bao lanh|bi bat|bat giu|khoa tai khoan|cong an|co quan thue|trung thuong|nhan thuong|nhan qua|de doa|tong tien|lo anh|clip|anh rieng|bi mat|giet|danh dap|ma qr)\b|\b(?:chuyen|nop|vay|muon|coc|ung truoc)\b.{0,50}\b(?:tien|phi|dong|vnd|trieu|nghin|stk)\b|\d\s*(?:%|trieu|tr\b|nghin|k\b|vnd|dong\b)/;
const RECALL_IDENTITY = /\b(?:nho|nhan ra)\s+(?:tui|toi|minh|em|anh|chi|chau|con|tao|to)(?:\s+la\s+ai)?\s+(?:khong|ko|hong|chua|chu)\b|\bdoan\s+(?:xem\s+)?(?:tui|toi|minh|em|anh|chi)\s+la\s+ai\b/;
const EXPLICIT_PURPOSE = /\b(?:muon|can|dinh)\s+(?:hoi|nho|hen|trao doi|lay lai|xac nhan lich)\b.{8,}|\b(?:minh|toi|em|anh|chi|ban|con)\s+se\s+(?:gap|hop|ve|den|an)\b/;
const COMPLETE_ROUTINE = /\b(?:hop nhom|hop lop|lam bai|bai tap|bao cao|an com|an trua|an toi|gap nhau|gap ban|gap minh)\b.{0,65}\b(?:luc|vao|o|tai|mai|hom nay|toi nay|ngay|gio)\b|\b(?:luc|mai|hom nay|toi nay|sang mai)\b.{0,65}\b(?:hop nhom|an com|an trua|an toi|lam bai|bai tap|thu vien)\b/;
const PREVENTIVE_ADVICE = /\b(?:khong|dung|cho)\s+(?:bao gio\s+)?(?:gui|cung cap|chia se|dua|doc)\b.{0,40}\b(?:otp|mat khau|ma xac thuc)\b/;

function senderHasName(text) {
  const match = text.match(/\b(?:tui|toi|minh|em|anh|chi|chau|to)\s+(?:ten(?: la)?|la)\s+([a-z]+)/);
  return Boolean(match && !['ai', 'gi', 'nguoi', 'ban', 'hr', 'nhan', 'mot', 'ben', 'cong', 'canh', 'hoc', 'dai', 'nguoiquen'].includes(match[1]));
}

function hasOrganization(text) {
  const match = text.match(/\b(?:cong ty|doanh nghiep|don vi)\s+([a-z0-9&.-]+)/);
  return Boolean(match && !['cong', 'co', 'trach', 'ben', 'minh', 'toi', 'em', 'anh', 'chi', 'mot', 'nay', 'do'].includes(match[1]));
}

function plan(kind, reason, question, purpose) {
  return { kind, reason, question, purpose };
}

export function contextPlan(value) {
  const original = cleanContextText(value);
  const text = plain(original);
  const words = text.split(/\s+/).filter(Boolean).length;
  const potentialRisk = POTENTIAL_RISK.test(text);
  const namedSender = senderHasName(text);
  const identityOpening = RECALL_IDENTITY.test(text);
  if (!potentialRisk && identityOpening && !EXPLICIT_PURPOSE.test(text)) {
    return namedSender
      ? plan('sender_purpose', 'Người gửi đã tự giới thiệu nhưng chưa nói muốn trao đổi việc gì; lời tự nhận quen biết chưa xác minh được danh tính.',
        'Bạn muốn trao đổi với mình về việc gì vậy?', 'Làm rõ mục đích liên hệ, không hỏi lại tên đã được cung cấp')
      : plan('sender_identity', 'Người gửi nhắc lại một lần gặp trước đây nhưng chưa cho biết mình là ai và muốn trao đổi việc gì. Chưa đủ dữ kiện để kết luận an toàn hoặc lừa đảo.',
        'Mình chưa nhớ ra, bạn nhắc lại tên được không?', 'Làm rõ người đang liên hệ; tên tự khai chưa phải bằng chứng xác minh');
  }
  const recruitment = /\b(?:hr|nhan su|tuyen dung|dang tuyen|tim ung vien|cv|tuyen.{0,25}vi tri)\b/.test(text);
  const jobRole = /\b(?:lap trinh|developer|ke toan|marketing|thiet ke|ban hang|nhan vien kinh doanh|ky su|kiem thu|tester|thuc tap sinh)\b|\bvi tri\s+(?!(?:phu hop|ben|cua|moi|hien|nay|can|nhu|cho|ma)\b)[a-z]{2,}/.test(text);
  if (!potentialRisk && recruitment && !jobRole) {
    return plan('job_position', 'Tin nhắn chỉ mở lời tuyển dụng hoặc khen CV, chưa nêu vị trí cụ thể để đánh giá lời mời.',
      'Bạn đang tuyển vị trí nào vậy?', 'Làm rõ vị trí công việc đang được đề cập');
  }
  if (!potentialRisk && recruitment && !hasOrganization(text)) {
    return plan('organization_name', 'Đã có nội dung tuyển dụng nhưng chưa rõ đơn vị đang liên hệ.',
      'Bạn đang tuyển cho công ty nào vậy?', 'Làm rõ đơn vị tuyển dụng; không yêu cầu hồ sơ hay dữ liệu cá nhân');
  }
  const completeRoutine = !identityOpening && COMPLETE_ROUTINE.test(text);
  const preventiveAdvice = PREVENTIVE_ADVICE.test(text);
  const genericOpening = /^(?:chao\b|xin chao\b|hello\b|hi\b|alo\b|ban (?:ve|ranh|khoe|co do|dang o dau)\b)|\b(?:co chuyen|co viec|muon trao doi|can trao doi)\b/.test(text);
  if (words <= 12 && !potentialRisk && !completeRoutine && (genericOpening || namedSender)) {
    return namedSender
      ? plan('sender_purpose', 'Tin nhắn chưa nêu mục đích liên hệ nên cần thêm ngữ cảnh.',
        'Bạn muốn trao đổi với mình về việc gì vậy?', 'Làm rõ mục đích liên hệ')
      : plan('generic_opening', 'Đoạn tin chưa nêu đủ chủ đề hoặc mục đích để nhận định.',
        'Bạn muốn trao đổi cụ thể về việc gì vậy?', 'Làm rõ chủ đề người gửi đang đề cập');
  }
  return { kind: null, reason: null, question: null, purpose: null, completeRoutine, preventiveAdvice, words };
}
