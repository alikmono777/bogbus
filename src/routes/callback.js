import express from 'express';
import logger from '../lib/logger.js';
import verifyCallbackSignature from '../bog/signature.js';
import { handleCallback } from '../services/payments.js';

const router = express.Router();

/**
 * POST /callbacks/bog
 *
 * BOG's server-to-server payment notification. We parse the body as RAW bytes
 * so we can verify the RSA signature over the exact payload before trusting it.
 *
 * We always return 200 once the signature is valid and the event is recorded —
 * returning non-2xx makes BOG retry. Genuinely invalid signatures get 401.
 */
router.post(
  '/bog',
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req, res) => {
    const signature =
      req.get('Callback-Signature') || req.get('callback-signature') || '';
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

    if (!verifyCallbackSignature(rawBody, signature)) {
      logger.error('Rejected BOG callback: invalid signature');
      return res.status(401).json({ error: 'invalid signature' });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch (err) {
      logger.error('BOG callback body is not valid JSON', { error: String(err) });
      return res.status(400).json({ error: 'invalid json' });
    }

    try {
      const result = await handleCallback(parsed);
      // Acknowledge receipt; processing outcome is in our own store.
      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      // Unexpected processing error: 500 so BOG retries later.
      logger.error('Error handling BOG callback', { error: String(err) });
      return res.status(500).json({ error: 'processing error' });
    }
  },
);

export default router;
