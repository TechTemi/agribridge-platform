/**
 * Express app factory.
 *
 * Exported separately from server.js so the integration tests can mount the
 * app without binding a port or installing signal handlers.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import config from './config.js';
import { loadUser } from './auth.js';
import { requestId, observeRequests, notFound, errorHandler } from './middleware.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import lotsRouter from './routes/lots.js';
import ordersRouter from './routes/orders.js';
import statsRouter from './routes/stats.js';

export function createApp() {
  const app = express();

  // Behind Traefik, so the client IP arrives in X-Forwarded-For. Without this
  // every access log records the ingress pod's address instead of the user's.
  if (config.trustProxy) app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  // Order matters: correlation id first so every later log line carries it.
  app.use(requestId);
  app.use(observeRequests);
  app.use(loadUser);

  // Minimal security headers. The web tier adds its own in nginx.conf.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // Operational endpoints live at the root, not under /api, so the ingress can
  // route them separately and so probes never depend on API path rewriting.
  app.use('/', healthRouter);

  app.use('/api/auth', authRouter);
  app.use('/api/lots', lotsRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/stats', statsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
