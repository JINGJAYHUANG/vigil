// Product settings in plain KVS (a short list): which Jira project holds the complaints, where the device is
// marketed, the risk management file page, the quality space for decision records, the problem codes with the
// expected counts from the post-market surveillance plan, and extra non-working days of the EU competent authority.

import { kvs } from '@forge/kvs';

const KEY = 'products';

export async function listProducts() {
  return (await kvs.get(KEY)) ?? [];
}

export async function saveProducts(products) {
  await kvs.set(KEY, products);
}

export async function productForProject(projectKey) {
  const p = String(projectKey ?? '').toUpperCase();
  return (await listProducts()).find((x) => x.projectKey === p) ?? null;
}

export async function productByKey(productKey) {
  const k = String(productKey ?? '').trim().toUpperCase();
  return (await listProducts()).find((x) => x.key === k) ?? null;
}
