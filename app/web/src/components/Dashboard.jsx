import React, { useEffect, useState } from 'react';
import api from '../api.js';
import { formatNaira, formatTonnage, cropLabel } from '../format.js';

/**
 * The dashboard. Deliberately the same figures that the API publishes as
 * Prometheus business metrics, so the Grafana business dashboard and this page
 * cannot disagree.
 */
export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [crops, setCrops] = useState([]);
  const [error, setError] = useState(null);

  async function load() {
    try {
      const [s, c] = await Promise.all([api.summary(), api.byCrop()]);
      setSummary(s);
      setCrops(c.crops);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    load();
    // Slow poll: enough to look live on camera, gentle enough for 3G.
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, []);

  if (error) {
    return (
      <div className="notice error">
        Could not load the dashboard: {error.message}
        {error.requestId && <><br /><code>request {error.requestId}</code></>}
      </div>
    );
  }

  if (!summary) return <div className="spinner">Loading dashboard…</div>;

  return (
    <>
      <h1>Marketplace overview</h1>

      <div className="kpis">
        <div className="kpi">
          <div className="label">Open lots</div>
          <div className="value">{summary.open_lots}</div>
          <div className="sub">{formatTonnage(summary.open_tonnage)} available</div>
        </div>
        <div className="kpi">
          <div className="label">Orders today</div>
          <div className="value">{summary.orders_today}</div>
          <div className="sub">{summary.orders_pending} pending</div>
        </div>
        <div className="kpi">
          <div className="label">GMV this month</div>
          <div className="value">{formatNaira(summary.gmv_month_naira, { compact: true })}</div>
          <div className="sub">{summary.orders_settled} settled</div>
        </div>
        <div className="kpi">
          <div className="label">Participants</div>
          <div className="value">{summary.farmers + summary.buyers}</div>
          <div className="sub">{summary.farmers} farmers · {summary.buyers} buyers</div>
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Order pipeline</h2>
          <table>
            <tbody>
              <tr><td>Pending</td><td className="nowrap">{summary.orders_pending}</td></tr>
              <tr><td>In transit</td><td className="nowrap">{summary.orders_in_transit}</td></tr>
              <tr><td>Settled</td><td className="nowrap">{summary.orders_settled}</td></tr>
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: '.75rem', marginTop: '.75rem' }}>
            A stall in one stage shows up here before it shows up in revenue.
          </p>
        </div>

        <div className="card">
          <h2>Trade by crop</h2>
          {crops.length === 0
            ? <div className="empty">No orders yet.</div>
            : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Crop</th><th>Orders</th><th>Tonnage</th><th>Value</th></tr>
                  </thead>
                  <tbody>
                    {crops.map((c) => (
                      <tr key={c.crop}>
                        <td>{cropLabel(c.crop)}</td>
                        <td>{c.orders}</td>
                        <td>{formatTonnage(c.tonnage)}</td>
                        <td>{formatNaira(c.value_naira, { compact: true })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>
    </>
  );
}
