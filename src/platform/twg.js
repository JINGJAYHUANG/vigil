// Teamwork Graph API (Forge Preview): curated queries, always as the current user, so every row is permission-filtered.
// Scopes in the manifest: read:graph:issue:jira, read:graph:issue-comment:jira, read:graph:page:confluence,
// read:graph:user:atlassian. A missing or declined scope does not raise an error; it returns fewer rows, so callers
// fall back to the Jira and Confluence REST APIs when a result is empty and say which source they used.

import api, { getAppContext } from '@forge/api';

/** The site's cloud ID from the invocation context, or from the installation. */
export function cloudIdFrom(context) {
  if (context?.cloudId) return context.cloudId;
  try {
    const contexts = getAppContext()?.installation?.contexts ?? [];
    const found = contexts.find((c) => c?.cloudId);
    if (found) return found.cloudId;
  } catch (error) {
    console.log(`getAppContext failed: ${error?.message}`);
  }
  return null;
}

export const workItemAri = (cloudId, issueId) => `ari:cloud:jira:${cloudId}:issue/${issueId}`;
export const pageAri = (cloudId, pageId) => `ari:cloud:confluence:${cloudId}:page/${pageId}`;
const pageIdFromAri = (ari) => /:page\/(\d+)$/.exec(String(ari ?? ''))?.[1] ?? null;

async function run(query, variables, cloudId) {
  const attempt = async (headers) => {
    const res = await api.asUser().requestTeamworkGraph(query, variables, undefined, undefined, headers);
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };
  try {
    let { status, body } = await attempt({});
    const needsContext = (body.errors ?? []).some((e) => /X-Query-Context|Query context/i.test(e?.message ?? ''));
    if (needsContext && cloudId) ({ status, body } = await attempt({ 'X-Query-Context': `ari:cloud:platform::site/${cloudId}` }));
    const errors = (body.errors ?? []).map((e) => e?.message).filter(Boolean);
    if (errors.length) console.log(`TWG errors: ${errors.join(' | ').slice(0, 400)}`);
    return { ok: status === 200 && Boolean(body.data), data: body.data ?? {}, errors };
  } catch (error) {
    console.log(`TWG request failed: ${error?.message}`);
    return { ok: false, data: {}, errors: [String(error?.message ?? error)] };
  }
}

const COMMENTS = `query vigil_complaintComments($id: ID!, $after: String) {
  jiraWorkItemComments(id: $id, since: "P365D", first: 25, after: $after) {
    edges { node { __typename ... on JiraWorkItemComment { id content createdAt webUrl deleted author { __typename ... on AtlassianUser { name } } } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** Comments on a work item from the last year, oldest first: [{ id, createdAt, text, author, url }]. */
export async function workItemComments(cloudId, issueId, { maxPages = 4 } = {}) {
  if (!cloudId || !issueId) return { ok: false, comments: [] };
  const comments = [];
  let after = null;
  let ok = false;
  for (let page = 0; page < maxPages; page += 1) {
    const res = await run(COMMENTS, { id: workItemAri(cloudId, issueId), after }, cloudId);
    if (!res.ok) break;
    ok = true;
    const conn = res.data.jiraWorkItemComments;
    for (const edge of conn?.edges ?? []) {
      const n = edge?.node;
      if (!n || n.__typename !== 'JiraWorkItemComment' || n.deleted) continue;
      comments.push({ id: n.id, createdAt: n.createdAt ?? null, text: n.content ?? '', author: n.author?.name ?? null, url: n.webUrl ?? null });
    }
    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  comments.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return { ok, comments };
}

const RISK_FILE = `query vigil_riskFile($id: ID!) {
  confluencePageLinkedConfluencePages(id: $id, first: 25) { edges { node { __typename ... on ConfluencePage { id title webUrl } } } }
  confluencePageOwners(id: $id, first: 5) { edges { node { __typename ... on AtlassianUser { name } } } }
}`;

const OWNERS = `query vigil_pageOwners($id: ID!) {
  confluencePageOwners(id: $id, first: 5) { edges { node { __typename ... on AtlassianUser { name } } } }
}`;

const ownersOf = (conn) => (conn?.edges ?? []).map((e) => e?.node).filter((n) => n?.__typename === 'AtlassianUser' && n.name).map((n) => n.name);

/** Pages linked from the product's risk management file, and the file's owners. */
export async function riskFileGraph(cloudId, pageId) {
  if (!cloudId || !pageId) return { ok: false, linked: [], owners: [] };
  const res = await run(RISK_FILE, { id: pageAri(cloudId, pageId) }, cloudId);
  const linked = (res.data.confluencePageLinkedConfluencePages?.edges ?? [])
    .map((e) => e?.node)
    .filter((n) => n?.__typename === 'ConfluencePage')
    .map((n) => ({ pageId: pageIdFromAri(n.id), title: n.title ?? '', url: n.webUrl ?? null }))
    .filter((p) => p.pageId);
  return { ok: res.ok, linked, owners: ownersOf(res.data.confluencePageOwners) };
}

/** Owners of one Confluence page. */
export async function pageOwners(cloudId, pageId) {
  if (!cloudId || !pageId) return [];
  const res = await run(OWNERS, { id: pageAri(cloudId, pageId) }, cloudId);
  return ownersOf(res.data.confluencePageOwners);
}
