import React, { useEffect, useState } from 'react';
import api from '../api.js';
import {
  formatNaira, formatTonnage, cropLabel, statusLabel, timeAgo, CROP_LABELS, GRADE_LABELS,
} from '../format.js';

const STATES = ['Kano', 'Kaduna', 'Benue', 'Oyo', 'Niger', 'Kwara', 'Plateau', 'Bauchi'];

/** List produce, watch your lots, and check input-credit eligibility. */
export default function FarmerView({ user }) {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [credit, setCredit] = useState(null);

  const [form, setForm] = useState({
    crop: 'maize',
    tonnage: '',
    moistureGrade: 'A',
    state: user.state || 'Oyo',
    pricePerTonneNaira: '',
  });

  async function load() {
    try {
      const { lots: mine } = await api.myLots();
      setLots(mine);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message, requestId: err.requestId });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setNotice(null);
    try {
      await api.createLot({
        crop: form.crop,
        tonnage: Number(form.tonnage),
        moistureGrade: form.moistureGrade,
        state: form.state,
        pricePerTonneNaira: Number(form.pricePerTonneNaira),
      });
      setNotice({ kind: 'success', text: 'Lot listed. Buyers can see it now.' });
      setForm((prev) => ({ ...prev, tonnage: '', pricePerTonneNaira: '' }));
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message, requestId: err.requestId });
    }
  }

  async function withdraw(id) {
    try {
      await api.withdrawLot(id);
      setNotice({ kind: 'success', text: 'Lot withdrawn.' });
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message, requestId: err.requestId });
    }
  }

  async function checkCredit() {
    try {
      setCredit(await api.creditCheck(250_000));
    } catch (err) {
      setNotice({ kind: 'error', text: err.message, requestId: err.requestId });
    }
  }

  const estimate = Number(form.tonnage) * Number(form.pricePerTonneNaira);

  return (
    <>
      <h1>My produce</h1>

      {notice && (
        <div className={`notice ${notice.kind}`}>
          {notice.text}
          {notice.requestId && <><br /><code>request {notice.requestId}</code></>}
        </div>
      )}

      <div className="grid two">
        <div className="card">
          <h2>List a new lot</h2>
          <form onSubmit={submit}>
            <div className="row two">
              <div className="field">
                <label htmlFor="crop">Crop</label>
                <select id="crop" value={form.crop} onChange={(e) => set('crop', e.target.value)}>
                  {Object.entries(CROP_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="grade">Moisture grade</label>
                <select
                  id="grade"
                  value={form.moistureGrade}
                  onChange={(e) => set('moistureGrade', e.target.value)}
                >
                  {Object.entries(GRADE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="row two">
              <div className="field">
                <label htmlFor="tonnage">Tonnage</label>
                <input
                  id="tonnage"
                  type="number"
                  inputMode="decimal"
                  min="0.5"
                  step="0.5"
                  value={form.tonnage}
                  onChange={(e) => set('tonnage', e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="price">Price per tonne (₦)</label>
                <input
                  id="price"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1000"
                  value={form.pricePerTonneNaira}
                  onChange={(e) => set('pricePerTonneNaira', e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="state">State</label>
              <select id="state" value={form.state} onChange={(e) => set('state', e.target.value)}>
                {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {estimate > 0 && (
              <p className="muted" style={{ fontSize: '.8rem' }}>
                Asking value: <strong>{formatNaira(estimate)}</strong> before grade adjustment.
              </p>
            )}

            <button type="submit">List lot</button>
          </form>
        </div>

        <div className="card">
          <h2>Input credit</h2>
          <p className="muted" style={{ fontSize: '.82rem' }}>
            Advance against your settled trade over the last twelve months.
          </p>
          <button type="button" className="secondary" onClick={checkCredit}>
            Check eligibility for ₦250,000
          </button>

          {credit && (
            <div className={`notice ${credit.eligible ? 'success' : 'info'}`} style={{ marginTop: '.85rem' }}>
              <strong>{credit.eligible ? 'Approved' : 'Not approved'}</strong><br />
              {/* When approved the reason is just "approved", which reads oddly
                  directly under the heading. Only the refusal reason is worth
                  showing - that is the case where the farmer needs to know why. */}
              {!credit.eligible && <>{credit.reason}<br /></>}
              Limit: {formatNaira(credit.limitNaira)} · trailing trade {formatNaira(credit.trailingValueNaira)}
              {' '}from {credit.qualifyingOrders} settled order(s)
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>My lots ({lots.length})</h2>
        {loading && <div className="spinner">Loading…</div>}
        {!loading && lots.length === 0 && (
          <div className="empty">No lots yet. List your first one above.</div>
        )}

        {lots.map((lot) => (
          <div key={lot.id} className="card" style={{ marginBottom: '.6rem', boxShadow: 'none' }}>
            <div className="lot">
              <div className="lot-head">
                <div>
                  <div className="lot-crop">
                    {cropLabel(lot.crop)} · {formatTonnage(lot.tonnage)}
                  </div>
                  <div className="lot-meta">
                    {lot.state} · listed {timeAgo(lot.created_at)} · {lot.order_count} order(s)
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="lot-price">{formatNaira(lot.price_per_tonne_naira, { compact: true })}/t</div>
                  <span className={`badge ${lot.status}`}>{statusLabel(lot.status)}</span>
                </div>
              </div>
              <div>
                <span className={`badge grade-${lot.moisture_grade}`}>
                  Grade {lot.moisture_grade}
                </span>
              </div>
              {lot.status === 'OPEN' && (
                <div className="actions">
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => withdraw(lot.id)}
                  >
                    Withdraw
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
