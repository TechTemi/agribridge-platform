/**
 * Cross-cutting request middleware: correlation ids, metrics, access logs and
 * the error handler.
 *
 * The route label used for metrics comes from Express's matched route pattern
 * (`/api/orders/:id`), never the raw URL. Labelling by raw path would create a
 * new time series per order id and destroy Prometheus - the same
 * high-cardinality mistake as labelling Loki streams by user id.
 */
import { randomUUID } from 'node:crypto';
import logger, { requestContext } from './logger.js';
import { httpRequestsTotal, httpRequestDuration, httpRequestsInFlight } from './metrics.js';

/** Accept an inbound correlation id from the ingress, or mint one. */
export function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  const id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  requestContext.run({ requestId: id }, () => next());
}

/** Resolve a low-cardinality route label for the current request. */
function routeLabel(req) {
  if (req.route?.path) {
    const base = req.baseUrl || '';
    return `${base}${req.route.path}`.replace(/\/$/, '') || '/';
  }
  // Unmatched requests all collapse into one series rather than one per URL.
  return req.path === '/' ? '/' : 'unmatched';
}

/** Count and time every request; track in-flight as the saturation signal. */
export function observeRequests(req, res, next) {
  const startedAt = process.hrtime.bigint();
  httpRequestsInFlight.inc();

  res.on('finish', () => {
    httpRequestsInFlight.dec();
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const labels = { method: req.method, route: routeLabel(req) };

    httpRequestDuration.observe(labels, seconds);
    httpRequestsTotal.inc({ ...labels, status: String(res.statusCode) });

    // Scrape endpoints and health checks would otherwise dominate the log
    // volume and tell you nothing.
    const noisy = req.path === '/metrics' || req.path === '/healthz' || req.path === '/readyz';
    if (!noisy) {
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level]('request', {
        method: req.method,
        path: req.path,
        route: labels.route,
        status: res.statusCode,
        duration_ms: Math.round(seconds * 1000),
        ip: req.ip,
      });
    }
  });

  next();
}

export function notFound(req, res) {
  res.status(404).json({ error: 'not found', path: req.path, requestId: req.requestId });
}

/**
 * Terminal error handler. Domain errors carry their own statusCode (see
 * PricingError and TransitionError); anything else is a 500 and gets logged
 * with a stack. The request id goes back to the client so a user can quote it
 * to support and you can find it in Loki immediately.
 */
export function errorHandler(err, req, res, _next) {
  const status = Number.isInteger(err.statusCode) ? err.statusCode : 500;

  if (status >= 500) {
    logger.error('unhandled request error', { err, path: req.path, method: req.method });
  } else {
    logger.warn('request rejected', { reason: err.message, path: req.path, status });
  }

  res.status(status).json({
    error: status >= 500 ? 'internal server error' : err.message,
    requestId: req.requestId,
  });
}

/** Wrap an async route handler so rejections reach the error handler. */
export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
