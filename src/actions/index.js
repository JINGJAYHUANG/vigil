// Rovo actions for the Vigil agent. Reads run as the current user; outputs are capped at 50 KB.

import { todayIso } from '../engine/dates.js';
import { CRITERIA_KEYS } from '../engine/clocks.js';
import { cloudIdFrom } from '../platform/twg.js';
import {
  complaintFacts, dueList, recordAssessment, recordSubmission, riskFile, trends, writeDecisionRecord,
} from '../services/complaints.js';
import { fitOutput } from '../shared/limits.js';

const MAX_FACTS = 30_000;

/** The complaint to work on: an explicit key, otherwise the Jira work item the agent was opened on. */
export function complaintKeyFrom(payload) {
  const ctx = payload?.context ?? {};
  const candidates = [payload?.complaintKey, ctx.jira?.issueKey, ctx.jira?.issue?.key, ctx.issueKey];
  for (const value of candidates) {
    const s = String(value ?? '').trim().toUpperCase();
    if (/^[A-Z][A-Z0-9_]+-\d+$/.test(s)) return s;
    const m = /\/browse\/([A-Z][A-Z0-9_]+-\d+)/.exec(s);
    if (m) return m[1];
  }
  return null;
}

async function guarded(name, run, listKey = 'results') {
  try {
    const result = await run();
    console.log(`${name} ok=${result?.ok}${result?.error ? ` error=${result.error}` : ''}`);
    return fitOutput({ today: todayIso(), ...result }, { listKey });
  } catch (error) {
    console.log(`${name} failed: ${error?.message}`);
    return { ok: false, error: `${name} failed.` };
  }
}

const needKey = { ok: false, error: 'Open the complaint work item, or give its key (for example CMP-1).' };

export async function actionGetComplaint(payload) {
  const key = complaintKeyFrom(payload);
  if (!key) return needKey;
  return guarded('get-complaint', async () => {
    const result = await complaintFacts(key, { cloudId: cloudIdFrom(payload?.context) });
    if (result.ok && result.facts.length > MAX_FACTS) return { ...result, facts: `${result.facts.slice(0, MAX_FACTS)}…`, truncated: true };
    return result;
  }, 'criteria');
}

export async function actionGetRiskFile(payload) {
  return guarded('get-risk-file', () => riskFile({
    complaintKey: complaintKeyFrom(payload), productKey: payload?.productKey, cloudId: cloudIdFrom(payload?.context),
  }), 'linkedPages');
}

export async function actionRecordAssessment(payload) {
  const key = complaintKeyFrom(payload);
  if (!key) return needKey;
  const input = { complaintKey: key };
  for (const k of ['answers', ...CRITERIA_KEYS, 'causality', 'awarenessDate', 'awarenessQuote', 'reportabilityDate', 'remedialDate', 'evidence', 'rationale']) {
    input[k] = payload?.[k];
  }
  return guarded('record-assessment', () => recordAssessment(input), 'none');
}

export async function actionRecordSubmission(payload) {
  const key = complaintKeyFrom(payload);
  if (!key) return needKey;
  return guarded('record-submission', () => recordSubmission({
    complaintKey: key, regulator: payload?.regulator, submittedOn: payload?.submittedOn, reference: payload?.reference, newInfoDate: payload?.newInfoDate,
  }), 'none');
}

export async function actionListDue(payload) {
  const within = Number.parseInt(payload?.withinDays, 10);
  return guarded('list-due', () => dueList({ withinDays: Number.isFinite(within) && within >= 0 ? Math.min(within, 90) : 14 }));
}

export async function actionTrendCheck(payload) {
  return guarded('trend-check', () => trends({ productKey: payload?.productKey }));
}

export async function actionWriteDecisionRecord(payload) {
  const key = complaintKeyFrom(payload);
  if (!key) return needKey;
  return guarded('write-decision-record', () => writeDecisionRecord({ complaintKey: key }), 'none');
}
