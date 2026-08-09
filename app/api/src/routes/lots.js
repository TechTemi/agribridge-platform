import { Router } from 'express';
import { query, queryOne } from '../db.js';
import { cacheGet, cacheSet, cacheInvalidate } from '../cache.js';
import { requireAuth, requireRole } from '../auth.js';
import { asyncRoute } from '../middleware.js';
import { lotsOpen } from '../metrics.js';
import { VALID_MOISTURE_GRADES } from '../domain/pricing.js';
import logger from '../logger.js';

export const lotsRouter = Router();

const CROPS = ['maize', 'sorghum', 'soybean', 'paddy_rice'];

/** Keep the open-lots gauge honest after any write. */
async function refreshOpenLotsGauge() {
  const row = await queryOne('lots_count_open', "SELECT COUNT(*)::int AS n FROM lots WHERE status = 'OPEN'");
  lotsOpen.set(row?.n ?? 0);
}

/**
 * GET /api/lots - browse open lots, with filters.
 * Cached briefly: this is the highest-traffic read on the platform and the
 * page a buyer refreshes repeatedly while deciding.
 */
lotsRouter.get('/', asyncRoute(async (req, res) => {
  const { crop, state, maxPrice, status = 'OPEN' } = req.query;
  const limit = Math.min(Number.parseInt(req.query.limit ?? '50', 10) || 50, 200);

  if (crop && !CROPS.includes(crop)) {
    return res.status(400).json({ error: `crop must be one of ${CROPS.join(', ')}` });
  }

  const cacheKey = `lots:${status}:${crop ?? '*'}:${state ?? '*'}:${maxPrice ?? '*'}:${limit}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  const clauses = ['l.status = $1'];
  const params = [status];

  if (crop) { params.push(crop); clauses.push(`l.crop = $${params.length}`); }
  if (state) { params.push(state); clauses.push(`l.state = $${params.length}`); }
  if (maxPrice) {
    const parsed = Number.parseInt(maxPrice, 10);
    if (Number.isNaN(parsed)) return res.status(400).json({ error: 'maxPrice must be an integer' });
    params.push(parsed);
    clauses.push(`l.price_per_tonne_naira <= $${params.length}`);
  }
  params.push(limit);

  const { rows } = await query('lots_browse', `
    SELECT l.id, l.crop, l.tonnage, l.moisture_grade, l.state,
           l.price_per_tonne_naira, l.status, l.created_at,
           u.full_name AS farmer_name
      FROM lots l
      JOIN users u ON u.id = l.farmer_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY l.created_at DESC
     LIMIT $${params.length}
  `, params);

  const payload = { lots: rows, count: rows.length };
  await cacheSet(cacheKey, payload);
  return res.json(payload);
}));

/** GET /api/lots/mine - a farmer's own lots and their status. */
lotsRouter.get('/mine', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await query('lots_by_farmer', `
    SELECT l.*,
           (SELECT COUNT(*)::int FROM orders o WHERE o.lot_id = l.id) AS order_count
      FROM lots l
     WHERE l.farmer_id = $1
     ORDER BY l.created_at DESC
  `, [req.user.id]);
  res.json({ lots: rows, count: rows.length });
}));

/** POST /api/lots - a farmer lists produce for sale. */
lotsRouter.post('/', requireRole('farmer'), asyncRoute(async (req, res) => {
  const {
    crop, tonnage, moistureGrade, state, pricePerTonneNaira,
  } = req.body ?? {};

  const errors = [];
  if (!CROPS.includes(crop)) errors.push(`crop must be one of ${CROPS.join(', ')}`);
  const tons = Number(tonnage);
  if (!Number.isFinite(tons) || tons <= 0) errors.push('tonnage must be a positive number');
  if (!VALID_MOISTURE_GRADES.includes(moistureGrade)) {
    errors.push(`moistureGrade must be one of ${VALID_MOISTURE_GRADES.join(', ')}`);
  }
  if (typeof state !== 'string' || !state.trim()) errors.push('state is required');
  const price = Number(pricePerTonneNaira);
  if (!Number.isInteger(price) || price <= 0) errors.push('pricePerTonneNaira must be a positive integer');

  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const lot = await queryOne('lots_insert', `
    INSERT INTO lots (farmer_id, crop, tonnage, moisture_grade, state, price_per_tonne_naira)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [req.user.id, crop, tons, moistureGrade, state.trim(), price]);

  await cacheInvalidate('lots:');
  await refreshOpenLotsGauge();

  logger.info('lot created', { lot_id: lot.id, crop, tonnage: tons, state });
  return res.status(201).json({ lot });
}));

/** GET /api/lots/:id */
lotsRouter.get('/:id', asyncRoute(async (req, res) => {
  const lot = await queryOne('lots_get', `
    SELECT l.*, u.full_name AS farmer_name, u.state AS farmer_state
      FROM lots l JOIN users u ON u.id = l.farmer_id
     WHERE l.id = $1
  `, [req.params.id]);

  if (!lot) return res.status(404).json({ error: 'lot not found' });
  return res.json({ lot });
}));

/** DELETE /api/lots/:id - withdraw a lot that has no orders against it. */
lotsRouter.delete('/:id', requireRole('farmer'), asyncRoute(async (req, res) => {
  const lot = await queryOne('lots_owner_check',
    'SELECT id, farmer_id, status FROM lots WHERE id = $1', [req.params.id]);

  if (!lot) return res.status(404).json({ error: 'lot not found' });
  if (lot.farmer_id !== req.user.id && req.user.role !== 'agent') {
    return res.status(403).json({ error: 'you can only withdraw your own lots' });
  }
  if (lot.status !== 'OPEN') {
    return res.status(409).json({ error: `cannot withdraw a lot that is ${lot.status}` });
  }

  await query('lots_withdraw',
    "UPDATE lots SET status = 'WITHDRAWN', updated_at = NOW() WHERE id = $1", [req.params.id]);

  await cacheInvalidate('lots:');
  await refreshOpenLotsGauge();
  return res.json({ ok: true, id: req.params.id, status: 'WITHDRAWN' });
}));

export { refreshOpenLotsGauge };
export default lotsRouter;
