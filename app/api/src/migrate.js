/**
 * A small, deterministic migration runner.
 *
 * Two properties matter here:
 *
 *  1. It takes a Postgres advisory lock before doing anything, so several API
 *     replicas starting simultaneously cannot race. One wins, the others wait
 *     and then find every migration already applied.
 *  2. Migrations are applied in filename order and recorded in a table, so
 *     re-running is a no-op. This is the direct answer to finding F-04: the
 *     schema state of a database is derived from files in Git, never from
 *     whatever someone typed into psql at 05:20.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import logger from './logger.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

// Any constant works, as long as every replica uses the same one.
const ADVISORY_LOCK_KEY = 8_154_237;

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function runMigrations() {
  const client = await pool.connect();
  const applied = [];

  try {
    logger.info('acquiring migration lock');
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    await ensureMigrationsTable(client);

    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const done = new Set(rows.map((r) => r.filename));

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();                                  // 001_, 002_, ... lexical == ordinal

    for (const filename of files) {
      if (done.has(filename)) continue;

      const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
      logger.info('applying migration', { filename });

      // Each migration is its own transaction: a failure leaves the previous
      // ones applied and recorded, and the process exits non-zero so the pod
      // fails its startup probe rather than serving a half-migrated schema.
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        applied.push(filename);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error('migration failed', { filename, err });
        throw err;
      }
    }

    logger.info('migrations up to date', {
      applied_now: applied.length,
      total: files.length,
    });
    return applied;
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    } catch (err) {
      logger.warn('failed to release migration lock', { err: err.message });
    }
    client.release();
  }
}

export default runMigrations;
