const FIELDS = ['threatHunterAnalysis', 'auditorDefense', 'arbiterVerdict'];

// Persist only actual, complete AI responses. Do not store placeholder text as analysis.
export function completeMultiAgentDebate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!FIELDS.every((field) => typeof value[field] === 'string' && value[field].trim())) return null;
  return Object.fromEntries(FIELDS.map((field) => [field, value[field].trim()]));
}
