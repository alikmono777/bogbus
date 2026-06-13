import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Centralised, validated configuration. Importing this module reads the
 * environment once and exposes a frozen config object. It throws early with a
 * clear message when something required for the selected mode is missing.
 */

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function loadPublicKey() {
  const inline = process.env.BOG_PUBLIC_KEY;
  if (inline && inline.trim()) {
    // Allow PEM pasted with literal "\n" escapes in the .env file.
    return inline.includes('-----BEGIN')
      ? inline.replace(/\\n/g, '\n').trim()
      : inline.trim();
  }
  const keyPath = process.env.BOG_PUBLIC_KEY_PATH;
  if (keyPath) {
    const abs = path.resolve(process.cwd(), keyPath);
    if (fs.existsSync(abs)) return fs.readFileSync(abs, 'utf8').trim();
  }
  return '';
}

const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`)
  .replace(/\/+$/, '');

const config = {
  app: {
    url: appUrl,
    port: Number(process.env.PORT || 3000),
    defaultCurrency: (process.env.DEFAULT_CURRENCY || 'GEL').toUpperCase(),
    checkoutApiKey: process.env.CHECKOUT_API_KEY || '',
    dataDir: path.resolve(process.cwd(), 'data'),
  },
  bog: {
    clientId: process.env.BOG_CLIENT_ID || '',
    secret: process.env.BOG_SECRET || '',
    oauthUrl:
      process.env.BOG_OAUTH_URL ||
      'https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token',
    apiBase: (process.env.BOG_API_BASE || 'https://api.bog.ge/payments/v1').replace(/\/+$/, ''),
    language: (process.env.BOG_LANGUAGE || 'ka').toLowerCase(),
    publicKey: loadPublicKey(),
    skipSignatureVerify: bool(process.env.BOG_SKIP_SIGNATURE_VERIFY, false),
  },
  shopify: {
    shop: (process.env.SHOPIFY_SHOP || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    adminToken: process.env.SHOPIFY_ADMIN_TOKEN || '',
    apiVersion: process.env.SHOPIFY_API_VERSION || '2025-01',
  },
};

/**
 * True when Shopify Admin API credentials are present AND not explicitly
 * disabled. Set DISABLE_SHOPIFY=true to force BOG-only mode (test BOG payments
 * without touching Shopify) while keeping your Shopify vars in .env.
 */
config.shopify.disabled = bool(process.env.DISABLE_SHOPIFY, false);
config.shopify.enabled =
  !config.shopify.disabled && Boolean(config.shopify.shop && config.shopify.adminToken);

/**
 * Validate configuration for the current mode. Returns an array of human
 * readable problems (empty when OK). Called at startup; fatal problems stop
 * the process, soft warnings are logged.
 */
export function validateConfig() {
  const problems = [];
  if (!config.bog.clientId) problems.push('BOG_CLIENT_ID is required.');
  if (!config.bog.secret) problems.push('BOG_SECRET is required.');

  if (!config.bog.skipSignatureVerify && !config.bog.publicKey) {
    problems.push(
      'BOG callback signature verification is enabled but no public key was found. ' +
        'Set BOG_PUBLIC_KEY or BOG_PUBLIC_KEY_PATH (copy the PEM from ' +
        'https://api.bog.ge/docs/en/payments/standard-process/callback), ' +
        'or set BOG_SKIP_SIGNATURE_VERIFY=true for local testing only.',
    );
  }
  return problems;
}

export function configWarnings() {
  const warnings = [];
  if (config.bog.skipSignatureVerify) {
    warnings.push(
      'SECURITY: BOG_SKIP_SIGNATURE_VERIFY=true — callback signatures are NOT verified. Do not use in production.',
    );
  }
  if (!config.shopify.enabled) {
    const reason = config.shopify.disabled
      ? 'DISABLE_SHOPIFY=true'
      : 'Shopify credentials missing';
    warnings.push(
      `${reason} — running in BOG-only mode. /checkout accepts a raw amount and will NOT create or complete Shopify orders.`,
    );
  }
  if (config.app.url.startsWith('http://')) {
    warnings.push(
      'APP_URL is not HTTPS. BOG requires HTTPS callback/redirect URLs in production.',
    );
  }
  if (config.shopify.enabled) {
    if (!/^shpat_/.test(config.shopify.adminToken)) {
      warnings.push(
        'SHOPIFY_ADMIN_TOKEN does not start with "shpat_". You likely copied the API key or ' +
          'API secret key instead of the Admin API access token (Develop apps → your app → ' +
          'API credentials → Install app → Admin API access token).',
      );
    }
    if (!/\.myshopify\.com$/.test(config.shopify.shop)) {
      warnings.push(
        `SHOPIFY_SHOP is "${config.shopify.shop}". It should be the store's *.myshopify.com ` +
          'domain (e.g. your-store.myshopify.com), not a custom domain.',
      );
    }
  }
  return warnings;
}

export default config;
