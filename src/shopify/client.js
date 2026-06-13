import config from '../config.js';
import logger from '../lib/logger.js';
import { upstream } from '../lib/errors.js';

/**
 * Thin Shopify Admin GraphQL client for the draft-order payment flow.
 *
 * We use draft orders because they let an external gateway (BOG) collect the
 * money and then turn the draft into a real, *paid* order — without requiring
 * Shopify Payments-partner approval.
 *
 *   draftOrderCreate    → create a draft from line items / variants
 *   draftOrderComplete  → convert draft to an Order (paymentPending:false ⇒ Paid)
 *   draftOrder(query)   → read total / status to validate the amount
 *
 * Requires a custom app Admin API token with scopes: write_draft_orders,
 * read_orders (read_draft_orders is implied by write).
 */

function endpoint() {
  return `https://${config.shopify.shop}/admin/api/${config.shopify.apiVersion}/graphql.json`;
}

async function graphql(query, variables) {
  if (!config.shopify.enabled) {
    throw new Error('Shopify is not configured (SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN missing).');
  }
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': config.shopify.adminToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    logger.error('Shopify non-JSON response', { status: res.status, body: text.slice(0, 500) });
    throw upstream('Shopify returned a non-JSON response', { status: res.status });
  }
  if (!res.ok || json.errors) {
    logger.error('Shopify GraphQL error', { status: res.status, errors: json.errors });
    throw upstream('Shopify GraphQL request failed', { errors: json.errors });
  }
  return json.data;
}

function assertNoUserErrors(scope, userErrors) {
  if (userErrors && userErrors.length) {
    logger.error(`Shopify ${scope} userErrors`, { userErrors });
    throw upstream(`Shopify ${scope} failed`, { userErrors });
  }
}

const DRAFT_FIELDS = `
  id
  name
  invoiceUrl
  status
  currencyCode
  totalPriceSet { shopMoney { amount currencyCode } }
`;

/**
 * Create a draft order.
 * @param {object} input
 * @param {Array}  input.lineItems  Either [{ variantId, quantity }] (existing
 *                                  products) or [{ title, quantity, originalUnitPrice }]
 *                                  (custom items).
 * @param {string} [input.email]
 * @param {object} [input.shippingAddress]
 * @param {string} [input.note]
 * @param {string[]} [input.tags]
 */
export async function createDraftOrder(input) {
  const query = `
    mutation bogusDraftCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { ${DRAFT_FIELDS} }
        userErrors { field message }
      }
    }`;
  const data = await graphql(query, { input });
  assertNoUserErrors('draftOrderCreate', data.draftOrderCreate.userErrors);
  return data.draftOrderCreate.draftOrder;
}

/** Read a draft order's total and status (used to validate the paid amount). */
export async function getDraftOrder(id) {
  const query = `
    query bogusDraft($id: ID!) {
      draftOrder(id: $id) { ${DRAFT_FIELDS} }
    }`;
  const data = await graphql(query, { id });
  if (!data.draftOrder) throw upstream('Draft order not found', { id });
  return data.draftOrder;
}

/**
 * Complete a draft order. With paymentPending:false the resulting Order is
 * marked as PAID — call this only after BOG confirms a completed payment.
 * @returns the created Order { id, name, displayFinancialStatus }
 */
export async function completeDraftOrder(id, { paymentPending = false } = {}) {
  const query = `
    mutation bogusDraftComplete($id: ID!, $paymentPending: Boolean) {
      draftOrderComplete(id: $id, paymentPending: $paymentPending) {
        draftOrder {
          id
          order { id name displayFinancialStatus }
        }
        userErrors { field message }
      }
    }`;
  const data = await graphql(query, { id, paymentPending });
  assertNoUserErrors('draftOrderComplete', data.draftOrderComplete.userErrors);
  return data.draftOrderComplete.draftOrder.order;
}

/** Add tags to any resource (e.g. the created order) — used for traceability. */
export async function addTags(gid, tags) {
  const query = `
    mutation bogusTagsAdd($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
    }`;
  const data = await graphql(query, { id: gid, tags });
  assertNoUserErrors('tagsAdd', data.tagsAdd.userErrors);
}

/** Numeric id ("123") → gid ("gid://shopify/DraftOrder/123"). Pass-through if already a gid. */
export function toDraftOrderGid(id) {
  const s = String(id);
  return s.startsWith('gid://') ? s : `gid://shopify/DraftOrder/${s}`;
}

export default {
  createDraftOrder,
  getDraftOrder,
  completeDraftOrder,
  addTags,
  toDraftOrderGid,
};
