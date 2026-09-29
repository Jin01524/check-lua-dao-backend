import test from 'node:test';
import assert from 'node:assert/strict';
import { completeMultiAgentDebate } from '../lib/multiAgentDebate.js';

test('a saved template requires all three real AI analyses', () => {
  const complete = {
    threatHunterAnalysis: 'Có yêu cầu chuyển tiền.',
    auditorDefense: 'Không thấy xác minh từ kênh chính thức.',
    arbiterVerdict: 'Rủi ro cao.',
  };
  assert.deepEqual(completeMultiAgentDebate(complete), complete);
  assert.equal(completeMultiAgentDebate({ ...complete, auditorDefense: '  ' }), null);
  assert.equal(completeMultiAgentDebate({ ...complete, arbiterVerdict: null }), null);
  assert.equal(completeMultiAgentDebate(null), null);
});
