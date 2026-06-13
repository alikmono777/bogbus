import config from '../config.js';
import logger from '../lib/logger.js';
import { badRequest } from '../lib/errors.js';
import { parseAmount, amountsMatch } from '../lib/money.js';
import store from '../store/index.js';
import bog from '../bog/client.js';
import shopify from '../shopify/client.js';

/**
 * Payment orchestration. Two responsibilities:
 *   createCheckout(...)  — turn a Shopify draft order (or a raw amount in
 *                          BOG-only mode) into a BOG hosted-payment redirect.
 *   handleCallback(...)  — process BOG's server-to-server callback: validate,
 *                          then mark the Shopify order Paid (idempotently).
 */

// BOG order_status keys that mean "money received".
const SUCCESS_KEYS = new Set(['completed', 'partial_completed']);
// Keys that mean the attempt is dead and won't succeed.
const FAILURE_KEYS = new Set(['rejected', 'failed', 'expired', 'blocked', 'canceled', 'cancelled']);

function urls(paymentId) {
  return {
    callbackUrl: `${config.app.url}/callbacks/bog`,
    successUrl: `${config.app.url}/return/success?pid=${paymentId}`,
    failUrl: `${config.app.url}/return/fail?pid=${paymentId}`,
  };
}

/**
 * @param {object} opts
 * @param {string} [opts.draftOrderId] Existing Shopify draft order (numeric id or gid).
 * @param {Array}  [opts.lineItems]    Items to build a new draft order from.
 * @param {string} [opts.email]
 * @param {object} [opts.shippingAddress]
 * @param {string} [opts.note]
 * @param {number|string} [opts.amount]   BOG-only mode: charge this amount directly.
 * @param {string} [opts.currency]
 * @returns {Promise<{paymentId:string, redirectUrl:string, draftOrderId:string|null}>}
 */
export async function createCheckout(opts = {}) {
  const paymentId = store.newId();
  const { callbackUrl, successUrl, failUrl } = urls(paymentId);

  let draftOrder = null;
  let amount;
  let currency = (opts.currency || config.app.defaultCurrency).toUpperCase();
  let basket;

  if (config.shopify.enabled && (opts.draftOrderId || opts.lineItems)) {
    // ── Shopify draft-order flow ───────────────────────────────────────────
    if (opts.draftOrderId) {
      draftOrder = await shopify.getDraftOrder(shopify.toDraftOrderGid(opts.draftOrderId));
    } else {
      if (!Array.isArray(opts.lineItems) || opts.lineItems.length === 0) {
        throw badRequest('lineItems is required to create a draft order.');
      }
      draftOrder = await shopify.createDraftOrder({
        lineItems: opts.lineItems,
        email: opts.email,
        shippingAddress: opts.shippingAddress,
        note: opts.note || 'Created by BOG payment app',
        tags: ['bog-payment'],
      });
    }
    amount = parseAmount(draftOrder.totalPriceSet.shopMoney.amount);
    currency = draftOrder.totalPriceSet.shopMoney.currencyCode;
    basket = [
      {
        product_id: draftOrder.name || draftOrder.id,
        description: `Shopify draft ${draftOrder.name}`,
        quantity: 1,
        unit_price: amount,
      },
    ];
    if (amount <= 0) throw badRequest('Draft order total must be greater than zero.');
  } else {
    // ── BOG-only mode (no Shopify): charge a raw amount, for testing keys ───
    if (opts.amount === undefined) {
      throw badRequest(
        config.shopify.enabled
          ? 'Provide draftOrderId or lineItems.'
          : 'Shopify is not configured; provide an amount to create a BOG-only test order.',
      );
    }
    amount = parseAmount(opts.amount);
    if (amount <= 0) throw badRequest('amount must be greater than zero.');
    basket = opts.basket;
  }

  const externalOrderId = draftOrder ? `${draftOrder.id}:${paymentId}` : paymentId;

  const bogOrder = await bog.createOrder({
    externalOrderId,
    amount,
    currency,
    basket,
    callbackUrl,
    successUrl,
    failUrl,
    description: draftOrder ? `Shopify ${draftOrder.name}` : 'Test order',
    idempotencyKey: paymentId,
  });

  await store.createPayment({
    id: paymentId,
    status: 'pending',
    amount,
    currency,
    bogOrderId: bogOrder.id,
    redirectUrl: bogOrder.redirectUrl,
    detailsUrl: bogOrder.detailsUrl,
    externalOrderId,
    shopifyDraftOrderId: draftOrder ? draftOrder.id : null,
    shopifyOrderId: null,
    transactionId: null,
  });

  logger.info('Checkout created', {
    paymentId,
    bogOrderId: bogOrder.id,
    amount,
    currency,
    draftOrderId: draftOrder?.id || null,
  });

  return {
    paymentId,
    redirectUrl: bogOrder.redirectUrl,
    draftOrderId: draftOrder ? draftOrder.id : null,
  };
}

