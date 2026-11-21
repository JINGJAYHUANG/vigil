// Complaint views, assessments, submissions, trends and decision records. Reads for people run as the current user.

import { computeClocks, nextDue, isSettled, CRITERIA, CRITERIA_KEYS, causalityOf, triState, STATUS_RANK } from '../engine/clocks.js';
import { trendSignals } from '../engine/trend.js';
import { formatDay, toIsoDate, todayIso } from '../engine/dates.js';
import { factSheet, problemCodeOf, isReportedIndividually, parseAnswers, parseEvidence } from '../engine/settings.js';
import { fetchComplaint, fetchComments, searchComplaints, isIssueKey } from '../platform/jira.js';
import { workItemComments, riskFileGraph, pageOwners } from '../platform/twg.js';
import { fetchPage, createPage } from '../platform/confluence.js';
import { getAssessment, putAssessment, listByProduct } from '../store/assessments.js';
import { listProducts, productForProject, productByKey } from '../store/products.js';

const SETTLED = new Set(['submitted', 'submitted-late', 'not-required']);
const MAX_PAGE_TEXT = 6000;

export function clocksFor(product, assessment, complaint, day = todayIso()) {
  return computeClocks({
    markets: product?.markets ?? ['US', 'EU'], assessment, provisionalAwareness: complaint?.createdOn, today: day,
    euHolidays: product?.euHolidays ?? [],
  });
}

/** A compact form of the clocks for actions and the UI. */
export function brief(clocks) {
  return {
    assessed: clocks.assessed,
    awarenessDate: clocks.awarenessDate,
    clockStart: clocks.clockStart ?? clocks.awarenessDate,
    provisional: clocks.provisional,
    overall: clocks.overall,
    requirements: clocks.requirements.map((r) => ({
      id: r.id, regulator: r.regulator, report: r.report, cite: r.cite, dueDate: r.dueDate,
      dueDateText: r.dueDate ? formatDay(r.dueDate) : null, daysLeft: r.daysLeft, status: r.status, label: r.label,
      reason: r.reason, submittedOn: r.submittedOn ?? null, reference: r.reference ?? null,
    })),
  };
}

/** Complaint, product, assessment and clocks for one work item. */
export async function complaintView(key, { asApp = false } = {}) {
  const res = await fetchComplaint(key, { asApp });
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.status === 404 || res.status === 403 ? `Cannot find ${key}, or you cannot view it.` : `Jira returned ${res.status} for ${key}.` };
  }
  const complaint = res.complaint;
  const product = await productForProject(complaint.projectKey);
  const assessment = await getAssessment(complaint.key);
  return { ok: true, complaint, product, assessment, clocks: clocksFor(product, assessment, complaint) };
}

const noProduct = (projectKey) => `No Vigil product is set up for the Jira project ${projectKey}. Add it in Apps > Vigilance > Products.`;

/** Everything the agent needs to assess a complaint: the description and every comment with its date. */
export async function complaintFacts(key, { cloudId } = {}) {
  const view = await complaintView(key);
  if (!view.ok) return view;
  const { complaint, product, assessment, clocks } = view;
  let source = 'Teamwork Graph';
  let { comments } = await workItemComments(cloudId, complaint.id);
  if (!comments.length) {
    comments = await fetchComments(complaint.key);
    source = 'Jira REST API';
  }
  return {
    ok: true,
    complaint: { key: complaint.key, summary: complaint.summary, createdOn: complaint.createdOn, labels: complaint.labels, url: complaint.url },
    product: product ? { key: product.key, name: product.name, markets: product.markets, hasRiskFile: Boolean(product.riskFilePageId) } : null,
    productMissing: product ? undefined : noProduct(complaint.projectKey),
    facts: factSheet(complaint, comments),
    commentCount: comments.length,
    commentsSource: source,
    criteria: [...CRITERIA.map((c) => ({ key: c.key, question: c.label })), { key: 'causality', question: 'Causal relationship with the device: established, possible, excluded or unknown' }],
    current: assessment ? { awarenessDate: assessment.awarenessDate, criteria: assessment.criteria, rationale: assessment.rationale } : null,
    clocks: brief(clocks),
  };
}

