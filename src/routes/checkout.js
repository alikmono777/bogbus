import express from 'express';
import config from '../config.js';
import logger from '../lib/logger.js';
import { unauthorized, notFound, HttpError } from '../lib/errors.js';
import store from '../store/index.js';
import { createCheckout } from '../services/payments.js';

const router = express.Router();

/** Optional shared-secret guard for the order-creation endpoint. */
function requireApiKey(req, res, next) {
  if (!config.app.checkoutApiKey) return next();
  if (req.get('X-Api-Key') === config.app.checkoutApiKey) return next();
  return next(unauthorized('Invalid or missing X-Api-Key'));
}

/**
 * POST /checkout
 * Body (Shopify mode):
 *   { "draftOrderId": "123" }                       // pay an existing draft
 *   { "lineItems": [{ "variantId": "gid://shopify/ProductVariant/1", "quantity": 2 }],
 *     "email": "a@b.com" }                           // create a draft, then pay
 *   { "lineItems": [{ "title": "Custom", "quantity": 1, "originalUnitPrice": "9.90" }] }
 * Body (BOG-only mode, no Shopify configured):
 *   { "amount": 1.50, "currency": "GEL" }
 *
 * Query:
 *   ?redirect=1  → 302 straight to the BOG hosted page (for storefront buttons)
 *
 * Response (JSON): { paymentId, redirectUrl, draftOrderId }
 */
router.post('/checkout', requireApiKey, async (req, res, next) => {
  try {
    const result = await createCheckout(req.body || {});
    if (req.query.redirect === '1' || req.query.redirect === 'true') {
      return res.redirect(302, result.redirectUrl);
    }
    return res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/** GET /pay/:paymentId → 302 to the stored BOG redirect URL (re-pay / email links). */
router.get('/pay/:paymentId', async (req, res, next) => {
  try {
    const record = await store.getPayment(req.params.paymentId);
    if (!record) throw notFound('Payment not found');
    if (record.status === 'paid') {
      return res.redirect(302, `${config.app.url}/return/success?pid=${record.id}`);
    }
    if (!record.redirectUrl) throw new HttpError(409, 'No redirect URL for this payment');
    return res.redirect(302, record.redirectUrl);
  } catch (err) {
    next(err);
  }
});

/** GET /payments/:paymentId → status JSON (for polling / debugging). */
router.get('/payments/:paymentId', async (req, res, next) => {
  try {
    const record = await store.getPayment(req.params.paymentId);
    if (!record) throw notFound('Payment not found');
    res.json({
      paymentId: record.id,
      status: record.status,
      amount: record.amount,
      currency: record.currency,
      bogOrderId: record.bogOrderId,
      shopifyOrderId: record.shopifyOrderId,
      transactionId: record.transactionId,
      updatedAt: record.updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
