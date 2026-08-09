/**
 * Structured JSON logging with request-id correlation.
 *
 * Every line is a single JSON object on stdout. Promtail ships it to Loki,
 * where `| json` gives you queryable fields. The request_id field is what
 * makes "show me every log line for this one order" a five-second query
 * instead of an archaeology project - see docs/runbooks/RB-01.
 *
 * Deliberately dependency-free: one small module you can read in full beats
 * a logging framework you have to configure.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import config from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

/** Carries the current request context without threading it through every call. */
export const requestContext = new AsyncLocalStorage();

/** Field names that must never reach a log line, at any nesting depth. */
const REDACT = new Set([
  'password', 'passwordhash', 'password_hash', 'token', 'authorization',
  'cookie', 'secret', 'jwt', 'jwtsecret', 'pgpassword', 'apikey', 'api_key',
]);

function scrub(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  // Errors must pass through untouched so the replacer below can unpack them.
  // Object.entries() on an Error returns nothing - message and stack are
  // non-enumerable - so scrubbing one would silently flatten it to {} and every
  // error line would arrive in Loki with no cause. Losing the cause of a failure
  // is exactly the blindness this platform exists to prevent.
  if (value instanceof Error) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = REDACT.has(key.toLowerCase()) ? '[redacted]' : scrub(val, depth + 1);
  }
  return out;
}

function emit(level, message, fields = {}) {
  if (LEVELS[level] < threshold) return;

  const ctx = requestContext.getStore();
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    service: 'agribridge-api',
    version: config.version,
    git_sha: config.gitSha,
    ...(ctx?.requestId ? { request_id: ctx.requestId } : {}),
    ...(ctx?.userId ? { user_id: ctx.userId } : {}),
    ...scrub(fields),
  };

  const serialised = JSON.stringify(line, (_key, value) =>
    value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack }
      : value);

  // stdout for everything: the container runtime is the log router, not us.
  process.stdout.write(`${serialised}\n`);
}

export const logger = {
  debug: (message, fields) => emit('debug', message, fields),
  info: (message, fields) => emit('info', message, fields),
  warn: (message, fields) => emit('warn', message, fields),
  error: (message, fields) => emit('error', message, fields),
};

export default logger;
