import test from 'node:test';
import assert from 'node:assert/strict';
import { assessContext, hasDirectDanger, publicAnalysis, safeSuggestedReply } from '../lib/contextFlow.js';
import { contextPlan } from '../lib/contextSignals.js';
import { persistScanOutcome } from '../services/scanPersistence.js';

export const reunionMessage = 'Chào cô Lan, cô có nhớ tui không, tuần trước mình gặp nhau ở buổi họp lớp';
const model = {
  isChatScreenshot: true, isScam: false, confidenceScore: 5, contextSufficiency: 'sufficient',
  messages: [{ sender: 'unknown', text: reunionMessage }],
  suggestedReply: 'Bạn muốn trao đổi cụ thể về việc gì vậy?',
  analysis: 'Nhận định gốc có thể thay đổi.',
  multiAgentDebate: { threatHunterAnalysis: 'A', auditorDefense: 'B', arbiterVerdict: 'C' },
};

test('reported reunion opener stays inconclusive across 192 conflicting model outputs', async () => {
  let count = 0;
  const writes = [];
  for (const isScam of [false, true]) {
    for (const score of [null, 0, 5, 39, 40, 75, 90, 100]) {
      for (const contextSufficiency of ['sufficient', 'insufficient']) {
        for (const messageCount of [0, 1, 5]) {
          for (const isChatScreenshot of [false, true]) {
            const response = { ...model, isScam, confidenceScore: score, contextSufficiency, isChatScreenshot,
              messages: Array.from({ length: messageCount }, () => ({ sender: 'a', text: 'fragment' })) };
            const assessment = assessContext({ analysisResult: response, textContent: reunionMessage });
            assert.equal(assessment.status, 'insufficient_context');
            assert.equal(assessment.riskScore, null);
            assert.equal(assessment.suggestedReply.text, 'Mình chưa nhớ ra, bạn nhắc lại tên được không?');
            assert.deepEqual(assessment.missingInformation, ['sender_identity']);
            const output = publicAnalysis(response, assessment);
            assert.equal(output.isScam, false);
            assert.equal(output.isChatScreenshot, true);
            assert.equal(output.confidenceScore, null);
            assert.equal(output.multiAgentDebate, null);
            await persistScanOutcome({ assessment, analysisResult: response }, {
              saveTemplate: async () => { writes.push('template'); },
              recordScan: async () => { writes.push('log'); },
            });
            count++;
          }
        }
      }
    }
  }
  assert.equal(count, 192);
  assert.deepEqual(writes, []);
});

test('equivalent punctuation, OCR wrappers and names do not change the missing gap', () => {
  for (const text of [
    reunionMessage.toUpperCase(),
    'Chao co An, co co nho tui khong? Tuan truoc minh gap nhau o buoi hop lop.',
    '[Văn bản OCR từ ảnh]:\nẢnh 1:\nChào cô Hoa, cô có nhớ tui không?\nTuần trước mình gặp nhau ở buổi họp lớp.',
    'Bạn đoán xem mình là ai, hồi trước tụi mình từng học chung đó.',
  ]) {
    const result = assessContext({ analysisResult: { ...model, isScam: true, confidenceScore: 90 }, textContent: text });
    assert.equal(result.status, 'insufficient_context', text);
    assert.equal(contextPlan(text).kind, 'sender_identity', text);
  }
});

test('follow-up asks the missing detail instead of repeating an identity already stated', () => {
  const named = assessContext({ analysisResult: model, textContent: 'Em là Hương, cô còn nhớ em không, hôm trước mình gặp nhau ở buổi họp lớp.' });
  assert.equal(named.status, 'insufficient_context');
  assert.equal(named.suggestedReply.text, 'Bạn muốn trao đổi với mình về việc gì vậy?');
  assert.equal(contextPlan(`${reunionMessage}\nMình là Nam đây.`).kind, 'sender_purpose');
});

