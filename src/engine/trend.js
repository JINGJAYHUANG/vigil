// Trend signals for MDR Art. 88: "any statistically significant increase in the frequency or severity of incidents
// that are not serious incidents". The manufacturer's post-market surveillance plan sets the method and the
// observation period; Vigil applies one transparent method: a one-sided Poisson test of the count in the window
// against the expected count the plan states. A signal is a prompt for people to review, not a decision to report.

import { addDays, formatDay } from './dates.js';

/** P(X >= k) for X ~ Poisson(lambda). */
export function poissonTail(k, lambda) {
  if (!(lambda > 0)) return k > 0 ? 0 : 1;
  if (k <= 0) return 1;
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i < k; i += 1) {
    term *= lambda / i;
    cdf += term;
  }
  return Math.min(1, Math.max(0, 1 - cdf));
}

export function formatP(p) {
  if (p < 0.001) return 'p < 0.001';
  return `p = ${p.toFixed(3)}`;
}

/**
 * incidents: [{ key, code, date (YYYY-MM-DD), serious }]  (serious incidents are reported individually and excluded)
 * codes: [{ code, name, expected, windowDays }] from the product settings
 */
export function trendSignals({ incidents, codes, today, alpha = 0.05, minCount = 2 }) {
  return (codes ?? []).map((c) => {
    const windowDays = Number(c.windowDays) > 0 ? Number(c.windowDays) : 30;
    const expected = Number(c.expected) > 0 ? Number(c.expected) : 0;
    const from = addDays(today, -(windowDays - 1));
    const hits = (incidents ?? []).filter((i) => i.code === c.code && !i.serious && i.date >= from && i.date <= today);
    const k = hits.length;
    const p = poissonTail(k, expected);
    const signal = expected > 0 && k >= minCount && p < alpha;
    const reason = expected > 0
      ? `${k} in the ${windowDays} days from ${formatDay(from)} against ${expected} expected in the surveillance plan (one-sided Poisson test, ${formatP(p)}).`
      : `${k} in the ${windowDays} days from ${formatDay(from)}. No expected rate is set, so no test was run.`;
    return {
      code: c.code, name: c.name ?? c.code, windowDays, expected, observed: k, p, signal, from,
      keys: hits.map((i) => i.key), reason: signal ? `${reason} Review for a trend report (MDR Art. 88).` : reason,
    };
  });
}
