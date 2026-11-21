// Product settings validation and small pure helpers shared by the services (unit tested).

import { isIsoDate } from './dates.js';
import { CRITERIA_KEYS } from './clocks.js';

const PRODUCT_KEY = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]+$/;
const LABEL = /^[^\s,]{1,60}$/;

/**
 * Problem codes, one per line: "code | name | expected count | window days", for example
 * "occlusion-alarm-delay | Occlusion alarm delayed | 0.8 | 30". The code is the Jira label used on complaints.
 */
export function parseProblemCodes(text) {
  const codes = [];
  const errors = [];
  String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    const [code, name, expected, windowDays] = line.split('|').map((s) => s.trim());
    const exp = Number(expected);
    const win = windowDays ? Number(windowDays) : 30;
    if (!code || !LABEL.test(code)) errors.push(`Line ${i + 1}: the code must be a Jira label without spaces.`);
    else if (!(exp > 0)) errors.push(`Line ${i + 1}: the expected count must be a number above 0.`);
    else if (!(Number.isInteger(win) && win >= 7 && win <= 365)) errors.push(`Line ${i + 1}: the window must be 7 to 365 days.`);
    else codes.push({ code, name: name || code, expected: exp, windowDays: win });
  });
  return { codes, errors };
}

export function formatProblemCodes(codes) {
  return (codes ?? []).map((c) => `${c.code} | ${c.name} | ${c.expected} | ${c.windowDays}`).join('\n');
}

/** Validates a product settings form. Returns { product } or { error }. */
export function parseProduct(input) {
  const key = String(input?.key ?? '').trim().toUpperCase();
  const projectKey = String(input?.projectKey ?? '').trim().toUpperCase();
  const markets = ['US', 'EU'].filter((m) => (input?.markets ?? []).map((x) => String(x).toUpperCase()).includes(m));
  const riskFilePageId = String(input?.riskFilePageId ?? '').trim();
  const pageMatch = /^\d+$/.test(riskFilePageId) ? riskFilePageId : (/\/pages\/(\d+)/.exec(riskFilePageId)?.[1] ?? '');
  const holidays = String(input?.euHolidays ?? '').split(/[\s,;]+/).filter(Boolean);
  if (!PRODUCT_KEY.test(key)) return { error: 'Product key: 1 to 20 letters, digits or dashes, for example FB-20.' };
  if (!PROJECT_KEY.test(projectKey)) return { error: 'Jira project key, for example CMP.' };
  if (!markets.length) return { error: 'Choose at least one market (US or EU).' };
  if (riskFilePageId && !pageMatch) return { error: 'Risk management file: a Confluence page ID or page link.' };
  const badDay = holidays.find((d) => !isIsoDate(d));
  if (badDay) return { error: `EU non-working days must be YYYY-MM-DD dates (${badDay}).` };
  const { codes, errors } = parseProblemCodes(input?.problemCodes);
  if (errors.length) return { error: errors[0] };
  return {
    product: {
      key,
      name: String(input?.name ?? '').trim().slice(0, 80) || key,
      projectKey,
      markets,
      riskFilePageId: pageMatch || null,
      qualitySpaceKey: String(input?.qualitySpaceKey ?? '').trim().toUpperCase() || null,
      problemCodes: codes,
      euHolidays: [...new Set(holidays)].sort(),
    },
  };
}

/** The first label on a complaint that is one of the product's problem codes. */
export function problemCodeOf(labels, codes) {
  const known = new Set((codes ?? []).map((c) => c.code));
  return (labels ?? []).find((l) => known.has(l)) ?? null;
}

/**
 * Whether an assessed complaint is a serious incident (reported individually, so left out of trend counts):
 * any regulator's requirement that is a real report rather than "not reportable" or "needs assessment".
 */
export function isReportedIndividually(clocks) {
  return Boolean(clocks?.assessed) && clocks.requirements.some((r) => !['not-required', 'needs-assessment'].includes(r.status));
}

/** Plain-text fact sheet for the agent: the description, then each comment with its date and author. */
export function factSheet(complaint, comments) {
  const lines = [`Complaint ${complaint.key}: ${complaint.summary}`, `Created in Jira: ${complaint.createdAt ?? complaint.createdOn ?? 'unknown'}`];
  if (complaint.description) lines.push('', 'Description:', complaint.description);
  if (comments?.length) {
    lines.push('', 'Comments (oldest first):');
    for (const c of comments) lines.push(`- [${String(c.createdAt ?? '').slice(0, 16).replace('T', ' ')}]${c.author ? ` ${c.author}` : ''}: ${String(c.text ?? '').replace(/\s+/g, ' ').trim()}`);
  }
  return lines.join('\n');
}

/** "death=no; seriousInjury=yes; causality=possible" (semicolons, commas or new lines) to { death: 'no', ... }. */
export function parseAnswers(text) {
  const out = {};
  const keys = new Map([...CRITERIA_KEYS, 'causality'].map((k) => [k.toLowerCase(), k]));
  for (const part of String(text ?? '').split(/[;\n,]+/)) {
    const m = /^\s*([A-Za-z]+)\s*[:=]\s*([A-Za-z ]+?)\s*$/.exec(part);
    const key = m && keys.get(m[1].toLowerCase());
    if (key) out[key] = m[2].trim().toLowerCase();
  }
  return out;
}

export function parseEvidence(text) {
  // Accepts one criterion per line or several on one line ("death: none. seriousInjury: needed surgery.").
  const out = {};
  const source = String(text ?? '');
  const keys = new Map([...CRITERIA_KEYS, 'causality', 'awareness'].map((k) => [k.toLowerCase(), k]));
  const re = new RegExp(`(^|[\\s.;,(])(${[...keys.keys()].join('|')})\\s*[:=]\\s*`, 'gi');
  const marks = [];
  let m;
  while ((m = re.exec(source)) !== null) {
    marks.push({ key: keys.get(m[2].toLowerCase()), head: m.index + m[1].length, start: m.index + m[0].length });
  }
  marks.forEach((mark, i) => {
    const next = i + 1 < marks.length ? marks[i + 1].head : source.length;
    const newline = source.indexOf('\n', mark.start);
    const end = newline >= 0 && newline < next ? newline : next;
    const value = source.slice(mark.start, end).replace(/\s+/g, ' ').replace(/^[-*\s]+/, '').replace(/[\s;,]+$/, '').trim();
    if (value && !out[mark.key]) out[mark.key] = value.slice(0, 500);
  });
  return out;
}
