// UI Kit resolvers for the Jira issue panel ("Reporting clocks") and the Jira global page ("Vigilance").

import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { CRITERIA } from '../engine/clocks.js';
import { formatProblemCodes, parseProduct } from '../engine/settings.js';
import { cloudIdFrom, riskFileGraph } from '../platform/twg.js';
import { listProducts, saveProducts } from '../store/products.js';
import {
  brief, complaintView, dashboard, recordAssessment, recordSubmission, writeDecisionRecord,
} from '../services/complaints.js';

const resolver = new Resolver();

async function safe(name, run) {
  try {
    return await run();
  } catch (error) {
    console.log(`${name} failed: ${error?.message}`);
    return { ok: false, error: 'Vigil could not complete this request.' };
  }
}

const issueKeyOf = (context) => context?.extension?.issue?.key ?? null;

resolver.define('getPanel', ({ context }) => safe('getPanel', async () => {
  const key = issueKeyOf(context);
  if (!key) return { ok: false, error: 'No work item in context.' };
  const view = await complaintView(key);
  if (!view.ok) return view;
  if (!view.product) return { ok: true, configured: false, projectKey: view.complaint.projectKey };
  const graph = view.product.riskFilePageId ? await riskFileGraph(cloudIdFrom(context), view.product.riskFilePageId) : { linked: [], owners: [] };
  const a = view.assessment;
  return {
    ok: true,
    configured: true,
    complaint: { key: view.complaint.key, summary: view.complaint.summary, createdOn: view.complaint.createdOn },
    product: { key: view.product.key, name: view.product.name, markets: view.product.markets },
    clocks: brief(view.clocks),
    assessment: a ? {
      awarenessDate: a.awarenessDate, awarenessQuote: a.awarenessQuote ?? null, reportabilityDate: a.reportabilityDate ?? null,
      remedialDate: a.remedialDate ?? null, newInfoDate: a.newInfoDate ?? null, criteria: a.criteria ?? {}, evidence: a.evidence ?? {},
      rationale: a.rationale ?? '', decisionPageUrl: a.decisionPageUrl ?? null, updatedAt: a.updatedAt,
    } : null,
    criteria: CRITERIA,
    riskFile: { linked: graph.linked.slice(0, 5), owners: graph.owners, source: 'Teamwork Graph' },
  };
}));

resolver.define('saveAssessment', ({ payload, context }) => safe('saveAssessment', () => recordAssessment({ ...payload, complaintKey: issueKeyOf(context) })));

resolver.define('recordSubmission', ({ payload, context }) => safe('recordSubmission', () => recordSubmission({ ...payload, complaintKey: issueKeyOf(context) })));

resolver.define('writeDecisionRecord', ({ context }) => safe('writeDecisionRecord', () => writeDecisionRecord({ complaintKey: issueKeyOf(context) })));

resolver.define('getDashboard', () => safe('getDashboard', async () => {
  const data = await dashboard();
  return { ...data, products: data.products.map((p) => ({ ...p, problemCodesText: formatProblemCodes(p.problemCodes) })) };
}));

/** Only people who administer the Jira project can change its Vigil settings. */
async function canAdminister(projectKey) {
  const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?projectKey=${projectKey}&permissions=ADMINISTER_PROJECTS`);
  if (!res.ok) return false;
  const body = await res.json();
  return Boolean(body.permissions?.ADMINISTER_PROJECTS?.havePermission);
}

resolver.define('saveProduct', ({ payload }) => safe('saveProduct', async () => {
  const { product, error } = parseProduct(payload);
  if (error) return { ok: false, error };
  if (!(await canAdminister(product.projectKey))) return { ok: false, error: `You need to administer the Jira project ${product.projectKey} to change its Vigil settings.` };
  const products = await listProducts();
  const clash = products.find((p) => p.projectKey === product.projectKey && p.key !== product.key);
  if (clash) return { ok: false, error: `The project ${product.projectKey} already belongs to ${clash.name}.` };
  await saveProducts([...products.filter((p) => p.key !== product.key), product].sort((a, b) => a.key.localeCompare(b.key)));
  return { ok: true, product };
}));

resolver.define('deleteProduct', ({ payload }) => safe('deleteProduct', async () => {
  const products = await listProducts();
  const target = products.find((p) => p.key === String(payload?.key ?? '').toUpperCase());
  if (!target) return { ok: false, error: 'No such product.' };
  if (!(await canAdminister(target.projectKey))) return { ok: false, error: `You need to administer the Jira project ${target.projectKey}.` };
  await saveProducts(products.filter((p) => p.key !== target.key));
  return { ok: true };
}));

export const handler = resolver.getDefinitions();