test('recruitment questions target job first, then the missing organization', () => {
  const vague = assessContext({ analysisResult: { ...model, isScam: true, confidenceScore: 85 },
    textContent: 'Mình là HR bên công ty công nghệ, thấy CV bạn rất tốt, đang có vị trí phù hợp với bạn.' });
  assert.equal(vague.status, 'insufficient_context');
  assert.equal(vague.suggestedReply.text, 'Bạn đang tuyển vị trí nào vậy?');
  const roleKnown = assessContext({ analysisResult: model, textContent: 'Bên mình đang tuyển lập trình viên, bạn có muốn trao đổi về công việc không?' });
  assert.equal(roleKnown.suggestedReply.text, 'Bạn đang tuyển cho công ty nào vậy?');
});

test('concrete danger added to an introduction always overrides a missing-context question', () => {
  const danger = [
    'Gửi mã OTP cho mình ngay nhé.',
    'Bạn chuyển tiền vào số tài khoản này nhé.',
    'Cài file APK này để mình hướng dẫn.',
    'Bấm vào https://example.invalid/dangnhap để nhận quà.',
    'Ngân hàng đang xác minh gấp tài khoản của bạn.',
    'Gui ma OTP cho toi ngay.',
    'Cai file APK nay nhe.',
  ];
  for (const suffix of danger) {
    const result = assessContext({ analysisResult: { ...model, isScam: true, confidenceScore: 92 },
      textContent: `${reunionMessage}. ${suffix}` });
    assert.equal(result.status, 'high_risk', suffix);
    assert.equal(result.riskScore, 92);
    assert.equal(result.suggestedReply, null);
  }
  // A negated first occurrence must not hide an actual demand later on.
  assert.equal(hasDirectDanger('Không gửi OTP cho người lạ. Bây giờ gửi mã OTP cho tôi để xác minh.'), true);
  assert.equal(hasDirectDanger('Đừng bao giờ gửi mã OTP cho người khác.'), false);
  assert.equal(hasDirectDanger('Dung bao gio gui ma OTP cho nguoi la.'), false);
  assert.equal(hasDirectDanger('Dũng gửi mã OTP cho tôi ngay.'), true);
});

test('short complete routine messages are not automatically demoted to missing context', () => {
  for (const text of [
    'Mai họp nhóm lúc 8h ở thư viện nhé.',
    'Tối nay ăn cơm lúc 6 giờ nhé.',
    'Mình sẽ gặp bạn ở thư viện để làm bài tập.',
    'Đừng bao giờ gửi mã OTP cho người lạ.',
    'Cảm ơn bạn đã giúp mình nhé.',
    'Chúc mừng sinh nhật bạn!',
    'Công ty FPT đang tuyển lập trình viên cho dự án quản lý thư viện, buổi phỏng vấn trực tiếp dự kiến sáng thứ hai.',
  ]) {
    const result = assessContext({ analysisResult: model, textContent: text });
    assert.equal(result.status, 'low_risk', text);
    assert.equal(result.riskScore, 5);
    assert.equal(result.suggestedReply, null);
    assert.equal(publicAnalysis(model, result), model);
  }
});

test('unknown short danger is not suppressed just to make outcomes consistent', () => {
  for (const text of ['Bạn đã trúng thưởng giải đặc biệt!', 'Ảnh riêng tư của bạn sắp bị phát tán.']) {
    const result = assessContext({ analysisResult: { ...model, isScam: true, confidenceScore: 91 }, textContent: text });
    assert.equal(result.status, 'high_risk');
    assert.equal(result.suggestedReply, null);
  }
  const invalid = assessContext({ analysisResult: { ...model, isChatScreenshot: false }, textContent: 'Brightness Settings Menu' });
  assert.equal(invalid.status, 'invalid_input');
});

test('reply validation rejects instructional, accusatory and sensitive requests', () => {
  const fallback = 'Bạn muốn trao đổi cụ thể về việc gì vậy?';
  for (const question of [
    'Bạn có phải kẻ lừa đảo không?', 'Bạn nên trả lời rằng bạn là ai?',
    'Hãy cung cấp số CCCD để xác minh?', 'Cho mình số tài khoản để đối chiếu?',
    'Bạn là ai? Bạn muốn gì?',
  ]) assert.equal(safeSuggestedReply(question), fallback);
  assert.equal(safeSuggestedReply('Bạn muốn trao đổi với mình về việc gì vậy?'), 'Bạn muốn trao đổi với mình về việc gì vậy?');
});
