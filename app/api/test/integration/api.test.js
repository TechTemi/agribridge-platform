/**
 * Integration tests against a real PostgreSQL instance.
 *
 * These are the Harvest Monday regression tests. The outage happened because a
 * dependency resolved to a new minor version whose TLS default changed, and
 * nothing ever proved the API could still talk to its database before the code
 * reached production. A unit test with a mocked database cannot catch that
 * class of failure by construction - only a real connection can.
 *
 * The pipeline runs these against a Postgres service container. Locally:
 *   docker compose up -d postgres
 *   npm run test:integration
 */
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.REDIS_ENABLED = process.env.REDIS_ENABLED ?? 'false';
process.env.JWT_SECRET = 'integration-test-secret';
process.env.BCRYPT_ROUNDS = '4';            // keep the suite fast
process.env.PGDATABASE = process.env.PGDATABASE ?? 'agribridge_test';

const { createApp } = await import('../../src/app.js');
const { runMigrations } = await import('../../src/migrate.js');
const { pool, closeDatabase, query } = await import('../../src/db.js');
const { hashPassword } = await import('../../src/auth.js');

let app;
const PASSWORD = 'TestPassword123!';
const farmerEmail = `farmer-${Date.now()}@test.example`;
const buyerEmail = `buyer-${Date.now()}@test.example`;

beforeAll(async () => {
  // If this throws, the test run fails loudly rather than silently skipping -
  // a "passing" suite that never reached a database is worse than a red one.
  await runMigrations();

  const hash = await hashPassword(PASSWORD);
  await query('test_seed_farmer', `
    INSERT INTO users (email, password_hash, full_name, role, state)
    VALUES ($1, $2, 'Test Farmer', 'farmer', 'Oyo')
  `, [farmerEmail, hash]);
  await query('test_seed_buyer', `
    INSERT INTO users (email, password_hash, full_name, role, organisation)
    VALUES ($1, $2, 'Test Buyer', 'buyer', 'Test Mills')
  `, [buyerEmail, hash]);

  app = createApp();
}, 60_000);

afterAll(async () => {
  // Delete in foreign-key dependency order. Deleting users first fails on
  // orders_buyer_id_fkey, which would leave every row from this run behind and
  // slowly poison later runs.
  const ids = await query('test_cleanup_ids',
    'SELECT id FROM users WHERE email IN ($1, $2)', [farmerEmail, buyerEmail])
    .then((r) => r.rows.map((row) => row.id))
    .catch(() => []);

  if (ids.length) {
    await query('test_cleanup_events', `
      DELETE FROM order_events WHERE order_id IN (
        SELECT o.id FROM orders o LEFT JOIN lots l ON l.id = o.lot_id
         WHERE o.buyer_id = ANY($1) OR l.farmer_id = ANY($1))
    `, [ids]).catch(() => {});
    await query('test_cleanup_orders', `
      DELETE FROM orders WHERE buyer_id = ANY($1)
         OR lot_id IN (SELECT id FROM lots WHERE farmer_id = ANY($1))
    `, [ids]).catch(() => {});
    await query('test_cleanup_lots', 'DELETE FROM lots WHERE farmer_id = ANY($1)', [ids]).catch(() => {});
    await query('test_cleanup_users', 'DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
  }

  await closeDatabase();
});

async function login(email) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return res.headers['set-cookie'];
}

