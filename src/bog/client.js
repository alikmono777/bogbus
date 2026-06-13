import config from '../config.js';
import logger from '../lib/logger.js';
import { formatAmount } from '../lib/money.js';
import { upstream } from '../lib/errors.js';

/**
 * Client for the Bank of Georgia Online Payment API (api.bog.ge/payments/v1).
 *
 * Flow:
 *   1. getAccessToken()  — OAuth2 client_credentials, cached until expiry.
 *   2. createOrder(...)  — POST /ecommerce/orders, returns hosted-page redirect.
 *   3. getReceipt(id)    — GET /receipt/{id}, authoritative payment status.
 */

let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt - 10_000) {
    return tokenCache.token;
  }
  const basic = Buffer.from(`${config.bog.clientId}:${config.bog.secret}`).toString('base64');
  const res = await fetch(config.bog.oauthUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });

  const text = await res.text();
  if (!res.ok) {
    logger.error('BOG token request failed', { status: res.status, body: text.slice(0, 500) });
    throw upstream('Failed to authenticate with BOG', { status: res.status });
  }
  const data = JSON.parse(text);
  tokenCache = {
    token: data.access_token,
    expiresAt: now + (Number(data.expires_in) || 3600) * 1000,
  };
  return tokenCache.token;
}

async function authedFetch(url, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Accept-Language': config.bog.language,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { res, body, text };
}

/**
 * Create a BOG e-commerce order.
 *
 * @param {object} p
 * @param {string} p.externalOrderId  Your reference (e.g. Shopify draft id).
 * @param {number|string} p.amount    Total amount in major units.
 * @param {string} p.currency         ISO 4217 (GEL/USD/EUR).
 * @param {Array}  p.basket           [{ product_id, description, quantity, unit_price }]
 * @param {string} p.callbackUrl      Server-to-server callback URL (HTTPS).
 * @param {string} p.successUrl       Buyer redirect on success.
 * @param {string} p.failUrl          Buyer redirect on failure.
 * @param {string} [p.idempotencyKey] Optional idempotency key.
 * @returns {Promise<{id:string, redirectUrl:string, detailsUrl:string, raw:object}>}
 */
export async function createOrder(p) {
  const totalAmount = formatAmount(p.amount);
  const payload = {
    callback_url: p.callbackUrl,
    external_order_id: p.externalOrderId,
    purchase_units: {
      currency: (p.currency || config.app.defaultCurrency).toUpperCase(),
      total_amount: Number(totalAmount),
      basket:
        Array.isArray(p.basket) && p.basket.length
          ? p.basket.map((item) => ({
              product_id: String(item.product_id ?? item.sku ?? 'item'),
              description: item.description ?? item.title ?? 'Order item',
              quantity: Number(item.quantity ?? 1),
              unit_price: Number(formatAmount(item.unit_price ?? item.price ?? totalAmount)),
            }))
          : [
              {
                product_id: p.externalOrderId,
                description: p.description || 'Shopify order',
                quantity: 1,
                unit_price: Number(totalAmount),
              },
            ],
    },
    redirect_urls: {
      success: p.successUrl,
      fail: p.failUrl,
    },
  };

  const headers = { 'Content-Type': 'application/json', Theme: 'light' };
  if (p.idempotencyKey) headers['Idempotency-Key'] = p.idempotencyKey;

  const { res, body, text } = await authedFetch(`${config.bog.apiBase}/ecommerce/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    logger.error('BOG createOrder failed', { status: res.status, body: text.slice(0, 800) });
    throw upstream('BOG rejected the order', { status: res.status, body });
  }

  const redirectUrl = body?._links?.redirect?.href;
  const detailsUrl = body?._links?.details?.href || body?._links?.self?.href || '';
  if (!body?.id || !redirectUrl) {
    logger.error('BOG createOrder unexpected response', { body });
    throw upstream('BOG returned an unexpected order response', { body });
  }

  return { id: body.id, redirectUrl, detailsUrl, raw: body };
}

/** Fetch the authoritative receipt/status for a BOG order. */
export async function getReceipt(orderId) {
  const { res, body, text } = await authedFetch(
    `${config.bog.apiBase}/receipt/${encodeURIComponent(orderId)}`,
    { method: 'GET' },
  );
  if (!res.ok) {
    logger.error('BOG getReceipt failed', { status: res.status, body: text.slice(0, 500) });
    throw upstream('Failed to fetch BOG receipt', { status: res.status });
  }
  return body;
}

/** Normalise the status string out of a callback body or a receipt body. */
export function extractStatusKey(body) {
  return (
    body?.order_status?.key ||
    body?.body?.order_status?.key ||
    body?.status ||
    null
  );
}

export default { createOrder, getReceipt, extractStatusKey };