/**
 * Process a verified BOG callback body. Idempotent: safe to call multiple times
 * for the same order (BOG retries callbacks).
 *
 * @param {object} callback Parsed callback JSON ({ event, body: {...} }).
 * @returns {Promise<{handled:boolean, status:string, paymentId?:string}>}
 */
export async function handleCallback(callback) {
  const data = callback?.body || callback || {};
  const bogOrderId = data.order_id;
  const externalOrderId = data.external_order_id;
  const statusKey = bog.extractStatusKey(data) || 'unknown';

  let record =
    (bogOrderId && (await store.findByBogOrderId(bogOrderId))) ||
    (externalOrderId && (await store.findByExternalOrderId(externalOrderId)));

  if (!record) {
    logger.warn('Callback for unknown order', { bogOrderId, externalOrderId, statusKey });
    return { handled: false, status: statusKey };
  }

  // Idempotency: already finalised → acknowledge and stop.
  if (record.status === 'paid') {
    logger.info('Callback ignored; already paid', { paymentId: record.id });
    return { handled: true, status: 'paid', paymentId: record.id };
  }

  const transactionId =
    data.payment_detail?.transaction_id || data.transaction_id || record.transactionId || null;

  if (SUCCESS_KEYS.has(statusKey)) {
    // Defence in depth: re-fetch the authoritative receipt and confirm amount.
    let verifiedAmount = record.amount;
    try {
      const receipt = await bog.getReceipt(record.bogOrderId);
      const receiptStatus = bog.extractStatusKey(receipt);
      const paid =
        receipt?.purchase_units?.transfer_amount ??
        receipt?.purchase_units?.request_amount ??
        receipt?.payment_detail?.transfer_amount;
      if (paid !== undefined && paid !== null) verifiedAmount = paid;
      if (receiptStatus && !SUCCESS_KEYS.has(receiptStatus)) {
        logger.warn('Receipt status disagrees with callback', {
          paymentId: record.id,
          callbackStatus: statusKey,
          receiptStatus,
        });
      }
    } catch (err) {
      logger.warn('Could not fetch receipt for verification; trusting callback', {
        paymentId: record.id,
        error: String(err),
      });
    }

    if (!amountsMatch(verifiedAmount, record.amount)) {
      await store.updatePayment(
        record.id,
        { status: 'mismatch', transactionId },
        { type: 'amount_mismatch', expected: record.amount, got: verifiedAmount, statusKey },
      );
      logger.error('Amount mismatch — NOT completing order', {
        paymentId: record.id,
        expected: record.amount,
        got: verifiedAmount,
      });
      return { handled: true, status: 'mismatch', paymentId: record.id };
    }

    // Mark the Shopify draft order as a paid Order.
    let shopifyOrderId = record.shopifyOrderId;
    if (config.shopify.enabled && record.shopifyDraftOrderId && !shopifyOrderId) {
      try {
        const order = await shopify.completeDraftOrder(record.shopifyDraftOrderId, {
          paymentPending: false,
        });
        shopifyOrderId = order?.id || null;
        if (shopifyOrderId && transactionId) {
          await shopify
            .addTags(shopifyOrderId, [`bog:${transactionId}`])
            .catch((e) => logger.warn('addTags failed', { error: String(e) }));
        }
        logger.info('Draft order completed as paid', {
          paymentId: record.id,
          shopifyOrderId,
          orderName: order?.name,
        });
      } catch (err) {
        // Keep the payment record so we can retry/reconcile manually.
        await store.updatePayment(
          record.id,
          { status: 'error', transactionId },
          { type: 'shopify_complete_failed', error: String(err), statusKey },
        );
        logger.error('Failed to complete Shopify draft order', {
          paymentId: record.id,
          error: String(err),
        });
        return { handled: true, status: 'error', paymentId: record.id };
      }
    }

    record = await store.updatePayment(
      record.id,
      { status: 'paid', transactionId, shopifyOrderId },
      { type: 'paid', statusKey, transactionId, amount: verifiedAmount },
    );
    return { handled: true, status: 'paid', paymentId: record.id };
  }

  if (FAILURE_KEYS.has(statusKey)) {
    await store.updatePayment(
      record.id,
      { status: 'failed', transactionId },
      { type: 'failed', statusKey, transactionId },
    );
    logger.info('Payment failed', { paymentId: record.id, statusKey });
    return { handled: true, status: 'failed', paymentId: record.id };
  }

  // Intermediate / unknown status — record the event but don't finalise.
  await store.updatePayment(record.id, {}, { type: 'status', statusKey });
  logger.info('Intermediate callback recorded', { paymentId: record.id, statusKey });
  return { handled: true, status: statusKey, paymentId: record.id };
}

export default { createCheckout, handleCallback };
