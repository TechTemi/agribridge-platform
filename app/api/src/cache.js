/**
 * Redis cache for the price index and dashboard aggregates.
 *
 * Deliberately optional. If Redis is gone the API keeps serving from Postgres
 * and reports itself degraded rather than unready, unless REDIS_REQUIRED is
 * set. That distinction matters: a cache outage should cost you latency, not
 * availability, and conflating the two is how a dependency becomes an outage.
 */
import { createClient } from 'redis';
import config from './config.js';
import logger from './logger.js';
import { cacheOperations } from './metrics.js';

let client = null;
let connected = false;

export function isConnected() {
  return config.cache.enabled && connected;
}

export async function initCache() {
  if (!config.cache.enabled) {
    logger.info('cache disabled by configuration');
    return null;
  }

  client = createClient({
    url: config.cache.url,
    socket: {
      connectTimeout: 3000,
      // Give up reconnecting forever, but back off so we do not hammer a
      // recovering Redis. Returning a number means "retry after N ms".
      reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
    },
  });

  client.on('error', (err) => {
    if (connected) logger.warn('redis connection error', { err: err.message });
    connected = false;
  });
  client.on('ready', () => {
    connected = true;
    logger.info('cache connected', { url: redactUrl(config.cache.url) });
  });
  client.on('end', () => { connected = false; });

  try {
    await client.connect();
  } catch (err) {
    logger.warn('cache unavailable at startup; continuing without it', { err: err.message });
  }
  return client;
}

function redactUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return 'invalid-url';
  }
}

/** Read a JSON value. Returns null on miss, error, or when disabled. */
export async function cacheGet(key) {
  if (!isConnected()) {
    cacheOperations.inc({ operation: 'get', result: 'miss' });
    return null;
  }
  try {
    const raw = await client.get(key);
    cacheOperations.inc({ operation: 'get', result: raw === null ? 'miss' : 'hit' });
    return raw === null ? null : JSON.parse(raw);
  } catch (err) {
    cacheOperations.inc({ operation: 'get', result: 'error' });
    logger.warn('cache get failed', { key, err: err.message });
    return null;
  }
}

/** Write a JSON value with the configured TTL. Never throws. */
export async function cacheSet(key, value, ttlSeconds = config.cache.ttlSeconds) {
  if (!isConnected()) return false;
  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
    cacheOperations.inc({ operation: 'set', result: 'hit' });
    return true;
  } catch (err) {
    cacheOperations.inc({ operation: 'set', result: 'error' });
    logger.warn('cache set failed', { key, err: err.message });
    return false;
  }
}

/** Invalidate keys by prefix. Uses SCAN, never KEYS, so it is safe in prod. */
export async function cacheInvalidate(prefix) {
  if (!isConnected()) return 0;
  let removed = 0;
  try {
    for await (const key of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
      await client.del(key);
      removed += 1;
    }
    cacheOperations.inc({ operation: 'invalidate', result: 'hit' });
  } catch (err) {
    cacheOperations.inc({ operation: 'invalidate', result: 'error' });
    logger.warn('cache invalidate failed', { prefix, err: err.message });
  }
  return removed;
}

export async function checkCache() {
  if (!config.cache.enabled) return { ok: true, skipped: true };
  if (!connected) return { ok: false, reason: 'not connected' };
  const started = Date.now();
  await client.ping();
  return { ok: true, latencyMs: Date.now() - started };
}

export async function closeCache() {
  if (client && connected) {
    try { await client.quit(); } catch { /* already gone */ }
  }
  connected = false;
}
