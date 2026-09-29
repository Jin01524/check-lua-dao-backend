import test from 'node:test';
import assert from 'node:assert/strict';
import { saveScanTemplate } from '../services/templateStorage.js';

function fakeDatabase(result = { data: { id: 'saved-id' }, error: null }) {
  const writes = [];
  return {
    writes,
    from(table) {
      assert.equal(table, 'scam_templates');
      return {
        insert(row) {
          writes.push(row);
          return { select: () => ({ single: async () => result }) };
        },
      };
    },
  };
}

const analysisResult = {
  isChatScreenshot: true,
  isScam: true,
  confidenceScore: 90,
  title: 'Tin nhắn giả lập',
  scamType: 'Giả mạo ngân hàng',
  messages: [{ sender: 'unknown', text: 'Gọi 0912345678 và nhập mã OTP 123456' }],
  multiAgentDebate: {
    threatHunterAnalysis: 'Số 0912345678 đáng nghi.',
    auditorDefense: 'Không thấy kênh chính thức.',
    arbiterVerdict: 'Yêu cầu mã OTP 123456 là rủi ro.',
  },
};

test('new risky and safe scans persist complete redacted analyses', async () => {
  const db = fakeDatabase();
  const risky = await saveScanTemplate({ supabase: db, analysisResult, platform: 'SMS' });
  assert.deepEqual(risky, { id: 'saved-id', status: 'saved' });
  assert.equal(db.writes[0].is_approved, false);
  assert.equal(db.writes[0].multi_agent_debate.auditorDefense, 'Không thấy kênh chính thức.');
  assert.ok(!JSON.stringify(db.writes[0]).includes('0912345678'));
  assert.ok(!JSON.stringify(db.writes[0]).includes('123456'));

  const safe = await saveScanTemplate({
    supabase: db,
    analysisResult: { ...analysisResult, isScam: false, confidenceScore: 5 },
    platform: 'SMS',
  });
  assert.equal(safe.status, 'saved');
  assert.equal(db.writes[1].scam_type, 'Tin nhắn an toàn / Bình thường');
});

test('missing AI analysis and database failure return explicit save status', async () => {
  const db = fakeDatabase({ data: null, error: { message: 'database unavailable' } });
  const logger = { warn() {}, error() {} };
  const missing = await saveScanTemplate({
    supabase: db,
    analysisResult: { ...analysisResult, multiAgentDebate: null },
    platform: 'SMS',
    logger,
  });
  assert.equal(missing.status, 'incomplete_analysis');
  assert.equal(db.writes.length, 0);
  const failed = await saveScanTemplate({ supabase: db, analysisResult, platform: 'SMS', logger });
  assert.equal(failed.status, 'database_error');
});
