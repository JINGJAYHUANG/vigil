// Regulatory reporting clocks for one medical device complaint. Pure code: the same facts always give the same
// clocks, and every clock carries the rule it comes from. People confirm the facts; Vigil only does the arithmetic.
//
// US (21 CFR Part 803, manufacturers):
//   803.50(a)  30 calendar days after becoming aware of information that reasonably suggests the device
//              (1) may have caused or contributed to a death or serious injury, or (2) malfunctioned and would be
//              likely to cause or contribute to a death or serious injury if the malfunction recurred.
//   803.53     5 work days when the event (a) needs remedial action to prevent an unreasonable risk of substantial
//              harm to the public health, or (b) FDA asked in writing for 5-day reports.
//   803.56     supplemental report within 30 calendar days of receiving new information.
// EU (Regulation (EU) 2017/745, MDR):
//   Art. 2(65) serious incident: led, might have led or might lead to death, serious deterioration of health or a
//              serious public health threat.
//   Art. 87(3) 15 days; 87(5) 10 days for a death or an unanticipated serious deterioration; 87(4) 2 days for a
//              serious public health threat; 87(7) when unsure whether it is reportable, report within the limit anyway;
//              87(1)(a) documented and quantified expected side-effects go to trend reporting (Art. 88) instead.
// MDCG 2023-3 Rev.2 (January 2025), Q12-Q15, on how to apply these EU limits:
//   - calendar days; the awareness date is day 0 (the first employee or representative who received the information);
//   - if the last day is a Saturday, Sunday or public holiday, the limit moves to the next working day, and a period of
//     two days or more includes at least two working days (Regulation (EEC, Euratom) No 1182/71, Art. 3(4)-(5));
//   - 'unanticipated' means the condition leading to the deterioration was not considered in the risk assessment;
//   - if a complaint first judged not reportable becomes reportable on new information, the period starts on the date
//     of that information (the 'awareness date of reportability').

import { addDays, daysBetween, formatDay, isIsoDate, plural } from './dates.js';
import { addWorkDays, skippedDays, weekday } from './holidays.js';

export const CRITERIA = [
  { key: 'death', label: 'Death' },
  { key: 'seriousInjury', label: 'Serious injury, or serious deterioration of health' },
  { key: 'malfunction', label: 'Device malfunctioned' },
  { key: 'couldCauseSeriousInjury', label: 'If the malfunction recurred, it would be likely to cause death or serious injury' },
  { key: 'publicHealthThreat', label: 'Serious public health threat' },
  { key: 'unanticipated', label: 'The serious deterioration was unanticipated' },
  { key: 'remedialAction', label: 'Remedial action needed to prevent an unreasonable risk of substantial harm' },
  { key: 'fdaRequest', label: 'FDA asked in writing for 5-day reports on events like this' },
  { key: 'expectedSideEffect', label: 'Expected side-effect, documented and quantified in the technical documentation' },
];
export const CRITERIA_KEYS = CRITERIA.map((c) => c.key);
export const CAUSALITY = ['established', 'possible', 'excluded', 'unknown'];

export const STATUS_RANK = {
  overdue: 0, 'due-today': 1, 'due-soon': 2, 'needs-assessment': 3, open: 4, 'submitted-late': 5, submitted: 6, 'not-required': 7,
};
export const DUE_SOON_DAYS = 3;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (iso) => `${DAY_NAMES[weekday(iso)]} ${formatDay(iso)}`;

export function triState(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (['yes', 'y', 'true'].includes(v)) return 'yes';
  if (['no', 'n', 'false'].includes(v)) return 'no';
  return 'unknown';
}

export function causalityOf(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (['established', 'confirmed', 'yes'].includes(v)) return 'established';
  if (['possible', 'reasonably possible', 'probable', 'likely'].includes(v)) return 'possible';
  if (['excluded', 'ruled out', 'no'].includes(v)) return 'excluded';
  return 'unknown';
}

/** Normalizes stored criteria: { key: 'yes'|'no'|'unknown' } plus causality. */
export function normalizeCriteria(raw = {}) {
  const out = {};
  for (const key of CRITERIA_KEYS) out[key] = triState(raw[key]?.value ?? raw[key]);
  out.causality = causalityOf(raw.causality?.value ?? raw.causality);
  return out;
}