/** The product's risk management file and the pages it links to (found through Teamwork Graph), with owners. */
export async function riskFile({ complaintKey, productKey, cloudId }) {
  let product = productKey ? await productByKey(productKey) : null;
  if (!product && isIssueKey(complaintKey)) {
    const res = await fetchComplaint(complaintKey);
    if (!res.ok) return { ok: false, error: `Cannot find ${complaintKey}, or you cannot view it.` };
    product = await productForProject(res.complaint.projectKey);
    if (!product) return { ok: false, error: noProduct(res.complaint.projectKey) };
  }
  if (!product) return { ok: false, error: 'Give a complaint key or a product key.' };
  if (!product.riskFilePageId) return { ok: false, error: `No risk management file page is set for ${product.name}.` };

  const root = await fetchPage(product.riskFilePageId);
  if (!root.ok) return { ok: false, error: 'Cannot open the risk management file page, or you cannot view it.' };
  const graph = await riskFileGraph(cloudId, product.riskFilePageId);
  let linked = graph.linked;
  let source = 'Teamwork Graph';
  if (!linked.length) {
    linked = root.links.map((pageId) => ({ pageId, title: null, url: null }));
    source = 'Confluence REST API (links in the page)';
  }
  const pages = [];
  for (const link of linked.slice(0, 6)) {
    const page = await fetchPage(link.pageId);
    if (!page.ok) continue;
    pages.push({
      pageId: page.page.id, title: page.page.title, url: page.page.url,
      owners: await pageOwners(cloudId, page.page.id),
      text: page.text.length > MAX_PAGE_TEXT ? `${page.text.slice(0, MAX_PAGE_TEXT)}…` : page.text,
    });
  }
  return {
    ok: true,
    product: { key: product.key, name: product.name },
    riskFile: { pageId: root.page.id, title: root.page.title, url: root.page.url, owners: graph.owners, text: root.text.slice(0, 3000) },
    linkedPages: pages,
    linksSource: source,
  };
}

/** Saves (or replaces) the assessment of a complaint and returns the clocks. Submissions already recorded are kept. */
export async function recordAssessment(input) {
  const key = String(input?.complaintKey ?? '').trim().toUpperCase();
  if (!isIssueKey(key)) return { ok: false, error: 'Give the complaint work item key, for example CMP-1.' };
  const view = await complaintView(key);
  if (!view.ok) return view;
  if (!view.product) return { ok: false, error: noProduct(view.complaint.projectKey) };
  const today = todayIso();
  const awarenessDate = toIsoDate(input.awarenessDate);
  if (!awarenessDate) return { ok: false, error: 'The awareness date must be a calendar date (YYYY-MM-DD).' };
  if (awarenessDate > today) return { ok: false, error: 'The awareness date cannot be in the future.' };
  const optionalDate = (v, name) => {
    if (v === undefined || v === null || String(v).trim() === '') return { value: null };
    const d = toIsoDate(v);
    if (!d) return { error: `${name} must be a calendar date (YYYY-MM-DD).` };
    if (d < awarenessDate) return { error: `${name} cannot be before the awareness date.` };
    return { value: d };
  };
  const remedial = optionalDate(input.remedialDate, 'The remedial action date');
  const reportable = optionalDate(input.reportabilityDate, 'The reportability date');
  if (remedial.error || reportable.error) return { ok: false, error: remedial.error ?? reportable.error };

  const answers = parseAnswers(input.answers);
  const criteria = {};
  for (const k of CRITERIA_KEYS) criteria[k] = triState(input[k] ?? answers[k]);
  criteria.causality = causalityOf(input.causality ?? answers.causality);
  const existing = view.assessment;
  const now = new Date().toISOString();
  const record = {
    complaintKey: key,
    productKey: view.product.key,
    awarenessDate,
    awarenessQuote: String(input.awarenessQuote ?? '').trim().slice(0, 500),
    reportabilityDate: reportable.value,
    remedialDate: remedial.value,
    criteria,
    evidence: { ...parseEvidence(input.evidence), ...(input.evidenceMap ?? {}) },
    rationale: String(input.rationale ?? '').trim().slice(0, 2000),
    submissions: existing?.submissions ?? {},
    newInfoDate: existing?.newInfoDate ?? null,
    decisionPageId: existing?.decisionPageId ?? null,
    decisionPageUrl: existing?.decisionPageUrl ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const clocks = clocksFor(view.product, record, view.complaint, today);
  record.lifecycle = isSettled(clocks) ? 'closed' : 'open';
  record.nextDue = nextDue(clocks);
  await putAssessment(record);
  return { ok: true, complaintKey: key, replaced: Boolean(existing), clocks: brief(clocks) };
}

const REGULATORS = { FDA: 'FDA', 'FDA-5': 'FDA-5', 'FDA-SUPP': 'FDA-SUPP', EU: 'EU' };
function regulatorId(value) {
  const v = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '-');
  if (REGULATORS[v]) return REGULATORS[v];
  if (/SUPP/.test(v)) return 'FDA-SUPP';
  if (/5/.test(v) && /FDA|US/.test(v)) return 'FDA-5';
  if (/FDA|US/.test(v)) return 'FDA';
  if (/EU|MIR|EUDAMED|COMPETENT/.test(v)) return 'EU';
  return null;
}

