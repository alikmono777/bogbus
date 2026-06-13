import express from 'express';
import store from '../store/index.js';

const router = express.Router();

const PAGE = (title, color, message, detail) => `<!doctype html>
<html lang="ka"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;
    display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;color:#1f2933}
  .card{background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.08);
    padding:40px;max-width:420px;text-align:center}
  .badge{width:64px;height:64px;border-radius:50%;background:${color};margin:0 auto 20px;
    display:flex;align-items:center;justify-content:center;color:#fff;font-size:34px}
  h1{font-size:20px;margin:0 0 8px} p{color:#52606d;margin:6px 0}
  code{background:#f0f2f5;padding:2px 6px;border-radius:6px;font-size:13px}
</style></head>
<body><div class="card"><div class="badge">${color === '#e12d39' ? '✕' : '✓'}</div>
<h1>${message}</h1>${detail}</div></body></html>`;

/** GET /return/success — buyer landed back after a (likely) successful payment. */
router.get('/success', async (req, res) => {
  const record = req.query.pid ? await store.getPayment(req.query.pid) : null;
  const detail = record
    ? `<p>გადახდის სტატუსი / Status: <code>${record.status}</code></p>
       ${record.shopifyOrderId ? `<p>Order created ✔</p>` : ''}`
    : '<p>Payment reference not found.</p>';
  res
    .status(200)
    .type('html')
    .send(PAGE('Payment success', '#0b8043', 'მადლობა! / Thank you', detail));
});

/** GET /return/fail — buyer cancelled or the payment failed. */
router.get('/fail', async (req, res) => {
  const record = req.query.pid ? await store.getPayment(req.query.pid) : null;
  const retry = record
    ? `<p><a href="/pay/${record.id}">სცადეთ თავიდან / Try again</a></p>`
    : '';
  res
    .status(200)
    .type('html')
    .send(
      PAGE(
        'Payment failed',
        '#e12d39',
        'გადახდა ვერ შესრულდა / Payment was not completed',
        retry,
      ),
    );
});

export default router;
