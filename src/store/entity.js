// Pure helpers for Custom Entity values (no Forge imports, so they can be unit tested).

// Only declared attributes are written. Custom Entities reject empty values, so empty strings, empty lists and empty
// objects are left out; readers treat a missing attribute as empty.
export const ASSESSMENT_ATTRIBUTES = ['complaintKey', 'productKey', 'awarenessDate', 'awarenessQuote', 'reportabilityDate',
  'remedialDate', 'newInfoDate', 'criteria', 'evidence', 'rationale', 'submissions', 'lifecycle', 'nextDue',
  'decisionPageId', 'decisionPageUrl', 'createdAt', 'updatedAt'];

const isEmpty = (value) => value === undefined || value === null || value === ''
  || (Array.isArray(value) && value.length === 0)
  || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);

export function toEntity(record, attributes = ASSESSMENT_ATTRIBUTES) {
  const out = {};
  for (const name of attributes) {
    const value = record[name];
    if (isEmpty(value)) continue;
    out[name] = value;
  }
  return out;
}
