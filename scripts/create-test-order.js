#!/usr/bin/env node
/**
 * Manual helper: create a single payment and print the BOG redirect URL.
 *
 *   node scripts/create-test-order.js --amount 1.00 --currency GEL
 *   node scripts/create-test-order.js --draft 123456789
 *
 * Requires a valid .env (BOG keys, and Shopify keys if using --draft).
 * This calls the LIVE BOG API and will create a real order.
 */
import { createCheckout } from '../src/services/payments.js';
import config from '../src/config.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const draft = arg('draft');
const amount = arg('amount', '1.00');
const currency = arg('currency', config.app.defaultCurrency);

try {
  const opts = draft ? { draftOrderId: draft } : { amount, currency };
  const result = await createCheckout(opts);
  console.log('\n✅ Payment created');
  console.log('   paymentId :', result.paymentId);
  if (result.draftOrderId) console.log('   draftOrder:', result.draftOrderId);
  console.log('   pay link  :', `${config.app.url}/pay/${result.paymentId}`);
  console.log('\n👉 Open the BOG hosted page:\n   ' + result.redirectUrl + '\n');
} catch (err) {
  console.error('\n❌ Failed:', err.message);
  if (err.details) console.error('   details:', JSON.stringify(err.details, null, 2));
  process.exit(1);
}
