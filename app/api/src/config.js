/**
 * All configuration arrives from the environment. Nothing is hardcoded and
 * nothing is read from a file that could be baked into an image.
 *
 * Secrets (DB password, JWT secret) come from Kubernetes Secrets that are
 * themselves populated from AWS Secrets Manager - see charts/agribridge and
 * docs/security-posture.md.
 */

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    // Fail fast and loudly. A pod that starts with missing configuration and
    // discovers it on the first request is far worse than one that never
    // becomes ready.
    throw new Error(`missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function int(name, fallback) {
  const raw = optional(name, undefined);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`${name} must be an integer, got: ${raw}`);
  return parsed;
}

function bool(name, fallback) {
  const raw = optional(name, undefined);
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

const isProduction = optional('NODE_ENV', 'development') === 'production';

export const config = {
  env: optional('NODE_ENV', 'development'),
  isProduction,
  port: int('PORT', 3000),
  logLevel: optional('LOG_LEVEL', isProduction ? 'info' : 'debug'),

  // Traceability: these are injected at image build time from the git SHA and
  // surfaced on /version and as the agribridge_build_info metric.
  version: optional('APP_VERSION', '0.0.0-dev'),
  gitSha: optional('GIT_SHA', 'unknown'),
  builtAt: optional('BUILD_DATE', 'unknown'),
  imageTag: optional('IMAGE_TAG', 'local'),

  db: {
    host: optional('PGHOST', 'localhost'),
    port: int('PGPORT', 5432),
    database: optional('PGDATABASE', 'agribridge'),
    user: optional('PGUSER', 'agribridge'),
    password: optional('PGPASSWORD', 'agribridge'),
    ssl: bool('PGSSL', false),
    poolMax: int('PG_POOL_MAX', 10),
    poolMin: int('PG_POOL_MIN', 0),
    connectionTimeoutMs: int('PG_CONNECT_TIMEOUT_MS', 5000),
    idleTimeoutMs: int('PG_IDLE_TIMEOUT_MS', 30000),
    statementTimeoutMs: int('PG_STATEMENT_TIMEOUT_MS', 10000),
  },

  cache: {
    // Redis is optional by design. If it is unreachable the API degrades to
    // reading straight from Postgres rather than failing - but readiness
    // reports the degradation so you can see it on a dashboard.
    enabled: bool('REDIS_ENABLED', true),
    url: optional('REDIS_URL', 'redis://localhost:6379'),
    ttlSeconds: int('CACHE_TTL_SECONDS', 30),
    required: bool('REDIS_REQUIRED', false),
  },

  auth: {
    // Never let this fall back to a default in production.
    jwtSecret: isProduction ? required('JWT_SECRET') : optional('JWT_SECRET', 'dev-only-insecure-secret'),
    tokenTtlSeconds: int('TOKEN_TTL_SECONDS', 8 * 60 * 60),
    cookieName: optional('COOKIE_NAME', 'agribridge_session'),
    cookieSecure: bool('COOKIE_SECURE', isProduction),
    bcryptRounds: int('BCRYPT_ROUNDS', isProduction ? 12 : 10),
  },

  shutdownGraceMs: int('SHUTDOWN_GRACE_MS', 10000),
  runMigrationsOnStart: bool('RUN_MIGRATIONS', true),
  seedOnStart: bool('SEED_DEMO_DATA', false),
  trustProxy: bool('TRUST_PROXY', true),
};

export default config;
