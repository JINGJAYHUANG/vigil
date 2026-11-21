// Trigger handlers. When a complaint gets a comment or is updated (Jira events), and once a day (scheduled trigger),
// Vigil recomputes the clocks as the app and comments on the complaint when a report becomes due within 3 days or
// overdue, or when an unassessed complaint is close to a possible limit. One comment per clock and stage; the
// stage resets when the clock is back to normal (for example, after a submission is recorded).

import { formatDay, plural } from '../engine/dates.js';
import { nextDue, isSettled } from '../engine/clocks.js';
import { addComment, fetchComplaint } from '../platform/jira.js';
import { getAssessment, getNotified, setNotified, putAssessment, NO_DUE } from '../store/assessments.js';
import { listProducts, productForProject } from '../store/products.js';
import { clocksFor, productRows } from './complaints.js';

function when(r) {
  if (r.daysLeft < 0) return `was due ${formatDay(r.dueDate)}, ${plural(-r.daysLeft, 'day')} ago`;
  if (r.daysLeft === 0) return `is due today, ${formatDay(r.dueDate)}`;
  return `is due ${formatDay(r.dueDate)}, in ${plural(r.daysLeft, 'day')}`;
}

const lower = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** The stage a clock is in for reminders, or null when no reminder is needed. */
export function stageOf(r) {
  if (r.status === 'overdue') return 'overdue';
  if (r.status === 'due-soon' || r.status === 'due-today') return 'due-soon';
  if (r.status === 'needs-assessment' && r.daysLeft <= 3) return r.daysLeft < 0 ? 'unassessed-passed' : 'unassessed-soon';
  return null;
}

export function reminderText(complaint, r, provisional) {
  const who = r.regulator === 'EU' ? 'EU' : 'FDA';
  if (r.status === 'needs-assessment') {
    const from = provisional ? ' Vigil counts from the day the complaint was created; the real awareness date may be earlier.' : '';
    return [
      `Vigil: ${complaint.key} has no reportability decision yet. If it is reportable, the ${who} ${lower(r.report)} ${when(r)} (${r.cite}).${from}`,
      'Assess it in the Reporting clocks panel, or ask the Vigil agent: "Assess this complaint".',
    ].join('\n');
  }
  return [
    `Vigil: the ${who} ${lower(r.report)} for ${complaint.key} ${when(r)}. It is not marked as submitted.`,
    `Basis: ${r.reason}`,
  ].join('\n');
}

/** Recomputes one complaint's clocks and posts the reminders that are due. Returns the number of comments. */
export async function refreshAndNotify({ complaint, assessment, clocks }) {
  const notified = await getNotified(complaint.key);
  let changed = false;
  let alerts = 0;
  for (const r of clocks.requirements) {
    const stage = stageOf(r);
    if (!stage) {
      if (notified[r.id]) { delete notified[r.id]; changed = true; }
      continue;
    }
    if (notified[r.id] === stage) continue;
    if (await addComment(complaint.key, reminderText(complaint, r, clocks.provisional), { asApp: true })) {
      notified[r.id] = stage;
      changed = true;
      alerts += 1;
    }
  }
  for (const id of Object.keys(notified)) {
    if (id !== 'supp-hint' && !clocks.requirements.some((r) => r.id === id)) { delete notified[id]; changed = true; }
  }
  if (changed) await setNotified(complaint.key, notified);
  if (assessment) {
    const due = nextDue(clocks) ?? NO_DUE;
    const lifecycle = isSettled(clocks) ? 'closed' : 'open';
    if (due !== assessment.nextDue || lifecycle !== assessment.lifecycle) await putAssessment({ ...assessment, nextDue: due, lifecycle });
  }
  return alerts;
}

/** After a report was sent, a new comment may be new information: remind once about the 803.56 supplemental clock. */
async function supplementalHint(complaint, assessment) {
  const filed = assessment?.submissions?.FDA?.on;
  if (!filed || assessment.newInfoDate) return;
  const notified = await getNotified(complaint.key);
  if (notified['supp-hint']) return;
  const text = [
    `Vigil: a comment was added after the FDA report of ${formatDay(filed)}.`,
    'If it brings information the report did not include, a supplemental report is due within 30 calendar days of receiving it (21 CFR 803.56). Record the date in the Reporting clocks panel to start that clock.',
  ].join('\n');
  if (await addComment(complaint.key, text, { asApp: true })) await setNotified(complaint.key, { ...notified, 'supp-hint': 'sent' });
}

export async function onComplaintEvent(event) {
  const key = event?.issue?.key;
  const projectKey = event?.issue?.fields?.project?.key;
  if (!key) return;
  const product = await productForProject(projectKey ?? String(key).split('-')[0]);
  if (!product) return;
  const res = await fetchComplaint(key, { asApp: true });
  if (!res.ok) return;
  const assessment = await getAssessment(key);
  const clocks = clocksFor(product, assessment, res.complaint);
  const alerts = await refreshAndNotify({ complaint: res.complaint, assessment, clocks });
  if (event?.comment && event?.eventType !== 'avi:jira:updated:issue') await supplementalHint(res.complaint, assessment);
  console.log(`complaint-event ${key} alerts=${alerts}`);
}

export async function dailySweep() {
  let checked = 0;
  let alerts = 0;
  for (const product of await listProducts()) {
    for (const row of await productRows(product, { asApp: true })) {
      checked += 1;
      alerts += await refreshAndNotify(row);
    }
  }
  console.log(`daily-sweep checked=${checked} alerts=${alerts}`);
}
