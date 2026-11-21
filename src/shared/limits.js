// Keeps action and MCP tool outputs small. Community reports suggest large outputs (about 1 MB) are slow,
// so outputs are capped well below that.

export const MAX_OUTPUT_BYTES = 50_000;
const MAX_STATEMENT_CHARS = 500;

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

function shorten(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Returns the payload unchanged if it fits; otherwise shortens long statements and drops trailing list items
 * from `listKey` until it fits, and marks the result as truncated.
 */
export function fitOutput(payload, { listKey = 'results', maxBytes = MAX_OUTPUT_BYTES } = {}) {
  if (byteLength(payload) <= maxBytes) return payload;
  const list = Array.isArray(payload[listKey]) ? payload[listKey] : [];
  const items = list.map((item) => (item && typeof item === 'object' && 'statement' in item
    ? { ...item, statement: shorten(item.statement, MAX_STATEMENT_CHARS) }
    : item));
  const result = { ...payload, [listKey]: items, truncated: true, totalCount: list.length };
  while (result[listKey].length && byteLength(result) > maxBytes) result[listKey].pop();
  return result;
}