/** Records a report sent to a regulator (date and reference), or the date new information arrived. */
export async function recordSubmission(input) {
  const key = String(input?.complaintKey ?? '').trim().toUpperCase();
  if (!isIssueKey(key)) return { ok: false, error: 'Give the complaint work item key, for example CMP-1.' };
  const view = await complaintView(key);
  if (!view.ok) return view;
  if (!view.assessment) return { ok: false, error: `${key} has no reportability assessment yet. Assess it first.` };
  const today = todayIso();
  const record = { ...view.assessment, submissions: { ...(view.assessment.submissions ?? {}) } };
  const changes = [];
  if (input.regulator) {
    const id = regulatorId(input.regulator);
    if (!id) return { ok: false, error: 'Regulator: FDA, FDA-5 (separate 5-day report), FDA-SUPP (supplemental) or EU.' };
    const on = toIsoDate(input.submittedOn) ?? today;
    if (on > today) return { ok: false, error: 'The submission date cannot be in the future.' };
    record.submissions[id] = { on, ref: String(input.reference ?? '').trim().slice(0, 80) || null };
    changes.push(`${id} report sent on ${formatDay(on)}`);
  }
  if (input.newInfoDate) {
    const d = toIsoDate(input.newInfoDate);
    if (!d || d > today) return { ok: false, error: 'The new information date must be a calendar date, not in the future.' };
    record.newInfoDate = d;
    changes.push(`new information received on ${formatDay(d)}`);
  }
  if (!changes.length) return { ok: false, error: 'Give a regulator and submission date, or the date new information arrived.' };
  record.updatedAt = new Date().toISOString();
  const clocks = clocksFor(view.product, record, view.complaint, today);
  record.lifecycle = isSettled(clocks) ? 'closed' : 'open';
  record.nextDue = nextDue(clocks);
  await putAssessment(record);
  return { ok: true, complaintKey: key, recorded: changes, clocks: brief(clocks) };
}

/** Rows for every recent complaint of one product (as the current user, or as the app for the daily sweep). */
export async function productRows(product, { asApp = false, days = 120 } = {}) {
  const complaints = await searchComplaints(product.projectKey, { days, asApp });
  const assessments = new Map((await listByProduct(product.key)).map((a) => [a.complaintKey, a]));
  const today = todayIso();
  return complaints.map((complaint) => {
    const assessment = assessments.get(complaint.key) ?? null;
    const clocks = clocksFor(product, assessment, complaint, today);
    return { complaint, assessment, clocks, code: problemCodeOf(complaint.labels, product.problemCodes) };
  });
}

