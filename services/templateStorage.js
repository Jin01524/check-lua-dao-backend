import { completeMultiAgentDebate } from '../lib/multiAgentDebate.js';
import { redactTemplateValue } from '../lib/redactTemplate.js';

export async function saveScanTemplate({ supabase, analysisResult, platform, logger = console }) {
  if (analysisResult.isChatScreenshot === false) {
    return { id: null, status: 'not_applicable' };
  }

  const debate = completeMultiAgentDebate(analysisResult.multiAgentDebate);
  if (!debate) {
    logger.warn('[Check] Template not saved: AI did not return all three analyses.');
    return { id: null, status: 'incomplete_analysis' };
  }

  const score = Number(analysisResult.confidenceScore) || 0;
  const hasRisk = Boolean(analysisResult.isScam) || score >= 40;
  const template = redactTemplateValue({
    title: analysisResult.title || (hasRisk ? analysisResult.scamType || 'Nghi vấn tin nhắn lừa đảo mới' : 'Tin nhắn an toàn / Bình thường'),
    platform,
    scam_type: hasRisk ? analysisResult.scamType || 'Nghi vấn lừa đảo' : 'Tin nhắn an toàn / Bình thường',
    analysis: debate.arbiterVerdict,
    // The AI is instructed to remove sensitive details. Apply server redaction too.
    // Never fall back to the raw text supplied by the visitor.
    messages_json: Array.isArray(analysisResult.messages) ? analysisResult.messages : [],
    is_approved: false,
    attack_target: hasRisk ? analysisResult.attackTarget || 'Không rõ' : 'Không có',
    confidence_score: score,
    warning_points: hasRisk && Array.isArray(analysisResult.warningPoints) ? analysisResult.warningPoints : [],
    exfiltration_vector: analysisResult.exfiltrationVector || 'none',
    multi_agent_debate: debate,
  });

  const { data, error } = await supabase
    .from('scam_templates')
    .insert(template)
    .select('id')
    .single();

  if (error || !data?.id) {
    logger.error('[Check] Failed to save template:', error?.message || 'No id returned');
    return { id: null, status: 'database_error' };
  }

  return { id: data.id, status: 'saved' };
}
