/**
 * Process entrypoint: startup ordering and graceful shutdown.
 *
 * Graceful shutdown is the difference between a rolling update that drops zero
 * requests and one that drops a handful every time. On SIGTERM we stop
 * accepting new connections, let in-flight requests finish, then close the
 * database and cache. Kubernetes gives us terminationGracePeriodSeconds to do
 * it; the chart sets that to comfortably exceed SHUTDOWN_GRACE_MS.
 */
import config from './config.js';
import logger from './logger.js';
import { createApp } from './app.js';
import { runMigrations } from './migrate.js';
import { samplePoolMetrics, closeDatabase, checkDatabase } from './db.js';
import { initCache, closeCache } from './cache.js';
import { refreshOpenLotsGauge } from './routes/lots.js';
import { seedDemoData } from './seed.js';

let server;
let poolSampler;
let shuttingDown = false;

async function waitForDatabase(attempts = 30, delayMs = 2000) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await checkDatabase();
      logger.info('database reachable', { attempt });
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      logger.warn('database not ready, retrying', {
        attempt, of: attempts, err: err.message,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function start() {
  logger.info('starting agribridge-api', {
    version: config.version,
    git_sha: config.gitSha,
    image_tag: config.imageTag,
    env: config.env,
    node: process.version,
  });

  // The StatefulSet may still be running crash recovery when the API starts.
  // Retrying here, plus a generous startupProbe, is what keeps a cold cluster
  // from crash-looping its way through the whole demo.
  await waitForDatabase();

  if (config.runMigrationsOnStart) await runMigrations();
  if (config.seedOnStart) await seedDemoData();

  await initCache();
  await refreshOpenLotsGauge().catch((err) => logger.warn('gauge init failed', { err: err.message }));

  // Pool gauges are sampled rather than event-driven; 5s is plenty at a 15s
  // scrape interval.
  poolSampler = setInterval(samplePoolMetrics, 5000);
  poolSampler.unref();

  const app = createApp();
  server = app.listen(config.port, '0.0.0.0', () => {
    logger.info('listening', { port: config.port });
  });

  // Slightly above typical ingress idle timeouts, to avoid races where the
  // proxy reuses a connection the server is closing.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown requested', { signal });

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, config.shutdownGraceMs);
  forceExit.unref();

  try {
    if (poolSampler) clearInterval(poolSampler);

    if (server) {
      await new Promise((resolve) => server.close(resolve));
      logger.info('http server closed');
    }

    await closeCache();
    await closeDatabase();
    logger.info('shutdown complete');
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    logger.error('error during shutdown', { err });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Never keep serving after an unhandled rejection: an unknown-state process is
// worse than a restarted one, and the liveness probe exists for exactly this.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled promise rejection', { err: reason });
  shutdown('unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logger.error('uncaught exception', { err });
  shutdown('uncaughtException');
});

start().catch((err) => {
  logger.error('startup failed', { err });
  process.exit(1);
});
