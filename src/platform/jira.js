// Jira reads and writes. Reads for people run as the current user; the event and scheduled triggers run as the app.

import api, { route } from '@forge/api';
import { adfToText, textToAdf } from './adf-text.js';

const FIELDS = 'summary,description,created,labels,project,status,issuetype';
const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]+$/;

const client = (asApp) => (asApp ? api.asApp() : api.asUser());

let baseUrl = null;
export async function siteBaseUrl({ asApp = false } = {}) {
  if (baseUrl) return baseUrl;
  try {
    const res = await client(asApp).requestJira(route`/rest/api/3/serverInfo`);
    if (res.ok) baseUrl = (await res.json()).baseUrl ?? null;
  } catch (error) {
    console.log(`serverInfo failed: ${error?.message}`);
  }
  return baseUrl;
}

export const isIssueKey = (key) => ISSUE_KEY.test(String(key ?? '').trim().toUpperCase());
export const isProjectKey = (key) => PROJECT_KEY.test(String(key ?? '').trim().toUpperCase());

function toComplaint(issue, base) {
  const f = issue?.fields ?? {};
  return {
    key: issue.key,
    id: String(issue.id),
    summary: f.summary ?? '',
    description: typeof f.description === 'object' ? adfToText(f.description) : String(f.description ?? ''),
    createdAt: f.created ?? null,
    createdOn: f.created ? String(f.created).slice(0, 10) : null,
    labels: f.labels ?? [],
    projectKey: f.project?.key ?? null,
    statusName: f.status?.name ?? '',
    statusCategory: f.status?.statusCategory?.key ?? 'new',
    url: base ? `${base}/browse/${issue.key}` : `/browse/${issue.key}`,
  };
}

/** One complaint work item, or { ok: false } when the caller cannot see it. */
export async function fetchComplaint(key, { asApp = false } = {}) {
  const k = String(key ?? '').trim().toUpperCase();
  if (!ISSUE_KEY.test(k)) return { ok: false, status: 400 };
  try {
    const res = await client(asApp).requestJira(route`/rest/api/3/issue/${k}?fields=${FIELDS}`);
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, complaint: toComplaint(await res.json(), await siteBaseUrl({ asApp })) };
  } catch (error) {
    console.log(`fetchComplaint ${k} failed: ${error?.message}`);
    return { ok: false, status: 500 };
  }
}

/** Comments from the Jira REST API (fallback when Teamwork Graph returns nothing), oldest first. */
export async function fetchComments(key, { asApp = false } = {}) {
  try {
    const res = await client(asApp).requestJira(route`/rest/api/3/issue/${key}/comment?orderBy=created&maxResults=100`);
    if (!res.ok) return [];
    const body = await res.json();
    return (body.comments ?? []).map((c) => ({
      id: String(c.id), createdAt: c.created ?? null, text: adfToText(c.body), author: c.author?.displayName ?? null, url: null,
    }));
  } catch (error) {
    console.log(`fetchComments ${key} failed: ${error?.message}`);
    return [];
  }
}

/** Complaints in a project created in the last `days` days, newest first (up to `limit`). */
export async function searchComplaints(projectKey, { days = 90, limit = 200, asApp = false } = {}) {
  const project = String(projectKey ?? '').trim().toUpperCase();
  if (!PROJECT_KEY.test(project)) return [];
  const jql = `project = "${project}" AND created >= -${Math.max(1, Math.floor(days))}d ORDER BY created DESC`;
  const base = await siteBaseUrl({ asApp });
  const out = [];
  let token = null;
  try {
    do {
      const tokenPart = token ? `&nextPageToken=${encodeURIComponent(token)}` : '';
      const res = await client(asApp).requestJira(route`/rest/api/3/search/jql?jql=${jql}&fields=${FIELDS}&maxResults=100${tokenPart}`);
      if (!res.ok) {
        console.log(`searchComplaints ${project} status=${res.status}`);
        break;
      }
      const body = await res.json();
      out.push(...(body.issues ?? []).map((issue) => toComplaint(issue, base)));
      token = body.nextPageToken ?? null;
    } while (token && out.length < limit);
  } catch (error) {
    console.log(`searchComplaints ${project} failed: ${error?.message}`);
  }
  return out.slice(0, limit);
}

/** Adds a plain-text comment. Used by the triggers (as the app) when a report is due soon or overdue. */
export async function addComment(issueKey, text, { asApp = true } = {}) {
  try {
    const res = await client(asApp).requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: textToAdf(text) }),
    });
    if (!res.ok) console.log(`addComment ${issueKey} status=${res.status}`);
    return res.ok;
  } catch (error) {
    console.log(`addComment ${issueKey} failed: ${error?.message}`);
    return false;
  }
}
