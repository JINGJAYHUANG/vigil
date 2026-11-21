// Confluence reads and writes as the current user, so people only see and create what they are allowed to.

import api, { route } from '@forge/api';
import { adfToText } from './adf-text.js';

function parseAdf(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function pageUrl(page) {
  const base = page?._links?.base ?? '';
  const webui = page?._links?.webui ?? '';
  if (!webui) return null;
  return base ? `${base}${webui}` : `/wiki${webui}`;
}

/** A Confluence page ID from an ID or a page link. */
export function pageIdFrom(value) {
  const s = String(value ?? '').trim();
  if (/^\d+$/.test(s)) return s;
  const m = /\/pages\/(\d+)/.exec(s) ?? /[?&]pageId=(\d+)/.exec(s);
  return m ? m[1] : null;
}

/** Confluence page IDs linked from an ADF document (inline cards and text links), for the REST fallback. */
export function linkedPageIds(adf) {
  const ids = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const url = node.type === 'inlineCard' || node.type === 'blockCard' ? node.attrs?.url : null;
    if (url) { const id = pageIdFrom(url); if (id) ids.add(id); }
    for (const mark of node.marks ?? []) {
      if (mark.type === 'link') { const id = pageIdFrom(mark.attrs?.href); if (id) ids.add(id); }
    }
    (node.content ?? []).forEach(visit);
  };
  visit(adf);
  return [...ids];
}

/** Page metadata, plain text and linked page IDs for a current page the user can view. */
export async function fetchPage(pageId) {
  const id = pageIdFrom(pageId);
  if (!id) return { ok: false, status: 400 };
  try {
    const res = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${id}?body-format=atlas_doc_format`);
    if (!res.ok) return { ok: false, status: res.status };
    const page = await res.json();
    if ((page.status ?? 'current') !== 'current') return { ok: false, status: 404 };
    const adf = parseAdf(page.body?.atlas_doc_format?.value);
    return {
      ok: true,
      page: { id: String(page.id), title: page.title ?? '', url: pageUrl(page), spaceId: page.spaceId ? String(page.spaceId) : null },
      text: adfToText(adf),
      links: linkedPageIds(adf).filter((x) => x !== String(page.id)),
    };
  } catch (error) {
    console.log(`fetchPage ${id} failed: ${error?.message}`);
    return { ok: false, status: 500 };
  }
}

async function spaceIdForKey(spaceKey) {
  const res = await api.asUser().requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}`);
  if (!res.ok) return null;
  const body = await res.json();
  return body.results?.[0]?.id ? String(body.results[0].id) : null;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Builds Confluence storage format from simple blocks: { h2 }, { p }, { table: [[cells]] } (first row is the header). */
export function toStorage(blocks) {
  return blocks.map((b) => {
    if (b.h2) return `<h2>${esc(b.h2)}</h2>`;
    if (b.p) return `<p>${esc(b.p)}</p>`;
    if (b.table) {
      const [head, ...rows] = b.table;
      const th = `<tr>${head.map((c) => `<th><p>${esc(c)}</p></th>`).join('')}</tr>`;
      const tr = rows.map((r) => `<tr>${r.map((c) => `<td><p>${esc(c)}</p></td>`).join('')}</tr>`).join('');
      return `<table><tbody>${th}${tr}</tbody></table>`;
    }
    return '';
  }).join('');
}

/** Creates a page as the current user in the space with this key. */
export async function createPage({ spaceKey, title, blocks }) {
  const key = String(spaceKey ?? '').trim();
  if (!key) return { ok: false, error: 'No Confluence space is set for this product.' };
  const spaceId = await spaceIdForKey(key);
  if (!spaceId) return { ok: false, error: `Cannot find the Confluence space ${key}, or you cannot view it.` };
  const res = await api.asUser().requestConfluence(route`/wiki/api/v2/pages`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ spaceId, status: 'current', title: String(title).slice(0, 250), body: { representation: 'storage', value: toStorage(blocks) } }),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    console.log(`createPage status=${res.status} body=${text}`);
    return { ok: false, status: res.status, error: res.status === 400 && /title/i.test(text) ? 'A page with this title already exists in the space.' : 'Confluence did not create the page.' };
  }
  const page = await res.json();
  return { ok: true, pageId: String(page.id), url: pageUrl(page), title: page.title };
}