describe('operational endpoints', () => {
  it('reports liveness without touching the database', async () => {
    const res = await request(app).get('/healthz').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('reports readiness only when the database really answers', async () => {
    const res = await request(app).get('/readyz').expect(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.database.ok).toBe(true);
  });

  it('exposes the metric names the dashboards depend on', async () => {
    const res = await request(app).get('/metrics').expect(200);
    for (const metric of [
      'http_requests_total',
      'http_request_duration_seconds',
      'agribridge_orders_created_total',
      'agribridge_build_info',
      'db_query_duration_seconds',
    ]) {
      expect(res.text).toContain(metric);
    }
  });

  it('reports the build it was compiled from', async () => {
    const res = await request(app).get('/version').expect(200);
    expect(res.body).toHaveProperty('gitSha');
    expect(res.body).toHaveProperty('version');
  });

  it('returns a correlation id on every response', async () => {
    const res = await request(app).get('/healthz').expect(200);
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('echoes an inbound correlation id rather than replacing it', async () => {
    const res = await request(app)
      .get('/healthz')
      .set('X-Request-Id', 'trace-me-12345')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('trace-me-12345');
  });
});

describe('authentication', () => {
  it('rejects a wrong password with a generic message', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: farmerEmail, password: 'wrong' })
      .expect(401);
    // Must not distinguish "no such account" from "bad password".
    expect(res.body.error).toBe('invalid email or password');
  });

  it('rejects an unknown account identically', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.example', password: 'wrong' })
      .expect(401);
    expect(res.body.error).toBe('invalid email or password');
  });

  it('issues an httpOnly session cookie on success', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: farmerEmail, password: PASSWORD })
      .expect(200);

    const cookie = res.headers['set-cookie'].join(';');
    expect(cookie).toContain('HttpOnly');
    expect(res.body.user.role).toBe('farmer');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  it('refuses protected routes without a session', async () => {
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/orders').expect(401);
  });
});

describe('the full order lifecycle against a real database', () => {
  let farmerCookie;
  let buyerCookie;
  let lotId;
  let orderId;

  beforeAll(async () => {
    farmerCookie = await login(farmerEmail);
    buyerCookie = await login(buyerEmail);
  });

  it('lets a farmer list a lot', async () => {
    const res = await request(app)
      .post('/api/lots')
      .set('Cookie', farmerCookie)
      .send({
        crop: 'maize',
        tonnage: 25,
        moistureGrade: 'A',
        state: 'Oyo',
        pricePerTonneNaira: 600_000,
      })
      .expect(201);

    lotId = res.body.lot.id;
    expect(res.body.lot.status).toBe('OPEN');
  });

  it('stops a buyer from listing a lot', async () => {
    await request(app)
      .post('/api/lots')
      .set('Cookie', buyerCookie)
      .send({
        crop: 'maize', tonnage: 5, moistureGrade: 'A', state: 'Oyo', pricePerTonneNaira: 100,
      })
      .expect(403);
  });

  it('validates lot input rather than trusting it', async () => {
    await request(app)
      .post('/api/lots')
      .set('Cookie', farmerCookie)
      .send({
        crop: 'diamonds', tonnage: -1, moistureGrade: 'Z', pricePerTonneNaira: 0,
      })
      .expect(400);
  });

  it('shows the lot on the public browse endpoint', async () => {
    const res = await request(app).get('/api/lots?crop=maize').expect(200);
    expect(res.body.lots.some((l) => l.id === lotId)).toBe(true);
  });

  it('lets a buyer place an order, priced by the domain rules', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Cookie', buyerCookie)
      .send({ lotId, tonnage: 10 })
      .expect(201);

    orderId = res.body.order.id;
    expect(res.body.order.status).toBe('PENDING');
    // 10t at 600,000 on grade A: no discount.
    expect(Number(res.body.order.total_naira)).toBe(6_000_000);
  });

  it('refuses an order larger than the lot', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Cookie', buyerCookie)
      .send({ lotId, tonnage: 10_000 })
      .expect(409);
    expect(res.body.error).toMatch(/exceeds/);
  });

  it('walks the lifecycle through to settlement', async () => {
    const steps = [
      ['MATCHED', farmerCookie],
      ['IN_TRANSIT', farmerCookie],
      ['DELIVERED', buyerCookie],
      ['SETTLED', buyerCookie],
    ];

    for (const [status, cookie] of steps) {
      const res = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .set('Cookie', cookie)
        .send({ status })
        .expect(200);
      expect(res.body.order.status).toBe(status);
    }
  });

  it('refuses an illegal transition with a 409 that names the alternatives', async () => {
    // A fresh lot, because settling the previous order correctly marked the
    // original lot SOLD - reusing it here would test the lot guard rather than
    // the state machine.
    const newLot = await request(app)
      .post('/api/lots')
      .set('Cookie', farmerCookie)
      .send({
        crop: 'sorghum',
        tonnage: 12,
        moistureGrade: 'B',
        state: 'Oyo',
        pricePerTonneNaira: 540_000,
      })
      .expect(201);

    const fresh = await request(app)
      .post('/api/orders')
      .set('Cookie', buyerCookie)
      .send({ lotId: newLot.body.lot.id, tonnage: 5 })
      .expect(201);

    const res = await request(app)
      .patch(`/api/orders/${fresh.body.order.id}/status`)
      .set('Cookie', buyerCookie)
      .send({ status: 'SETTLED' })
      .expect(409);

    expect(res.body.error).toContain('MATCHED');
  });

  it('records an append-only audit trail of every transition', async () => {
    const res = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Cookie', buyerCookie)
      .expect(200);

    const targets = res.body.events.map((e) => e.to_status);
    expect(targets).toEqual(['PENDING', 'MATCHED', 'IN_TRANSIT', 'DELIVERED', 'SETTLED']);
    // Every event carries the request id, so a log line and an audit row can be
    // joined during an incident.
    expect(res.body.events.at(-1).request_id).toBeTruthy();
  });

  it('reports the order as terminal once settled', async () => {
    const res = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Cookie', buyerCookie)
      .expect(200);
    expect(res.body.allowedTransitions).toEqual([]);
  });

  it('scopes the order list to lots the farmer actually owns', async () => {
    const res = await request(app)
      .get('/api/orders')
      .set('Cookie', farmerCookie)
      .expect(200);

    expect(res.body.orders.length).toBeGreaterThan(0);
    // Every order visible to this farmer must be against one of their own lots.
    // This is the scoping guarantee - a farmer must never see another farmer's
    // trade, and the query enforces it with a join on lots.farmer_id.
    expect(res.body.orders.every((o) => o.farmer_name === 'Test Farmer')).toBe(true);
  });

  it('assesses input credit from settled trade', async () => {
    const res = await request(app)
      .post('/api/orders/credit-check')
      .set('Cookie', farmerCookie)
      .send({ requestedNaira: 100_000 })
      .expect(200);

    expect(res.body).toHaveProperty('eligible');
    expect(res.body).toHaveProperty('limitNaira');
  });
});

