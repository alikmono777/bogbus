import crypto from 'node:crypto';
import config from '../config.js';
import logger from '../lib/logger.js';

/**
 * Verify a BOG callback signature.
 *
 * BOG signs the EXACT raw request body with their private key using
 * SHA256withRSA and sends the base64 result in the `Callback-Signature`
 * header. We must verify against the raw bytes received — before any JSON
 * re-serialisation — because field order matters.
 *
 * @param {Buffer|string} rawBody  Raw request body exactly as received.
 * @param {string} signatureBase64 Value of the Callback-Signature header.
 * @returns {boolean}
 */
export function verifyCallbackSignature(rawBody, signatureBase64) {
  if (config.bog.skipSignatureVerify) {
    logger.warn('Skipping BOG callback signature verification (BOG_SKIP_SIGNATURE_VERIFY=true)');
    return true;
  }
  if (!signatureBase64) {
    logger.warn('Missing Callback-Signature header');
    return false;
  }
  if (!config.bog.publicKey) {
    logger.error('No BOG public key configured; cannot verify callback signature');
    return false;
  }
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(rawBody);
    verifier.end();
    return verifier.verify(config.bog.publicKey, signatureBase64, 'base64');
  } catch (err) {
    logger.error('Signature verification threw', { error: String(err) });
    return false;
  }
}

export default verifyCallbackSignature;
