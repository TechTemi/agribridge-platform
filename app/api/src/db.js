/**
 * PostgreSQL access.
 *
 * The database runs as a pod inside the cluster (a StatefulSet with a
 * persistent volume) - see docs/decisions/ADR-008. Every query goes through
 * `query()` so that latency, errors and pool saturation are measured without
 * anyone having to remember to instrument a call site.
 */
import pg from 'pg';
import config from './config.js';
import logger from './logger.js';
import { dbQueryDuration, dbQueryErrors, dbPoolConnections } from './metrics.js';

const { Pool } = pg;

/**
 * Parse BIGINT (oid 20) as a JavaScript number.
 *
 * By default node-postgres returns int8 as a STRING, because a 64-bit integer can
 * exceed what a double can represent exactly. That default is correct in general
 * and wrong for us in a way that bites hard: `total_naira` came back as "6000000",
 * which JSON-serialised fine and then threw inside prom-client's Counter.inc()
 * *after* the transaction had already committed. The order existed and the API
 * returned 500 - the worst possible combination, because the client retries and
 * orders twice.
 *
 * The precision caveat, stated rather than ignored: Number.MAX_SAFE_INTEGER is
 * about 9.0e15. Naira amounts here are at most billions, so there are three
 * orders of magnitude of headroom. If this application ever needed to hold
 * values above 2^53 it would have to use a string or numeric type deliberately.
 */
pg.types.setTypeParser(20, (value) => (value === null ? null : Number(value)));

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
  max: config.db.poolMax,
  min: config.db.poolMin,
  connectionTimeoutMillis: config.db.connectionTimeoutMs,
  idleTimeoutMillis: config.db.idleTimeoutMs,
  // Stops one pathological query from occupying a connection indefinitely.
  statement_timeout: config.db.statementTimeoutMs,
  application_name: `agribridge-api@${config.gitSha}`,
});

pool.on('error', (err) => {
  // Errors on idle clients are emitted here rather than at a call site.
  logger.error('postgres idle client error', { err });
});

/** Refresh the pool gauges. Called on a timer from server.js. */
export function samplePoolMetrics() {
  dbPoolConnections.set({ state: 'active' }, pool.totalCount - pool.idleCount);
  dbPoolConnections.set({ state: 'idle' }, pool.idleCount);
  dbPoolConnections.set({ state: 'waiting' }, pool.waitingCount);
}

/**
 * Run a query, timed and labelled by a logical operation name.
 * The operation label is deliberately low-cardinality - never interpolate an
 * id into it, or you will do to Prometheus what a user_id label does to Loki.
 */
export async function query(operation, text, params = []) {
  const end = dbQueryDuration.startTimer({ operation });
  try {
    const result = await pool.query(text, params);
    end();
    return result;
  } catch (err) {
    end();
    dbQueryErrors.inc({ operation });
    logger.error('database query failed', { operation, err });
    throw err;
  }
}

/** Convenience: first row or null. */
export async function queryOne(operation, text, params = []) {
  const { rows } = await query(operation, text, params);
  return rows[0] ?? null;
}

/**
 * Run a function inside a transaction, rolling back on any throw.
 * Used by order creation, where the lot reservation and the order insert must
 * either both happen or neither.
 */
export async function withTransaction(operation, fn) {
  const client = await pool.connect();
  const end = dbQueryDuration.startTimer({ operation });
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    end();
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('rollback failed', { operation, err: rollbackErr });
    }
    end();
    dbQueryErrors.inc({ operation });
    throw err;
  } finally {
    client.release();
  }
}

/** Cheap liveness check for the readiness probe. */
export async function checkDatabase() {
  const started = Date.now();
  await pool.query('SELECT 1');
  return { ok: true, latencyMs: Date.now() - started };
}

export async function closeDatabase() {
  await pool.end();
}

export default { pool, query, queryOne, withTransaction, checkDatabase, closeDatabase };
