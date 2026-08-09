/**
 * Dashboard aggregates.
 *
 * These are the numbers Adaeze looks at, and they are deliberately the same
 * numbers exposed as Prometheus business metrics. When the API is down the
 * dashboard is empty AND agribridge_orders_created_total goes flat - two
 * independent signals of the same truth.
 */
import { Router } from 'express';
import { query, queryOne } from '../db.js';
import { cacheGet, cacheSet } from '../cache.js';
import { asyncRoute } from '../middleware.js';
import { requireAuth } from '../auth.js';

export const statsRouter = Router();

statsRouter.get('/summary', asyncRoute(async (_req, res) => {
  const cached = await cacheGet('stats:summary');
  if (cached) return res.json({ ...cached, cached: true });

  const summary = await queryOne('stats_summary', `
    SELECT
      (SELECT COUNT(*)::int FROM lots WHERE status = 'OPEN')                    AS open_lots,
      (SELECT COALESCE(SUM(tonnage), 0)::float FROM lots WHERE status = 'OPEN') AS open_tonnage,
      (SELECT COUNT(*)::int FROM orders
        WHERE created_at >= DATE_TRUNC('day', NOW()))                           AS orders_today,
      (SELECT COALESCE(SUM(total_naira), 0)::bigint FROM orders
        WHERE created_at >= DATE_TRUNC('month', NOW()))                         AS gmv_month_naira,
      (SELECT COUNT(*)::int FROM orders WHERE status = 'PENDING')                AS orders_pending,
      (SELECT COUNT(*)::int FROM orders WHERE status = 'IN_TRANSIT')             AS orders_in_transit,
      (SELECT COUNT(*)::int FROM orders WHERE status = 'SETTLED')                AS orders_settled,
      (SELECT COUNT(*)::int FROM users WHERE role = 'farmer')                    AS farmers,
      (SELECT COUNT(*)::int FROM users WHERE role = 'buyer')                     AS buyers
  `);

  // BIGINT comes back as a string from node-postgres to avoid precision loss.
  const payload = { ...summary, gmv_month_naira: Number(summary.gmv_month_naira) };
  await cacheSet('stats:summary', payload, 15);
  return res.json(payload);
}));

/** Orders per crop - drives the funnel panel on the business dashboard. */
statsRouter.get('/by-crop', asyncRoute(async (_req, res) => {
  const { rows } = await query('stats_by_crop', `
    SELECT l.crop,
           COUNT(o.id)::int                        AS orders,
           COALESCE(SUM(o.total_naira), 0)::bigint AS value_naira,
           COALESCE(SUM(o.tonnage), 0)::float      AS tonnage
      FROM orders o JOIN lots l ON l.id = o.lot_id
     GROUP BY l.crop
     ORDER BY value_naira DESC
  `);
  res.json({
    crops: rows.map((r) => ({ ...r, value_naira: Number(r.value_naira) })),
  });
}));

/** The order-state funnel. */
statsRouter.get('/funnel', requireAuth, asyncRoute(async (_req, res) => {
  const { rows } = await query('stats_funnel', `
    SELECT status, COUNT(*)::int AS count
      FROM orders GROUP BY status
  `);
  res.json({ funnel: rows });
}));

export default statsRouter;