const byUrgency = (a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || ((a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));

/** Reports due within `withinDays` days (or overdue), and complaints that still need an assessment. */
export async function dueList({ withinDays = 14 } = {}) {
  const products = await listProducts();
  const items = [];
  for (const product of products) {
    for (const row of await productRows(product)) {
      for (const r of row.clocks.requirements) {
        if (SETTLED.has(r.status)) continue;
        if (r.status !== 'needs-assessment' && r.daysLeft > withinDays) continue;
        items.push({
          complaintKey: row.complaint.key, summary: row.complaint.summary, url: row.complaint.url, product: product.name,
          regulator: r.regulator, report: r.report, cite: r.cite, dueDate: r.dueDate, dueDateText: formatDay(r.dueDate),
          daysLeft: r.daysLeft, status: r.status, label: r.label, provisional: row.clocks.provisional,
        });
      }
    }
  }
  items.sort(byUrgency);
  return { ok: true, withinDays, count: items.length, results: items, configured: products.length > 0 };
}

function trendFor(product, rows, today) {
  const incidents = rows.filter((r) => r.code).map((r) => ({
    key: r.complaint.key, code: r.code, date: r.assessment?.awarenessDate ?? r.complaint.createdOn, serious: isReportedIndividually(r.clocks),
  }));
  return trendSignals({ incidents, codes: product.problemCodes, today });
}

/** Trend signals per problem code (MDR Art. 88), for one product or all of them. */
export async function trends({ productKey } = {}) {
  const products = productKey ? [await productByKey(productKey)].filter(Boolean) : await listProducts();
  if (!products.length) return { ok: false, error: productKey ? `No product ${productKey}.` : 'No products are set up yet.' };
  const today = todayIso();
  const results = [];
  for (const product of products) {
    const days = Math.max(30, ...product.problemCodes.map((c) => c.windowDays));
    const rows = await productRows(product, { days });
    results.push({ product: product.name, productKey: product.key, signals: trendFor(product, rows, today) });
  }
  return { ok: true, method: 'One-sided Poisson test of the count in the window against the expected count in the surveillance plan; alpha 0.05, at least 2 incidents. Serious incidents (reported individually) are left out.', results };
}

/** Everything the Vigilance page shows. */
export async function dashboard() {
  const products = await listProducts();
  const today = todayIso();
  const counts = { overdue: 0, 'due-today': 0, 'due-soon': 0, 'needs-assessment': 0, open: 0, submitted: 0, 'submitted-late': 0, 'not-required': 0 };
  const rows = [];
  const upcoming = [];
  const trendsOut = [];
  for (const product of products) {
    const days = Math.max(120, ...product.problemCodes.map((c) => c.windowDays));
    const productRowsList = await productRows(product, { days });
    for (const row of productRowsList) {
      const o = row.clocks.overall;
      counts[o.status] = (counts[o.status] ?? 0) + 1;
      rows.push({
        key: row.complaint.key, url: row.complaint.url, summary: row.complaint.summary, product: product.name, code: row.code,
        createdOn: row.complaint.createdOn, assessed: row.clocks.assessed, awarenessDate: row.clocks.awarenessDate,
        overall: o, dueDateText: o.dueDate ? formatDay(o.dueDate) : null,
        requirements: brief(row.clocks).requirements,
      });
      for (const r of row.clocks.requirements) {
        if (SETTLED.has(r.status) || !r.dueDate || r.daysLeft > 14) continue;
        upcoming.push({ key: row.complaint.key, url: row.complaint.url, regulator: r.regulator, report: r.report, dueDate: r.dueDate, dueDateText: formatDay(r.dueDate), daysLeft: r.daysLeft, status: r.status, label: r.label });
      }
    }
    trendsOut.push({ product: product.name, productKey: product.key, signals: trendFor(product, productRowsList, today) });
  }
  rows.sort((a, b) => byUrgency(a.overall, b.overall));
  upcoming.sort(byUrgency);
  return {
    ok: true, today, todayText: formatDay(today), products, counts, rows, upcoming, trends: trendsOut,
    open: rows.filter((r) => !SETTLED.has(r.overall.status)).length,
  };
}

const ANSWER = { yes: 'Yes', no: 'No', unknown: 'Unknown' };
const CAUSALITY_TEXT = { established: 'Established', possible: 'Reasonably possible', excluded: 'Excluded', unknown: 'Unknown' };

/** Writes a reportability decision record page in the product's quality space, as the current user. */
export async function writeDecisionRecord({ complaintKey }) {
  const key = String(complaintKey ?? '').trim().toUpperCase();
  const view = await complaintView(key);
  if (!view.ok) return view;
  const { complaint, product, assessment, clocks } = view;
  if (!product) return { ok: false, error: noProduct(complaint.projectKey) };
  if (!assessment) return { ok: false, error: `${key} has no reportability assessment yet.` };
  if (!product.qualitySpaceKey) return { ok: false, error: `No quality space is set for ${product.name}.` };
  const ev = assessment.evidence ?? {};
  const blocks = [
    { p: `Complaint ${complaint.key}: ${complaint.summary} (${complaint.url}). Product: ${product.name}.` },
    { p: `Awareness date (day 0): ${formatDay(assessment.awarenessDate)}.${assessment.awarenessQuote ? ` Source: "${assessment.awarenessQuote}"` : ''}${assessment.reportabilityDate ? ` Became reportable on new information on ${formatDay(assessment.reportabilityDate)}.` : ''}` },
    { h2: 'Reportability criteria' },
    { table: [['Criterion', 'Answer', 'Evidence'], ...CRITERIA.map((c) => [c.label, ANSWER[assessment.criteria?.[c.key]] ?? 'Unknown', ev[c.key] ?? '']), ['Causal relationship with the device', CAUSALITY_TEXT[assessment.criteria?.causality] ?? 'Unknown', ev.causality ?? '']] },
    { h2: 'Reporting clocks' },
    { table: [['Regulator', 'Report', 'Basis', 'Due', 'Status'], ...clocks.requirements.map((r) => [r.regulator, r.report, r.reason, r.dueDate ? formatDay(r.dueDate) : '-', r.label])] },
    { h2: 'Rationale' },
    { p: assessment.rationale || 'No rationale was recorded.' },
    { p: `Recorded with Vigil on ${formatDay(todayIso())}. Vigil computes the clocks from the facts people confirmed. It does not replace the complaint handling procedure and does not submit reports.` },
  ];
  const created = await createPage({ spaceKey: product.qualitySpaceKey, title: `Reportability decision ${complaint.key}: ${complaint.summary}`.slice(0, 200), blocks });
  if (!created.ok) return created;
  await putAssessment({ ...assessment, decisionPageId: created.pageId, decisionPageUrl: created.url, updatedAt: new Date().toISOString() });
  return { ok: true, complaintKey: key, page: { id: created.pageId, title: created.title, url: created.url } };
}

