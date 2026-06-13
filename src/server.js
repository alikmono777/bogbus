import express from 'express';
import config, { validateConfig, configWarnings } from './config.js';
import logger from './lib/logger.js';
import { HttpError } from './lib/errors.js';

import callbackRouter from './routes/callback.js';
import checkoutRouter from './routes/checkout.js';
import returnRouter from './routes/return.js';
import indexRouter from './routes/index.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true); // behind a TLS-terminating proxy (Render, Fly, Nginx…)

  // Request logging.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - start,
      });
    });
    next();
  });

  // IMPORTANT: mount the BOG callback BEFORE the JSON body parser — it needs the
  // raw bytes to verify the RSA signature (the callback router parses raw itself).
  app.use('/callbacks', callbackRouter);

  // Body parsers for everything else.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Feature routers.
  app.use('/', checkoutRouter);
  app.use('/return', returnRouter);
  app.use('/', indexRouter);

  // 404.
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Central error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) {
      logger.error('Unhandled error', { error: String(err), stack: err.stack });
    } else {
      logger.warn('Request error', { status, message: err.message });
    }
    res.status(status).json({
      error: err.message || 'Internal Server Error',
      ...(err.details ? { details: err.details } : {}),
    });
  });

  return app;
}

export function start() {
  const problems = validateConfig();
  if (problems.length) {
    for (const p of problems) logger.error('Config error', { problem: p });
    logger.error('Refusing to start due to configuration errors. See messages above.');
    process.exit(1);
  }
  for (const w of configWarnings()) logger.warn(w);

  const app = createApp();
  const server = app.listen(config.app.port, () => {
    logger.info('bogbus listening', {
      port: config.app.port,
      appUrl: config.app.url,
      mode: config.shopify.enabled ? 'shopify+bog' : 'bog-only',
    });
  });

  const shutdown = (sig) => {
    logger.info('Shutting down', { signal: sig });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

// This module is the application entry point — nothing in the codebase imports
// it (tests import createApp / individual modules instead). So we start
// unconditionally, which is robust across all platforms (Windows/macOS/Linux).
// Set BOGBUS_NO_AUTOSTART=1 to import this file without booting a server.
if (!process.env.BOGBUS_NO_AUTOSTART) {
  start();
}
