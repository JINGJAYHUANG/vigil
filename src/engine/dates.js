// Day-level date helpers. Commitment dates are ISO calendar dates (YYYY-MM-DD) compared in UTC.

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

function validDay(y, m, d) {
  if (y < 2000 || y > 2100) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isIsoDate(value) {
  const m = ISO_DAY.exec(String(value ?? '').trim());
  return Boolean(m && validDay(Number(m[1]), Number(m[2]), Number(m[3])));
}

/**
 * Normalizes a date to YYYY-MM-DD. Accepts ISO dates and timestamps ("2026-12-15", "2026-12-15T10:00:00.000+0000")
 * and English day-month-year forms ("15 December 2026", "Dec 15, 2026"). Returns null when it cannot tell.
 */
export function toIsoDate(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (iso) return validDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const words = s.toLowerCase().replace(/,/g, ' ').replace(/(\d+)(st|nd|rd|th)\b/g, '$1').split(/\s+/).filter(Boolean);
  if (words.length === 3) {
    const [a, b, c] = words;
    if (/^\d{1,2}$/.test(a) && MONTHS[b] && /^\d{4}$/.test(c)) return validDay(Number(c), MONTHS[b], Number(a));
    if (MONTHS[a] && /^\d{1,2}$/.test(b) && /^\d{4}$/.test(c)) return validDay(Number(c), MONTHS[a], Number(b));
  }
  return null;
}

export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

export function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** "15 Dec 2026" */
export function formatDay(iso) {
  const m = ISO_DAY.exec(String(iso ?? ''));
  if (!m) return String(iso ?? '');
  return `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
}

export function plural(n, word) {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}
