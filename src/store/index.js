import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import config from '../config.js';

/**
 * Minimal durable key/value store for payment records, backed by a single JSON
 * file with atomic writes. Good enough for a single instance; swap this module
 * for SQLite/Postgres if you need multi-instance or high volume. All public
 * methods are async and writes are serialised through a promise queue so
 * concurrent callbacks can't corrupt the file.
 *
 * Payment record shape:
 * {
 *   id,                 // our internal payment id (uuid)
 *   status,             // pending | paid | failed | mismatch | error
 *   amount, currency,
 *   bogOrderId,         // BOG order id (uuid)
 *   redirectUrl,        // BOG hosted payment page
 *   detailsUrl,         // BOG receipt URL
 *   shopifyDraftOrderId,// gid://shopify/DraftOrder/123  (or null in BOG-only mode)
 *   shopifyOrderId,     // gid://shopify/Order/456 once completed
 *   externalOrderId,    // value sent to BOG as external_order_id
 *   transactionId,      // BOG transaction id from callback
 *   createdAt, updatedAt,
 *   events: []          // append-only audit trail
 * }
 */

const FILE = path.join(config.app.dataDir, 'payments.json');
let cache = null;
let writeQueue = Promise.resolve();

function ensureLoaded() {
  if (cache) return;
  fs.mkdirSync(config.app.dataDir, { recursive: true });
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    cache = {};
  }
}

async function flush() {
  // Serialise writes; each waits for the previous to finish.
  writeQueue = writeQueue.then(async () => {
    const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(cache, null, 2));
    await fsp.rename(tmp, FILE); // atomic on POSIX
  });
  return writeQueue;
}

export function newId() {
  return crypto.randomUUID();
}

export async function createPayment(data) {
  ensureLoaded();
  const now = new Date().toISOString();
  const record = {
    id: data.id || newId(),
    status: 'pending',
    events: [],
    createdAt: now,
    updatedAt: now,
    ...data,
  };
  cache[record.id] = record;
  await flush();
  return record;
}

export async function getPayment(id) {
  ensureLoaded();
  return cache[id] || null;
}

export async function findByBogOrderId(bogOrderId) {
  ensureLoaded();
  return Object.values(cache).find((r) => r.bogOrderId === bogOrderId) || null;
}

export async function findByExternalOrderId(externalOrderId) {
  ensureLoaded();
  return Object.values(cache).find((r) => r.externalOrderId === externalOrderId) || null;
}

export async function updatePayment(id, patch, event) {
  ensureLoaded();
  const record = cache[id];
  if (!record) throw new Error(`Payment ${id} not found`);
  Object.assign(record, patch, { updatedAt: new Date().toISOString() });
  if (event) record.events.push({ at: new Date().toISOString(), ...event });
  await flush();
  return record;
}

export default {
  newId,
  createPayment,
  getPayment,
  findByBogOrderId,
  findByExternalOrderId,
  updatePayment,
};