export function statusOf(dueDate, submittedOn, today) {
  if (submittedOn) return submittedOn <= dueDate ? 'submitted' : 'submitted-late';
  const left = daysBetween(today, dueDate);
  if (left < 0) return 'overdue';
  if (left === 0) return 'due-today';
  if (left <= DUE_SOON_DAYS) return 'due-soon';
  return 'open';
}

export function statusLabel(req) {
  switch (req.status) {
    case 'overdue': return `Overdue by ${plural(-req.daysLeft, 'day')}`;
    case 'due-today': return 'Due today';
    case 'due-soon':
    case 'open': return `Due in ${plural(req.daysLeft, 'day')}`;
    case 'needs-assessment': return req.daysLeft < 0 ? 'Needs assessment (limit passed)' : 'Needs assessment';
    case 'submitted': return 'Submitted';
    case 'submitted-late': return 'Submitted late';
    case 'not-required': return 'Not reportable';
    default: return req.status;
  }
}

function requirement({ id, regulator, report, cite, start, due, today, reason, submission, potential = false }) {
  const status = potential ? 'needs-assessment' : statusOf(due, submission?.on ?? null, today);
  const req = {
    id, regulator, report, cite, startDate: start, dueDate: due, daysLeft: daysBetween(today, due), status, reason,
    potential, submittedOn: submission?.on ?? null, reference: submission?.ref ?? null,
  };
  return { ...req, label: statusLabel(req) };
}

function notRequired({ id, regulator, reason }) {
  return { id, regulator, report: 'No report', cite: null, startDate: null, dueDate: null, daysLeft: null, status: 'not-required', reason, potential: false, label: 'Not reportable' };
}

function usRequirements(c, { aware, today, submissions, remedialDate, newInfoDate }) {
  const yes = (k) => c[k] === 'yes';
  const unk = (k) => c[k] === 'unknown';
  const excluded = c.causality === 'excluded';
  const harm = yes('death') || yes('seriousInjury');
  const a1 = harm && !excluded;
  const a2 = yes('malfunction') && yes('couldCauseSeriousInjury');
  const thirtyDue = addDays(aware, 30);

  if (!a1 && !a2) {
    const open = (!excluded && (unk('death') || unk('seriousInjury'))) || unk('malfunction') || (yes('malfunction') && unk('couldCauseSeriousInjury'));
    if (open) {
      return [requirement({
        id: 'FDA', regulator: 'FDA', report: '30-day MDR', cite: '21 CFR 803.50(a)', start: aware, due: thirtyDue, today, potential: true,
        reason: `Not yet decided. If it is reportable, the FDA report is due ${formatDay(thirtyDue)}, 30 calendar days after awareness on ${formatDay(aware)}.`,
      })];
    }
    const why = harm && excluded
      ? 'the device did not cause or contribute to the death or serious injury'
      : 'there was no death or serious injury, and the malfunction would not be likely to cause one if it recurred';
    return [notRequired({ id: 'FDA', regulator: 'FDA', reason: `Not reportable to FDA: ${why}.` })];
  }

  const basis = a1
    ? `${yes('death') ? 'Death' : 'Serious injury'}, and the device may have caused or contributed (21 CFR 803.50(a)(1))`
    : 'Malfunction that would be likely to cause or contribute to a death or serious injury if it recurred (21 CFR 803.50(a)(2))';
  const out = [];
  const fiveDay = yes('remedialAction') || yes('fdaRequest');
  const fiveStart = isIsoDate(remedialDate) ? remedialDate : aware;
  const fiveDue = fiveDay ? addWorkDays(fiveStart, 5) : null;
  const fiveWhy = yes('remedialAction')
    ? 'remedial action is needed to prevent an unreasonable risk of substantial harm (21 CFR 803.53(a))'
    : 'FDA asked in writing for 5-day reports (21 CFR 803.53(b))';
  const skipped = fiveDay ? skippedDays(fiveStart, fiveDue) : [];
  const skippedText = skipped.length ? ` Not counted: ${skipped.map(dayLabel).join(', ')}.` : '';

  if (fiveDay && fiveDue <= thirtyDue) {
    out.push(requirement({
      id: 'FDA', regulator: 'FDA', report: '5-day report', cite: '21 CFR 803.53', start: fiveStart, due: fiveDue, today, submission: submissions.FDA,
      reason: `${basis}, and ${fiveWhy}: 5 work days from ${formatDay(fiveStart)}.${skippedText}`,
    }));
  } else {
    out.push(requirement({
      id: 'FDA', regulator: 'FDA', report: '30-day MDR', cite: '21 CFR 803.50(a)', start: aware, due: thirtyDue, today, submission: submissions.FDA,
      reason: `${basis}: 30 calendar days from awareness on ${formatDay(aware)}.`,
    }));
    if (fiveDay) {
      out.push(requirement({
        id: 'FDA-5', regulator: 'FDA', report: '5-day report', cite: '21 CFR 803.53', start: fiveStart, due: fiveDue, today, submission: submissions['FDA-5'],
        reason: `Later, ${fiveWhy}: 5 work days from ${formatDay(fiveStart)}.${skippedText}`,
      }));
    }
  }

  const filed = submissions.FDA?.on;
  if (filed && isIsoDate(newInfoDate) && newInfoDate >= filed) {
    const due = addDays(newInfoDate, 30);
    out.push(requirement({
      id: 'FDA-SUPP', regulator: 'FDA', report: 'Supplemental report', cite: '21 CFR 803.56', start: newInfoDate, due, today, submission: submissions['FDA-SUPP'],
      reason: `New information received on ${formatDay(newInfoDate)}, after the FDA report of ${formatDay(filed)}: 30 calendar days to send it (21 CFR 803.56).`,
    }));
  }
  return out;
}

