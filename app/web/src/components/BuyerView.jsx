import React, { useEffect, useState } from 'react';
import api from '../api.js';
import {
  formatNaira, formatTonnage, cropLabel, timeAgo, CROP_LABELS,
} from '../format.js';

const STATES = ['', 'Kano', 'Kaduna', 'Benue', 'Oyo', 'Niger', 'Kwara', 'Plateau', 'Bauchi'];

/** Browse open lots with filters, and place a purchase order. */
export default function BuyerView() {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [filters, setFilters] = useState({ crop: '', state: '', maxPrice: '' });
  const [tonnages, setTonnages] = useState({});
  const [placing, setPlacing] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const { lots: found } = await api.listLots(filters);
      setLots(found);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message, requestId: err.requestId });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [filters.crop, filters.state, filters.maxPrice]);

  async function order(lot) {
    const tonnage = Number(tonnages[lot.id] ?? lot.tonnage);
    setPlacing(lot.id);
    setNotice(null);
    try {
      const { order: created, pricing } = await api.createOrder(lot.id, tonnage);
      setNotice({
        kind: 'success',
        text: `Order placed for ${formatTonnage(tonnage)} of ${cropLabel(lot.crop)} `
          + `at ${formatNaira(pricing.totalNaira)} `
          + `(grade ${lot.moisture_grade} multiplier ${pricing.gradeMultiplier}). `
          + `Reference ${created.id.slice(0, 8)}.`,
      });
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message, requestId: err.requestId });
    } finally {
      setPlacing(null);
    }
  }

  return (
    <>
      <h1>Open lots</h1>

      {notice && (
        <div className={`notice ${notice.kind}`}>
          {notice.text}
          {notice.requestId && <><br /><code>request {notice.requestId}</code></>}
        </div>
      )}

      <div className="card">
        <div className="row two">
          <div className="field">
            <label htmlFor="f-crop">Crop</label>
            <select
              id="f-crop"
              value={filters.crop}
              onChange={(e) => setFilters({ ...filters, crop: e.target.value })}
            >
              <option value="">All crops</option>
              {Object.entries(CROP_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-state">State</label>
            <select
              id="f-state"
              value={filters.state}
              onChange={(e) => setFilters({ ...filters, state: e.target.value })}
            >
              {STATES.map((s) => <option key={s || 'all'} value={s}>{s || 'All states'}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="f-price">Max price per tonne (₦)</label>
          <input
            id="f-price"
            type="number"
            inputMode="numeric"
            step="10000"
            placeholder="no limit"
            value={filters.maxPrice}
            onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })}
          />
        </div>
      </div>

      {loading && <div className="spinner">Searching lots…</div>}

      {!loading && lots.length === 0 && (
        <div className="empty">
          No lots match those filters. Try widening the search.
        </div>
      )}

      <div className="grid two">
        {lots.map((lot) => (
          <div key={lot.id} className="card">
            <div className="lot">
              <div className="lot-head">
                <div>
                  <div className="lot-crop">{cropLabel(lot.crop)}</div>
                  <div className="lot-meta">
                    {lot.farmer_name} · {lot.state} · {timeAgo(lot.created_at)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="lot-price">
                    {formatNaira(lot.price_per_tonne_naira, { compact: true })}/t
                  </div>
                  <span className={`badge grade-${lot.moisture_grade}`}>
                    Grade {lot.moisture_grade}
                  </span>
                </div>
              </div>

              <div className="lot-meta">
                Available: <strong>{formatTonnage(lot.tonnage)}</strong>
              </div>

              <div className="row two" style={{ alignItems: 'end' }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`t-${lot.id}`}>Tonnage to buy</label>
                  <input
                    id={`t-${lot.id}`}
                    type="number"
                    inputMode="decimal"
                    min="0.5"
                    step="0.5"
                    max={lot.tonnage}
                    placeholder={String(lot.tonnage)}
                    value={tonnages[lot.id] ?? ''}
                    onChange={(e) => setTonnages({ ...tonnages, [lot.id]: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => order(lot)}
                  disabled={placing === lot.id}
                >
                  {placing === lot.id ? 'Placing…' : 'Place order'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
