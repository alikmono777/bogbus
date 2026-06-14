import express from 'express';
import config from '../config.js';
import { createCheckout } from '../services/payments.js';
import shopify from '../shopify/client.js';

const router = express.Router();

/** GET / — service info / health summary. */
router.get('/', (req, res) => {
  res.json({
    service: 'bogbus — Shopify ↔ Bank of Georgia payments',
    mode: config.shopify.enabled ? 'shopify+bog' : 'bog-only',
    endpoints: {
      createCheckout: 'POST /checkout',
      payRedirect: 'GET /pay/:paymentId',
      paymentStatus: 'GET /payments/:paymentId',
      bogCallback: 'POST /callbacks/bog',
      buyerReturn: 'GET /return/success | /return/fail',
      demo: 'GET /demo',
      health: 'GET /healthz',
    },
  });
});

/** GET /healthz — liveness probe. */
router.get('/healthz', (req, res) => res.json({ status: 'ok' }));

/**
 * GET /debug/shopify — verify Shopify credentials and show which store the
 * token belongs to. Use this to diagnose 401 "Invalid API key or access token".
 */
router.get('/debug/shopify', async (req, res) => {
  if (!config.shopify.enabled) {
    return res.json({
      ok: false,
      reason: config.shopify.disabled
        ? 'Shopify is disabled (DISABLE_SHOPIFY=true).'
        : 'Shopify is not configured (SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN missing).',
    });
  }
  const tokenPrefix = config.shopify.adminToken.slice(0, 6);
  const hints = [];
  if (!/^shpat_/.test(config.shopify.adminToken)) {
    hints.push(
      `Your token starts with "${tokenPrefix}". A valid Admin API access token starts with "shpat_". ` +
        'shpss_ = API secret key (wrong), shpca_ = client id (wrong). Use the "Admin API access token" from API credentials.',
    );
  }
  if (!/^\d{4}-\d{2}$/.test(config.shopify.apiVersion)) {
    hints.push(
      `SHOPIFY_API_VERSION="${config.shopify.apiVersion}" is invalid. Use a date version like "2025-01".`,
    );
  }
  try {
    const shop = await shopify.getShop();
    const matches = shop.myshopifyDomain === config.shopify.shop;
    return res.json({
      ok: true,
      configuredShop: config.shopify.shop,
      tokenShop: shop.myshopifyDomain,
      shopMatchesToken: matches,
      shopName: shop.name,
      apiVersion: config.shopify.apiVersion,
      ...(matches ? {} : { warning: 'Token belongs to a DIFFERENT store than SHOPIFY_SHOP.' }),
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      configuredShop: config.shopify.shop,
      tokenPrefix,
      apiVersion: config.shopify.apiVersion,
      error: err.message,
      details: err.details,
      hints,
    });
  }
});

/** GET /demo — minimal test form to drive a checkout end-to-end. */
router.get('/demo', (req, res) => {
  const shopifyFields = config.shopify.enabled
    ? `<label>Custom item title<input name="title" value="Test product"></label>
       <label>Quantity<input name="quantity" type="number" value="1" min="1"></label>
       <label>Unit price (${config.app.defaultCurrency})<input name="price" value="1.00"></label>
       <label>Email (optional)<input name="email" type="email" placeholder="buyer@example.com"></label>
       <p class="hint">Creates a Shopify draft order, then redirects to BOG.</p>`
    : `<label>Amount (${config.app.defaultCurrency})<input name="amount" value="1.00"></label>
       <p class="hint">BOG-only mode (no Shopify configured): charges a raw amount.</p>`;

  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>BOG checkout demo</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f6f7f9;display:flex;min-height:100vh;
    align-items:center;justify-content:center;margin:0}
  form{background:#fff;padding:32px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.08);width:340px}
  h1{font-size:18px;margin:0 0 16px} label{display:block;font-size:13px;color:#52606d;margin:12px 0 4px}
  input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd2d9;border-radius:8px;font-size:14px}
  button{margin-top:20px;width:100%;padding:12px;background:#f7991c;color:#fff;border:0;border-radius:8px;
    font-size:15px;font-weight:600;cursor:pointer}
  .hint{font-size:12px;color:#9aa5b1;margin-top:8px}
</style></head><body>
<form method="POST" action="/demo/pay">
  <h1>Pay with Bank of Georgia</h1>
  ${shopifyFields}
  <button type="submit">Pay now →</button>
</form></body></html>`);
});

/** POST /demo/pay — handle the demo form and redirect the buyer to BOG. */
router.post('/demo/pay', async (req, res, next) => {
  try {
    const b = req.body || {};
    const opts = config.shopify.enabled
      ? {
          lineItems: [
            {
              title: b.title || 'Test product',
              quantity: Number(b.quantity || 1),
              originalUnitPrice: String(b.price || '1.00'),
            },
          ],
          email: b.email || undefined,
        }
      : { amount: b.amount || '1.00', currency: config.app.defaultCurrency };
    const { redirectUrl } = await createCheckout(opts);
    res.redirect(302, redirectUrl);
  } catch (err) {
    next(err);
  }
});

export default router;