/**
 * The latest EU reporting date for a period of `days` calendar days after day 0, with the Regulation 1182/71
 * Art. 3(4)-(5) adjustments that MDCG 2023-3 Q14 refers to. `holidays` are extra non-working days (the competent
 * authority's public holidays, from the product settings).
 */
export function euLatestDate(day0, days, holidays = []) {
  const extra = new Set(holidays);
  const nonWorking = (d) => { const w = weekday(d); return w === 0 || w === 6 || extra.has(d); };
  const nominal = addDays(day0, days);
  let end = nominal;
  while (nonWorking(end)) end = addDays(end, 1);
  const working = () => { let n = 0; for (let d = addDays(day0, 1); d <= end; d = addDays(d, 1)) if (!nonWorking(d)) n += 1; return n; };
  if (days >= 2) {
    while (working() < 2) { end = addDays(end, 1); while (nonWorking(end)) end = addDays(end, 1); }
  }
  let note = '';
  if (end !== nominal) {
    note = ` Day ${days} is ${dayLabel(nominal)}. Under Regulation 1182/71 Art. 3(4)${days >= 2 ? '-(5)' : ''} (MDCG 2023-3 Q14) the legal limit moves to ${dayLabel(end)}; Vigil counts down to the earlier date.`;
  }
  return { nominal, end, note };
}

function euRequirements(c, { aware, today, submissions, euHolidays }) {
  const yes = (k) => c[k] === 'yes';
  const unk = (k) => c[k] === 'unknown';
  const mightLead = yes('malfunction') && yes('couldCauseSeriousInjury');
  const serious = yes('death') || yes('seriousInjury') || yes('publicHealthThreat') || mightLead;

  if (!serious) {
    const open = unk('death') || unk('seriousInjury') || unk('publicHealthThreat') || unk('malfunction') || (yes('malfunction') && unk('couldCauseSeriousInjury'));
    if (open) {
      const { nominal: due, note } = euLatestDate(aware, 15, euHolidays);
      return [requirement({
        id: 'EU', regulator: 'EU', report: 'Serious incident report', cite: 'MDR Art. 87', start: aware, due, today, potential: true,
        reason: `Not yet decided. If it is a serious incident, the EU report is due ${formatDay(due)} (15 days; 10 days for a death or unanticipated serious deterioration, 2 days for a serious public health threat). Art. 87(7): when unsure, report within the limit anyway.${note}`,
      })];
    }
    return [notRequired({ id: 'EU', regulator: 'EU', reason: 'Not a serious incident: no death, serious deterioration of health or public health threat, and the malfunction would not be likely to lead to one. It counts towards trend reporting (MDR Art. 88).' })];
  }
  if (yes('expectedSideEffect')) {
    return [notRequired({ id: 'EU', regulator: 'EU', reason: 'Expected side-effect that is documented in the product information and quantified in the technical documentation: no individual report, but it counts towards trend reporting (MDR Art. 87(1)(a) and Art. 88).' })];
  }
  if (c.causality === 'excluded') {
    return [notRequired({ id: 'EU', regulator: 'EU', reason: 'Causal relationship with the device excluded, so it is not reportable in the EU. Keep the rationale with the complaint.' })];
  }

  let days = 15;
  let cite = 'MDR Art. 87(3)';
  let what = 'Serious incident';
  if (yes('publicHealthThreat')) {
    days = 2; cite = 'MDR Art. 87(4)'; what = 'Serious public health threat';
  } else if (yes('death')) {
    days = 10; cite = 'MDR Art. 87(5)'; what = 'Death';
  } else if (yes('seriousInjury') && (yes('unanticipated') || unk('unanticipated'))) {
    days = 10; cite = 'MDR Art. 87(5)';
    what = yes('unanticipated')
      ? 'Unanticipated serious deterioration of health (the condition is not in the risk assessment)'
      : 'Serious deterioration of health that is not yet confirmed as anticipated in the risk assessment (Vigil uses the shorter limit until you confirm)';
  } else if (yes('seriousInjury')) {
    what = 'Serious deterioration of health that the risk assessment anticipated';
  } else if (mightLead) {
    what = 'Malfunction that might lead to death or serious deterioration of health';
  }
  const { nominal: due, note } = euLatestDate(aware, days, euHolidays);
  const causal = c.causality === 'unknown'
    ? ' The causal relationship is not yet established; report within the limit anyway (Art. 87(7)).'
    : c.causality === 'possible' ? ' A causal relationship is reasonably possible.' : '';
  return [requirement({
    id: 'EU', regulator: 'EU', report: days === 2 ? 'Serious public health threat report' : 'Serious incident report', cite, start: aware, due, today, submission: submissions.EU,
    reason: `${what}: within ${days} days of awareness on ${formatDay(aware)} (${cite}).${causal}${note}`,
  })];
}

