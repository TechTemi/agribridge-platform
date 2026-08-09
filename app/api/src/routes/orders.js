import { Router } from 'express';
import { query, queryOne, withTransaction } from '../db.js';
import { cacheInvalidate } from '../cache.js';
import { requireAuth, requireRole } from '../auth.js';
import { asyncRoute } from '../middleware.js';
import { ordersCreatedTotal, orderValueNaira, orderStateTransitions } from '../metrics.js';
import { calculateOrderTotal } from '../domain/pricing.js';
import { assertTransition, roleMayTransition, allowedTransitions } from '../domain/orders.js';
import { assessCreditEligibility } from '../domain/credit.js';
import { refreshOpenLotsGauge } from './lots.js';
import logger from '../logger.js';

export const ordersRouter = Router();

/**
 * POST /api/orders - a buyer places a purchase order against an open lot.
 *
 * Wrapped in a transaction with SELECT ... FOR UPDATE on the lot. Without the
 * row lock, two buyers hitting the same lot concurrently could both succeed
 * and oversell the farmer's tonnage. This is the kind of correctness the load
 * test in scripts/load-test.js is actually exercising.
 */
ordersRouter.post('/', requireRole('buyer'), asyncRoute(async (req, res) => {
  const { lotId, tonnage } = req.body ?? {};
  const tons = Number(tonnage);

  if (typeof lotId !== 'string' || !lotId) {
    return res.status(400).json({ error: 'lotId is required' });
  }
  if (!Number.isFinite(tons) || tons <= 0) {
    return res.status(400).json({ error: 'tonnage must be a positive number' });
  }

  const result = await withTransaction('orders_create_tx', async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM lots WHERE id = $1 FOR UPDATE', [lotId],
    );
    const lot = rows[0];

    if (!lot) return { status: 404, body: { error: 'lot not found' } };
    if (lot.status !== 'OPEN') {
      return { status: 409, body: { error: `lot is ${lot.status} and cannot be ordered` } };
    }
    if (tons > Number(lot.tonnage)) {
      return {
        status: 409,
        body: { error: `requested ${tons}t exceeds the ${lot.tonnage}t available` },
      };
    }

    // Pricing is pure domain logic, unit-tested in isolation.
    const pricing = calculateOrderTotal({
      tonnage: tons,
      pricePerTonneNaira: Number(lot.price_per_tonne_naira),
      moistureGrade: lot.moisture_grade,
    });

    const { rows: inserted } = await client.query(`
      INSERT INTO orders (lot_id, buyer_id, tonnage, total_naira,
                          platform_fee_naira, farmer_payout_naira)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [lotId, req.user.id, tons, pricing.totalNaira,
      pricing.platformFeeNaira, pricing.farmerPayoutNaira]);

    const order = inserted[0];

    await client.query(`
      INSERT INTO order_events (order_id, from_status, to_status, actor_id, request_id)
      VALUES ($1, NULL, 'PENDING', $2, $3)
    `, [order.id, req.user.id, req.requestId]);

    // Fully consumed lots leave the browse list; partial ones stay open.
    const remaining = Number(lot.tonnage) - tons;
    if (remaining <= 0.001) {
      await client.query("UPDATE lots SET status = 'RESERVED', updated_at = NOW() WHERE id = $1", [lotId]);
    } else {
      await client.query(
        'UPDATE lots SET tonnage = $2, updated_at = NOW() WHERE id = $1', [lotId, remaining],
      );
    }

    return { status: 201, body: { order, pricing }, lot };
  });

  if (result.status === 201) {
    // Everything below runs AFTER the transaction has committed, so a failure
    // here must never be reported to the client as a failed order. It once was:
    // total_naira arrived as a string, prom-client rejected it, and the API
    // returned 500 for an order that had been created - so the client retried
    // and ordered twice. Metrics, cache and logging are observability, not
    // correctness; they are allowed to fail quietly and loudly at the same time.
    try {
      ordersCreatedTotal.inc({ crop: result.lot.crop, state: result.lot.state });
      orderValueNaira.inc(Number(result.body.order.total_naira));
      orderStateTransitions.inc({ from: 'NONE', to: 'PENDING' });

      await cacheInvalidate('lots:');
      await cacheInvalidate('stats:');
      await refreshOpenLotsGauge();

      logger.info('order created', {
        order_id: result.body.order.id,
        lot_id: lotId,
        crop: result.lot.crop,
        total_naira: result.body.order.total_naira,
      });
    } catch (err) {
      // Logged as an error because a broken business metric blinds alert A-12,
      // which is a real problem - just not this request's problem.
      logger.error('post-commit side effects failed; the order itself is committed', {
        order_id: result.body.order.id, err,
      });
    }
  }

  return res.status(result.status).json(result.body);
}));

/** GET /api/orders - orders visible to the caller. */
ordersRouter.get('/', requireAuth, asyncRoute(async (req, res) => {
  const { status } = req.query;
  const params = [req.user.id];
  const clauses = [];

  // Buyers see their own orders; farmers see orders against their lots;
  // agents see everything.
  if (req.user.role === 'buyer') clauses.push('o.buyer_id = $1');
  else if (req.user.role === 'farmer') clauses.push('l.farmer_id = $1');
  else clauses.push('$1 IS NOT NULL');

  if (status) { params.push(status); clauses.push(`o.status = $${params.length}`); }

  const { rows } = await query('orders_list', `
    SELECT o.*, l.crop, l.state, l.moisture_grade,
           b.full_name AS buyer_name, f.full_name AS farmer_name
      FROM orders o
      JOIN lots  l ON l.id = o.lot_id
      JOIN users b ON b.id = o.buyer_id
      JOIN users f ON f.id = l.farmer_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY o.created_at DESC
     LIMIT 200
  `, params);

  res.json({ orders: rows, count: rows.length });
}));

/** GET /api/orders/:id - one order plus its full audit trail. */
ordersRouter.get('/:id', requireAuth, asyncRoute(async (req, res) => {
  const order = await queryOne('orders_get', `
    SELECT o.*, l.crop, l.state, l.farmer_id, l.moisture_grade
      FROM orders o JOIN lots l ON l.id = o.lot_id
     WHERE o.id = $1
  `, [req.params.id]);

  if (!order) return res.status(404).json({ error: 'order not found' });

  const mine = order.buyer_id === req.user.id || order.farmer_id === req.user.id;
  if (!mine && req.user.role !== 'agent') {
    return res.status(403).json({ error: 'not your order' });
  }

  const { rows: events } = await query('orders_events', `
    SELECT from_status, to_status, actor_id, request_id, created_at
      FROM order_events WHERE order_id = $1 ORDER BY created_at
  `, [req.params.id]);

  return res.json({
    order,
    events,
    allowedTransitions: allowedTransitions(order.status),
  });
}));

/**
 * PATCH /api/orders/:id/status - advance the lifecycle.
 * The state machine decides legality; the role check decides authority.
 */
ordersRouter.patch('/:id/status', requireAuth, asyncRoute(async (req, res) => {
  const { status: target } = req.body ?? {};
  if (typeof target !== 'string') {
    return res.status(400).json({ error: 'status is required' });
  }

  const order = await queryOne('orders_status_lookup', `
    SELECT o.id, o.status, o.buyer_id, l.farmer_id
      FROM orders o JOIN lots l ON l.id = o.lot_id
     WHERE o.id = $1
  `, [req.params.id]);

  if (!order) return res.status(404).json({ error: 'order not found' });

  const mine = order.buyer_id === req.user.id || order.farmer_id === req.user.id;
  if (!mine && req.user.role !== 'agent') {
    return res.status(403).json({ error: 'not your order' });
  }
  if (!roleMayTransition(req.user.role, target)) {
    return res.status(403).json({
      error: `a ${req.user.role} may not move an order to ${target}`,
    });
  }

  // Throws a 409 with a helpful message if the transition is illegal.
  assertTransition(order.status, target);

  const settling = target === 'SETTLED';
  const updated = await queryOne('orders_status_update', `
    UPDATE orders
       SET status = $2, updated_at = NOW(),
           settled_at = CASE WHEN $3 THEN NOW() ELSE settled_at END
     WHERE id = $1
    RETURNING *
  `, [req.params.id, target, settling]);

  await query('orders_event_insert', `
    INSERT INTO order_events (order_id, from_status, to_status, actor_id, request_id)
    VALUES ($1, $2, $3, $4, $5)
  `, [req.params.id, order.status, target, req.user.id, req.requestId]);

  if (settling) {
    await query('lots_mark_sold',
      "UPDATE lots SET status = 'SOLD', updated_at = NOW() WHERE id = (SELECT lot_id FROM orders WHERE id = $1)",
      [req.params.id]);
  }

  orderStateTransitions.inc({ from: order.status, to: target });
  await cacheInvalidate('stats:');

  logger.info('order transitioned', {
    order_id: req.params.id, from: order.status, to: target,
  });

  return res.json({ order: updated, allowedTransitions: allowedTransitions(target) });
}));

/**
 * POST /api/orders/credit-check - input-credit eligibility for a farmer.
 * Pure domain logic over the farmer's trailing settled trade.
 */
ordersRouter.post('/credit-check', requireRole('farmer'), asyncRoute(async (req, res) => {
  const requestedNaira = Number(req.body?.requestedNaira);

  const { rows } = await query('orders_settled_for_credit', `
    SELECT o.total_naira, o.settled_at
      FROM orders o JOIN lots l ON l.id = o.lot_id
     WHERE l.farmer_id = $1 AND o.status = 'SETTLED' AND o.settled_at IS NOT NULL
  `, [req.user.id]);

  const assessment = assessCreditEligibility({
    settledOrders: rows.map((r) => ({
      totalNaira: Number(r.total_naira),
      settledAt: r.settled_at,
    })),
    requestedNaira,
  });

  logger.info('credit assessed', {
    eligible: assessment.eligible, limit_naira: assessment.limitNaira,
  });

  res.json(assessment);
}));

export default ordersRouter;
