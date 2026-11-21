// Forge Custom Entity "assessment" (declared in manifest.yml under app.storage.entities), one per complaint,
// keyed by the complaint's work item key. Indexes: productKey; lifecycle-due (partition lifecycle, range nextDue).
// Plain KVS keys "notified:<KEY>" remember which reminder comments the triggers already posted.

import { kvs, Sort, WhereConditions } from '@forge/kvs';
import { toEntity } from './entity.js';

const ENTITY = 'assessment';
export const NO_DUE = '9999-12-31';

async function collect(builder) {
  const out = [];
  let cursor;
  do {
    let query = builder.limit(100);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    for (const item of page.results ?? []) if (item?.value) out.push(item.value);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

export async function getAssessment(key) {
  return (await kvs.entity(ENTITY).get(String(key ?? '').trim().toUpperCase())) ?? null;
}

export async function putAssessment(record) {
  const value = { ...record, nextDue: record.nextDue || NO_DUE };
  await kvs.entity(ENTITY).set(record.complaintKey, toEntity(value));
}

export async function listByLifecycle(lifecycle) {
  return collect(kvs.entity(ENTITY).query().index('lifecycle-due', { partition: [lifecycle] }).sort(Sort.ASC));
}

export async function listByProduct(productKey) {
  return collect(kvs.entity(ENTITY).query().index('productKey').where(WhereConditions.equalTo(productKey)));
}

export async function getNotified(key) {
  return (await kvs.get(`notified:${key}`)) ?? {};
}

export async function setNotified(key, value) {
  await kvs.set(`notified:${key}`, value);
}