function pickOverall(requirements) {
  const ranked = [...requirements].sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || ((a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9)));
  const top = ranked[0];
  if (!top) return { status: 'not-required', label: 'No market configured', dueDate: null, daysLeft: null };
  return { status: top.status, label: top.label, dueDate: top.dueDate, daysLeft: top.daysLeft, regulator: top.regulator, report: top.report };
}

/**
 * Computes every reporting requirement for a complaint.
 * assessment: { awarenessDate, reportabilityDate?, criteria, remedialDate?, newInfoDate?,
 *               submissions: { FDA: { on, ref }, EU: {...}, ... } } or null.
 * provisionalAwareness: the date to use when there is no assessment yet (the complaint's creation date).
 * reportabilityDate: when a complaint first judged not reportable became reportable on new information, the
 * periods start on that date instead (MDCG 2023-3 Q14-Q15).
 */
export function computeClocks({ markets = ['US', 'EU'], assessment = null, provisionalAwareness = null, today, euHolidays = [] }) {
  const assessed = Boolean(assessment && isIsoDate(assessment.awarenessDate));
  const initial = assessed ? assessment.awarenessDate : provisionalAwareness;
  if (!isIsoDate(initial)) return { assessed, awarenessDate: null, provisional: !assessed, requirements: [], overall: pickOverall([]) };
  const later = assessed && isIsoDate(assessment.reportabilityDate) && assessment.reportabilityDate > initial ? assessment.reportabilityDate : null;
  const aware = later ?? initial;
  const criteria = normalizeCriteria(assessed ? assessment.criteria : {});
  const submissions = (assessed && assessment.submissions) || {};
  const ctx = { aware, today, submissions, remedialDate: assessment?.remedialDate, newInfoDate: assessment?.newInfoDate, euHolidays };
  const set = new Set((markets ?? []).map((m) => String(m).toUpperCase()));
  const requirements = [
    ...(set.has('US') ? usRequirements(criteria, ctx) : []),
    ...(set.has('EU') ? euRequirements(criteria, ctx) : []),
  ];
  return {
    assessed, awarenessDate: initial, reportabilityDate: later, clockStart: aware, provisional: !assessed, criteria, requirements,
    overall: pickOverall(requirements),
  };
}

/** The earliest due date that still needs action (for the lifecycle-due index), or null. */
export function nextDue(clocks) {
  const open = clocks.requirements.filter((r) => r.dueDate && !['submitted', 'submitted-late', 'not-required'].includes(r.status));
  return open.length ? open.map((r) => r.dueDate).sort()[0] : null;
}

/** True when every requirement is submitted or not required. */
export function isSettled(clocks) {
  return clocks.requirements.length > 0 && clocks.requirements.every((r) => ['submitted', 'submitted-late', 'not-required'].includes(r.status));
}
