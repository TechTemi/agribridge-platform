/**
 * Demo data.
 *
 * Dashboards with empty tables undersell the work, and a browse screen with no
 * lots looks broken on camera. This seeds believable Nigerian produce data:
 * real crops, real states, plausible tonnages and prices.
 *
 * Idempotent - it checks for an existing seed marker first, so it is safe to
 * leave SEED_DEMO_DATA=true in staging.
 */
import { query, queryOne } from './db.js';
import { hashPassword } from './auth.js';
import { calculateOrderTotal } from './domain/pricing.js';
import logger from './logger.js';

const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'HarvestMonday2025!';

const FARMERS = [
  { email: 'amina.yusuf@example.ng', name: 'Amina Yusuf', state: 'Kano' },
  { email: 'chike.obi@example.ng', name: 'Chike Obi', state: 'Benue' },
  { email: 'segun.adeyemi@example.ng', name: 'Segun Adeyemi', state: 'Oyo' },
  { email: 'hauwa.bello@example.ng', name: 'Hauwa Bello', state: 'Kaduna' },
  { email: 'ifeoma.eze@example.ng', name: 'Ifeoma Eze', state: 'Niger' },
];

const BUYERS = [
  { email: 'procurement@sahelmills.example', name: 'Sahel Mills Procurement', org: 'Sahel Flour Mills' },
  { email: 'buying@zenithfeeds.example', name: 'Zenith Feeds Buying Desk', org: 'Zenith Poultry Feeds' },
  { email: 'grain@northbrew.example', name: 'Northern Brewery Grain Desk', org: 'Northern Breweries' },
];

const LOTS = [
  { crop: 'maize', tonnage: 45, grade: 'A', state: 'Kano', price: 620_000 },
  { crop: 'maize', tonnage: 120, grade: 'B', state: 'Oyo', price: 585_000 },
  { crop: 'sorghum', tonnage: 60, grade: 'A', state: 'Kaduna', price: 540_000 },
  { crop: 'soybean', tonnage: 30, grade: 'A', state: 'Benue', price: 1_150_000 },
  { crop: 'soybean', tonnage: 75, grade: 'C', state: 'Niger', price: 980_000 },
  { crop: 'paddy_rice', tonnage: 90, grade: 'B', state: 'Kano', price: 760_000 },
  { crop: 'maize', tonnage: 200, grade: 'A', state: 'Benue', price: 610_000 },
  { crop: 'sorghum', tonnage: 25, grade: 'C', state: 'Niger', price: 495_000 },
];

export async function seedDemoData() {
  const existing = await queryOne('seed_check', 'SELECT COUNT(*)::int AS n FROM users');
  if ((existing?.n ?? 0) > 0) {
    logger.info('demo data already present; skipping seed', { users: existing.n });
    return { skipped: true };
  }

  logger.info('seeding demo data');
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const farmerIds = [];
  for (const f of FARMERS) {
    const row = await queryOne('seed_farmer', `
      INSERT INTO users (email, password_hash, full_name, role, state)
      VALUES ($1, $2, $3, 'farmer', $4) RETURNING id
    `, [f.email, passwordHash, f.name, f.state]);
    farmerIds.push(row.id);
  }

  const buyerIds = [];
  for (const b of BUYERS) {
    const row = await queryOne('seed_buyer', `
      INSERT INTO users (email, password_hash, full_name, role, organisation)
      VALUES ($1, $2, $3, 'buyer', $4) RETURNING id
    `, [b.email, passwordHash, b.name, b.org]);
    buyerIds.push(row.id);
  }

  await queryOne('seed_agent', `
    INSERT INTO users (email, password_hash, full_name, role, state)
    VALUES ('agent@agribridge.example', $1, 'Field Agent (Ibadan)', 'agent', 'Oyo')
    RETURNING id
  `, [passwordHash]);

  const lotIds = [];
  for (let i = 0; i < LOTS.length; i += 1) {
    const l = LOTS[i];
    const row = await queryOne('seed_lot', `
      INSERT INTO lots (farmer_id, crop, tonnage, moisture_grade, state, price_per_tonne_naira, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW() - ($7 || ' hours')::interval)
      RETURNING id
    `, [farmerIds[i % farmerIds.length], l.crop, l.tonnage, l.grade, l.state, l.price, i * 7]);
    lotIds.push({ id: row.id, ...l });
  }

  // A few orders at various lifecycle stages, including two settled ones far
  // enough back to make the credit-eligibility endpoint return something
  // interesting during the demo.
  const plan = [
    { lot: 0, buyer: 0, tons: 20, status: 'SETTLED', daysAgo: 60 },
    { lot: 1, buyer: 1, tons: 50, status: 'SETTLED', daysAgo: 30 },
    { lot: 2, buyer: 2, tons: 15, status: 'DELIVERED', daysAgo: 6 },
    { lot: 3, buyer: 0, tons: 10, status: 'IN_TRANSIT', daysAgo: 3 },
    { lot: 5, buyer: 1, tons: 40, status: 'MATCHED', daysAgo: 1 },
    { lot: 6, buyer: 2, tons: 60, status: 'PENDING', daysAgo: 0 },
  ];

  for (const p of plan) {
    const lot = lotIds[p.lot];
    const pricing = calculateOrderTotal({
      tonnage: p.tons,
      pricePerTonneNaira: lot.price,
      moistureGrade: lot.grade,
    });

    const order = await queryOne('seed_order', `
      INSERT INTO orders (lot_id, buyer_id, tonnage, total_naira, platform_fee_naira,
                          farmer_payout_naira, status, created_at, updated_at, settled_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7,
              NOW() - ($8 || ' days')::interval,
              NOW() - ($8 || ' days')::interval,
              CASE WHEN $7 = 'SETTLED' THEN NOW() - ($8 || ' days')::interval ELSE NULL END)
      RETURNING id
    `, [lot.id, buyerIds[p.buyer], p.tons, pricing.totalNaira, pricing.platformFeeNaira,
      pricing.farmerPayoutNaira, p.status, p.daysAgo]);

    await query('seed_order_event', `
      INSERT INTO order_events (order_id, from_status, to_status, request_id)
      VALUES ($1, NULL, 'PENDING', 'seed')
    `, [order.id]);

    if (p.status === 'SETTLED') {
      await query('seed_lot_sold', "UPDATE lots SET status = 'SOLD' WHERE id = $1", [lot.id]);
    }
  }

  logger.info('demo data seeded', {
    farmers: FARMERS.length, buyers: BUYERS.length, lots: LOTS.length, orders: plan.length,
  });

  return {
    skipped: false,
    credentials: { password: DEMO_PASSWORD, farmer: FARMERS[0].email, buyer: BUYERS[0].email },
  };
}

export default seedDemoData;
