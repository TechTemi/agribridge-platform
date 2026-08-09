import React, { useEffect, useState } from 'react';
import api from '../api.js';
import {
  formatNaira, formatTonnage, cropLabel, statusLabel, timeAgo,
} from '../format.js';

/**
 * Order lifecycle. The action buttons are driven by allowedTransitions, which
 * the API derives from the same state machine that enforces the rules - so the
 * UI can never offer a transition the server would refuse.
 */
export default function OrdersView({ user }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null);

  async function load() {
    try {
      const { orders: found } = await api.listOrders();
      setOrders(found);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message, requestId: err.requestId });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function open(id) {
    if (expanded === id) { setExpanded(null); setDetail(null); return; }
    setExpanded(id);
    try {
      setDetail(await api.getOrder(id));
    } catch (err) {
      setNotice({ kind: 'error', text: err.message, requestId: err.requestId });
    }
  }

  async function advance(id, status) {
    setNotice(null);
    try {
      await api.setOrderStatus(id, status);
      setNotice({ kind: 'success', text: `Order moved to ${statusLabel(status)}.` });
      await load();
      if (expanded === id) setDetail(await api.getOrder(id));
    } catch (err) {
      // A 409 here is the state machine doing its job - show the reason.
      setNotice({ kind: 'error', text: err.message, requestId: err.requestId });
    }
  }

  if (loading) return <div className="spinner">Loading orders…</div>;

  return (
    <>
      <h1>Orders</h1>

      {notice && (
        <div className={`notice ${notice.kind}`}>
          {notice.text}
          {notice.requestId && <><br /><code>request {notice.requestId}</code></>}
        </div>
      )}

      {orders.length === 0 && (
        <div className="empty">
          No orders yet.{user.role === 'buyer' ? ' Browse open lots to place one.' : ''}
        </div>
      )}

      {orders.map((order) => (
        <div key={order.id} className="card">
          <div className="lot-head">
            <div>
              <div className="lot-crop">
                {cropLabel(order.crop)} · {formatTonnage(order.tonnage)}
              </div>
              <div className="lot-meta">
                {user.role === 'farmer' ? `Buyer: ${order.buyer_name}` : `Farmer: ${order.farmer_name}`}
                {' · '}{order.state}{' · '}{timeAgo(order.created_at)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="lot-price">{formatNaira(order.total_naira, { compact: true })}</div>
              <span className={`badge ${order.status}`}>{statusLabel(order.status)}</span>
            </div>
          </div>

          <div className="actions" style={{ marginTop: '.7rem' }}>
            <button type="button" className="secondary small" onClick={() => open(order.id)}>
              {expanded === order.id ? 'Hide history' : 'History'}
            </button>

            {expanded === order.id && detail?.allowedTransitions?.map((status) => (
              <button
                key={status}
                type="button"
                className={status === 'CANCELLED' ? 'danger small' : 'small'}
                onClick={() => advance(order.id, status)}
              >
                Mark {statusLabel(status).toLowerCase()}
              </button>
            ))}
          </div>

          {expanded === order.id && detail && (
            <div className="table-wrap" style={{ marginTop: '.8rem' }}>
              <table>
                <thead>
                  <tr><th>From</th><th>To</th><th>When</th><th>Request</th></tr>
                </thead>
                <tbody>
                  {detail.events.map((event, i) => (
                    <tr key={i}>
                      <td>{event.from_status ? statusLabel(event.from_status) : '—'}</td>
                      <td>{statusLabel(event.to_status)}</td>
                      <td>{timeAgo(event.created_at)}</td>
                      {/* The request id joins this audit row to the Loki logs. */}
                      <td className="mono">{(event.request_id || '').slice(0, 8)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.allowedTransitions.length === 0 && (
                <p className="muted" style={{ fontSize: '.75rem', marginTop: '.5rem' }}>
                  This order is in a terminal state; no further transitions are possible.
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
