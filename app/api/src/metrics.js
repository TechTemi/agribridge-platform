/**
 * The Prometheus metric surface.
 *
 * These metric names are a contract: the Grafana dashboards in
 * observability/grafana/dashboards and the alert rules in
 * observability/prometheus/alert-rules.yaml both depend on them. Rename one
 * here and you break a dashboard - which is exactly why they live in one file.
 *
 * Note the business metrics at the bottom. agribridge_orders_created_total
 * going flat during business hours is a faster, less ambiguous outage signal
 * than any infrastructure metric, and it is what alert A-12 watches.
 */
import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import config from './config.js';

export const registry = new Registry();

registry.setDefaultLabels({ service: 'agribridge-api' });

// Node process, event loop, GC, heap. Free saturation signals.
collectDefaultMetrics({ register: registry, prefix: 'nodejs_' });

/* ------------------------------------------------------------ golden signals */

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests handled, by method, route template and status code',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds, by method and route template',
  labelNames: ['method', 'route'],
  // Buckets chosen around the SLO: p95 < 400ms on reads, < 800ms on writes.
  // A histogram whose buckets straddle your objective is far more useful than
  // the library defaults.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.4, 0.8, 1.5, 3, 10],
  registers: [registry],
});

export const httpRequestsInFlight = new Gauge({
  name: 'http_requests_in_flight',
  help: 'HTTP requests currently being processed - the saturation signal',
  registers: [registry],
});

/* -------------------------------------------------------------- dependencies */

export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query latency in seconds, by logical operation name',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 5],
  registers: [registry],
});

export const dbQueryErrors = new Counter({
  name: 'db_query_errors_total',
  help: 'Database queries that raised an error, by logical operation name',
  labelNames: ['operation'],
  registers: [registry],
});

export const dbPoolConnections = new Gauge({
  name: 'db_pool_connections',
  help: 'Connection pool size by state: active, idle or waiting',
  labelNames: ['state'],
  registers: [registry],
});

export const cacheOperations = new Counter({
  name: 'cache_operations_total',
  help: 'Cache operations by operation and result (hit, miss, error)',
  labelNames: ['operation', 'result'],
  registers: [registry],
});

/* ------------------------------------------------------------------ business */

export const ordersCreatedTotal = new Counter({
  name: 'agribridge_orders_created_total',
  help: 'Purchase orders created, by crop and originating state',
  labelNames: ['crop', 'state'],
  registers: [registry],
});

export const orderValueNaira = new Counter({
  name: 'agribridge_order_value_naira_sum',
  help: 'Cumulative value of created orders in naira',
  registers: [registry],
});

export const lotsOpen = new Gauge({
  name: 'agribridge_lots_open',
  help: 'Produce lots currently open for purchase',
  registers: [registry],
});

export const orderStateTransitions = new Counter({
  name: 'agribridge_order_state_transitions_total',
  help: 'Order lifecycle transitions, by source and target status',
  labelNames: ['from', 'to'],
  registers: [registry],
});

export const failedLogins = new Counter({
  name: 'agribridge_failed_logins_total',
  help: 'Failed login attempts - a security signal that costs nothing to add',
  registers: [registry],
});

/* --------------------------------------------------------------- build info */

// Value is always 1; the information lives in the labels. This is the metric
// that lets a Grafana panel answer "which commit is serving traffic?".
export const buildInfo = new Gauge({
  name: 'agribridge_build_info',
  help: 'Build information for the running instance; value is always 1',
  labelNames: ['version', 'git_sha', 'image_tag', 'node_version'],
  registers: [registry],
});

buildInfo.set(
  {
    version: config.version,
    git_sha: config.gitSha,
    image_tag: config.imageTag,
    node_version: process.version,
  },
  1,
);

export default registry;
