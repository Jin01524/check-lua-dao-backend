import test from 'node:test';
import assert from 'node:assert/strict';
import { assessContext, hasDirectDanger, riskScoreAssessment, safeSuggestedReply } from '../lib/contextFlow.js';

const base = {
  isChatScreenshot: true,
  isScam: false,
  confidenceScore: 5,
  messages: [{ sender: 'unknown', text: 'Bạn về chưa?' }],
  contextSufficiency: 'insufficient',
  suggestedReply: 'Bạn đang hỏi về việc gì vậy?',
};

test('short neutral messages get a manual question, including from unknown senders', () => {
  const result = assessContext({ analysisResult: base, textContent: 'Bạn về chưa?' });
  assert.equal(result.status, 'insufficient_context');
  assert.equal(result.riskScore, null);
  assert.equal(result.suggestedReply.text, base.suggestedReply);
  assert.ok(result.allowedActions.includes('copy_suggested_reply'));
});

test('clear sensitive requests never get a reply suggestion', () => {
  const result = assessContext({ analysisResult: base, textContent: 'Gửi mã OTP cho tôi' });
  assert.equal(result.status, 'high_risk');
  assert.equal(result.suggestedReply, null);
  assert.equal(result.riskScore, null); // Do not invent a score if AI disagrees.
  assert.equal(hasDirectDanger('Không gửi mã OTP cho bất kỳ ai'), false);
  assert.equal(assessContext({ analysisResult: base, textContent: 'Bấm vào https://abc.test ngay' }).status, 'high_risk');
  assert.equal(assessContext({ analysisResult: base, textContent: 'Cài file APK này nhé' }).suggestedReply, null);
});

test('unsafe AI reply falls back to one neutral question and stops after two rounds', () => {
  assert.equal(safeSuggestedReply('Gửi OTP 123456 để tôi xem'), 'Bạn muốn trao đổi cụ thể về việc gì vậy?');
  assert.equal(safeSuggestedReply('Cho tôi số điện thoại của bạn?'), 'Bạn muốn trao đổi cụ thể về việc gì vậy?');
  const afterTwo = assessContext({ analysisResult: base, textContent: 'Chào bạn', round: 3 });
  assert.equal(afterTwo.status, 'insufficient_context');
  assert.equal(afterTwo.suggestedReply, null);
});

test('new short replies remain inconclusive and complete context can be low risk', () => {
  const stillShort = assessContext({
    analysisResult: { ...base, messages: [{ sender: 'a', text: 'Chào' }, { sender: 'b', text: 'Xin chào' }] },
    textContent: '[Tin ban đầu] Chào [Phản hồi] Xin chào',
    contextText: 'Chào Xin chào',
    round: 2,
  });
  assert.equal(stillShort.status, 'insufficient_context');
  const complete = assessContext({
    analysisResult: { ...base, contextSufficiency: 'sufficient', messages: [{ sender: 'a', text: 'Kế hoạch họp...' }] },
    textContent: 'Chúng ta họp nhóm lúc 8 giờ sáng mai ở thư viện để chuẩn bị báo cáo môn học.',
  });
  assert.equal(complete.status, 'low_risk');
  const withoutScore = assessContext({
    analysisResult: { ...base, confidenceScore: null, contextSufficiency: 'sufficient' },
    textContent: 'Chúng ta họp nhóm lúc 8 giờ sáng mai ở thư viện để chuẩn bị báo cáo môn học.',
  });
  assert.equal(withoutScore.riskScore, null);
  assert.equal(withoutScore.status, 'insufficient_context');
});

test('risk score increases with risk and cannot reverse the AI verdict', () => {
  const text = 'Tôi sẽ gặp bạn ở thư viện ngày mai để trao đổi về bài tập nhóm của lớp học.';
  const safe = assessContext({
    analysisResult: { ...base, confidenceScore: 5, contextSufficiency: 'sufficient' },
    textContent: text,
  });
  assert.equal(safe.status, 'low_risk');
  assert.equal(safe.riskScore, 5);

  const risky = assessContext({
    analysisResult: { ...base, isScam: true, confidenceScore: 91 },
    textContent: text,
  });
  assert.equal(risky.status, 'high_risk');
  assert.equal(risky.riskScore, 91);

  const lowScoreRisky = assessContext({
    analysisResult: { ...base, isScam: true, confidenceScore: 8 },
    textContent: text,
  });
  assert.equal(lowScoreRisky.status, 'high_risk');
  assert.equal(lowScoreRisky.riskScore, null);

  const highScoreSafe = assessContext({
    analysisResult: { ...base, confidenceScore: 92, contextSufficiency: 'sufficient' },
    textContent: text,
  });
  assert.equal(highScoreSafe.status, 'insufficient_context');
  assert.equal(highScoreSafe.riskScore, null);
  assert.equal(highScoreSafe.suggestedReply, null);
  assert.deepEqual(riskScoreAssessment({ isScam: false, confidenceScore: 92 }),
    { score: null, conflictsWithVerdict: true });
});
