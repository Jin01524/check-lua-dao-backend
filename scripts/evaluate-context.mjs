import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessContext } from '../lib/contextFlow.js';
import { ANALYSIS_POLICY_VERSION } from '../services/analysisPrompt.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, '../outputs/context-eval-2026-10-20');
await mkdir(output, { recursive: true });
const reunion = 'Chào cô Lan, cô có nhớ tui không, tuần trước mình gặp nhau ở buổi họp lớp';
const legacySource = execFileSync('git', ['show', '0673850:lib/contextFlow.js'], { cwd: root, encoding: 'utf8' });
const previous = await import(`data:text/javascript,${encodeURIComponent(legacySource)}`);
const variants = [
  { isScam: false, confidenceScore: 5, contextSufficiency: 'sufficient' },
  { isScam: true, confidenceScore: 90, contextSufficiency: 'sufficient' },
  { isScam: false, confidenceScore: null, contextSufficiency: 'insufficient' },
];
const baseline = variants.map((variant, i) => {
  const analysisResult = { isChatScreenshot: true, messages: [{ sender: 'unknown', text: reunion }], ...variant };
  return { variant: i + 1, old: previous.assessContext({ analysisResult, textContent: reunion }).status,
    updated: assessContext({ analysisResult, textContent: reunion }).status };
});
await writeFile(resolve(output, 'baseline-replay.json'), JSON.stringify({
  policy: ANALYSIS_POLICY_VERSION, note: 'Offline replay of conflicting model responses; not live provider calls.', baseline,
}, null, 2));
console.log(JSON.stringify({ baseline }));
if (!process.argv.includes('--live')) process.exit(0);

const baseUrl = 'https://check-lua-dao-backend.onrender.com';
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
const cases = [
  ...Array.from({ length: 5 }, (_, i) => ({ id: `reunion-${i + 1}`, text: reunion, expected: 'insufficient_context',
    question: 'Mình chưa nhớ ra, bạn nhắc lại tên được không?' })),
  { id: 'reunion-legacy', path: '/api/check', text: reunion, expected: 'insufficient_context',
    question: 'Mình chưa nhớ ra, bạn nhắc lại tên được không?' },
  { id: 'named-sender', text: 'Em là Hương, cô nhớ em không, hôm trước mình gặp nhau ở buổi họp lớp.',
    expected: 'insufficient_context', question: 'Bạn muốn trao đổi với mình về việc gì vậy?' },
  { id: 'recruitment', text: 'Mình là HR bên công ty công nghệ, thấy CV bạn rất tốt, đang có vị trí phù hợp với bạn.',
    expected: 'insufficient_context', question: 'Bạn đang tuyển vị trí nào vậy?' },
  { id: 'otp-risk', text: 'Tài khoản ngân hàng của bạn sắp bị khóa. Gửi ngay mã OTP cho tôi để xác minh.', expected: 'high_risk' },
  { id: 'reunion-plus-risk', text: `${reunion}. Gửi mã OTP cho mình ngay để xác minh.`, expected: 'high_risk' },
  { id: 'complete-routine', text: 'Mai nhóm mình họp lúc 8 giờ sáng tại thư viện trường để chuẩn bị báo cáo môn học. Mình sẽ mang tài liệu đã in cho cả nhóm.', expected: 'low_risk' },
  { id: 'preventive-advice', text: 'Đừng bao giờ gửi mã OTP hoặc mật khẩu cho người lạ. Ngân hàng không yêu cầu bạn cung cấp các thông tin này qua tin nhắn.', expected: 'low_risk' },
];
const statsBefore = await fetch(`${baseUrl}/api/stats`).then(r => r.json());
const results = [];
for (const item of cases.filter(item => !only || only.includes(item.id))) {
  const startedAt = Date.now();
  const body = new FormData();
  body.set('text', item.text);
  body.set('platform', 'sms');
  // A different identifier per call: no cached idempotent response can mask instability.
  body.set('clientRequestId', randomUUID());
  try {
    const response = await fetch(`${baseUrl}${item.path || '/api/v2/check'}`, {
      method: 'POST', body, signal: AbortSignal.timeout(180_000),
    });
    const data = await response.json();
    const checks = {
      httpOk: response.ok,
      status: data.assessment?.status === item.expected,
      policy: data.analysisPolicyVersion === ANALYSIS_POLICY_VERSION,
      score: item.expected === 'insufficient_context'
        ? data.confidenceScore === null && data.assessment?.riskScore === null
        : item.expected === 'low_risk'
          ? Number.isInteger(data.assessment?.riskScore) && data.assessment.riskScore < 40
          : data.assessment?.riskScore == null || data.assessment.riskScore >= 40,
      question: item.question ? data.suggestedReply?.text === item.question : data.suggestedReply == null,
      persistence: item.expected !== 'insufficient_context' || (
        data.scanSessionId == null && data.savedTemplateId == null
        && data.templateSaveStatus === 'deferred_insufficient_context' && data.multiAgentDebate == null),
    };
    const result = { id: item.id, passed: Object.values(checks).every(Boolean), checks,
      status: data.assessment?.status, riskScore: data.assessment?.riskScore,
      question: data.suggestedReply?.text || null, model: data.analysisModel,
      policy: data.analysisPolicyVersion, elapsedMs: Date.now() - startedAt,
      ...(!response.ok ? { error: data.error || 'HTTP error' } : {}),
    };
    results.push(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const result = { id: item.id, passed: false, error: error.message, elapsedMs: Date.now() - startedAt };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  // Retain progress even if an evaluation is interrupted. No visitor/raw input is logged.
  await writeFile(resolve(output, 'live-evaluation.json'), JSON.stringify({ statsBefore, results }, null, 2));
}
const statsAfter = await fetch(`${baseUrl}/api/stats`).then(r => r.json());
const summary = { policy: ANALYSIS_POLICY_VERSION, total: results.length,
  passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length,
  statsBefore, statsAfter, results };
await writeFile(resolve(output, 'live-evaluation.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ total: summary.total, passed: summary.passed, failed: summary.failed, statsBefore, statsAfter }));
if (summary.failed) process.exitCode = 1;