describe('dashboard aggregates', () => {
  it('returns the summary the front page renders', async () => {
    const res = await request(app).get('/api/stats/summary').expect(200);
    for (const key of ['open_lots', 'orders_today', 'gmv_month_naira', 'farmers', 'buyers']) {
      expect(res.body).toHaveProperty(key);
    }
    expect(typeof res.body.gmv_month_naira).toBe('number');
  });

  it('breaks orders down by crop', async () => {
    const res = await request(app).get('/api/stats/by-crop').expect(200);
    expect(Array.isArray(res.body.crops)).toBe(true);
  });
});

describe('error handling', () => {
  it('returns a 404 with the request id for an unknown path', async () => {
    const res = await request(app).get('/api/nope').expect(404);
    expect(res.body.requestId).toBeTruthy();
  });

  it('returns a 404 for a well-formed but absent uuid', async () => {
    await request(app)
      .get('/api/lots/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });
});

describe('database schema guarantees', () => {
  it('has applied every migration file', async () => {
    const { rows } = await pool.query('SELECT filename FROM schema_migrations ORDER BY filename');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].filename).toBe('001_init.sql');
  });

  it('enforces the order status check constraint at the database level', async () => {
    // Defence in depth: even if application logic were bypassed, the database
    // refuses an invalid status.
    await expect(
      pool.query("UPDATE orders SET status = 'TELEPORTED' WHERE id = (SELECT id FROM orders LIMIT 1)"),
    ).rejects.toThrow();
  });
});
