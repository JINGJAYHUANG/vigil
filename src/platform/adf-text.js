// Flattens an Atlassian Document Format (ADF) document to plain text for the Rovo agent:
// one line per block, "- " for list items, "#" for headings, " | " between table cells, dates as YYYY-MM-DD.

const INLINE = new Set(['text', 'hardBreak', 'mention', 'date', 'emoji', 'inlineCard', 'status', 'placeholder', 'mediaInline']);

function isoFromTimestamp(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return '';
  return new Date(n).toISOString().slice(0, 10);
}

function inlineText(nodes) {
  return (nodes ?? []).map((node) => {
    if (!node || typeof node !== 'object') return '';
    switch (node.type) {
      case 'text': return node.text ?? '';
      case 'hardBreak': return ' ';
      case 'mention': return node.attrs?.text ?? '';
      case 'date': return isoFromTimestamp(node.attrs?.timestamp);
      case 'emoji': return node.attrs?.text ?? '';
      case 'inlineCard': return node.attrs?.url ?? '';
      case 'status': return node.attrs?.text ?? '';
      default: return '';
    }
  }).join('');
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function adfToText(doc) {
  if (typeof doc === 'string') return doc;
  if (!doc || typeof doc !== 'object') return '';
  const lines = [];

  const visit = (node, prefix = '') => {
    if (!node || typeof node !== 'object') return;
    const children = Array.isArray(node.content) ? node.content : [];
    switch (node.type) {
      case 'heading': {
        const text = clean(inlineText(children));
        if (text) lines.push(`${'#'.repeat(Math.min(6, node.attrs?.level ?? 1))} ${text}`);
        return;
      }
      case 'tableRow': {
        const cells = children.map((cell) => clean(adfToText({ type: 'doc', content: cell.content ?? [] }).replace(/\n/g, ' ')));
        if (cells.some(Boolean)) lines.push(cells.join(' | '));
        return;
      }
      case 'listItem': {
        children.forEach((child, i) => visit(child, i === 0 ? '- ' : '  '));
        return;
      }
      case 'taskItem':
      case 'decisionItem': {
        const text = clean(inlineText(children));
        if (text) lines.push(`- ${text}`);
        return;
      }
      default:
        break;
    }
    if (children.length && children.every((c) => c && INLINE.has(c.type))) {
      const text = clean(inlineText(children));
      if (text) lines.push(`${prefix}${text}`);
      return;
    }
    children.forEach((child) => visit(child, prefix));
  };

  visit(doc);
  return lines.join('\n');
}

/** A minimal ADF document with one paragraph per line. */
export function textToAdf(text) {
  const paragraphs = String(text ?? '').split('\n').filter((line) => line.trim());
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
  };
}
