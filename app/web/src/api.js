/**
 * Thin API client.
 *
 * All requests are relative to the current origin. In development Vite proxies
 * /api to the API; in the cluster nginx proxies it to the api Service. The
 * frontend therefore has no build-time knowledge of any hostname, which is why
 * the same image runs unchanged in staging and production.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

class ApiError extends Error {
  constructor(message, status, requestId) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    // Surfaced in the UI so a user can quote it to support and you can find the
    // exact request in Loki.
    this.requestId = requestId;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? JSON_HEADERS : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',        // send the httpOnly session cookie
  });

  const requestId = response.headers.get('X-Request-Id');
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new ApiError(payload.error || `request failed (${response.status})`,
      response.status, requestId);
  }
  return payload;
}

export const api = {
  // auth
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),

  // lots
  listLots: (filters = {}) => {
    const params = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== '' && v != null),
    );
    const qs = params.toString();
    return request(`/api/lots${qs ? `?${qs}` : ''}`);
  },
  myLots: () => request('/api/lots/mine'),
  createLot: (lot) => request('/api/lots', { method: 'POST', body: lot }),
  withdrawLot: (id) => request(`/api/lots/${id}`, { method: 'DELETE' }),

  // orders
  listOrders: (status) => request(`/api/orders${status ? `?status=${status}` : ''}`),
  getOrder: (id) => request(`/api/orders/${id}`),
  createOrder: (lotId, tonnage) => request('/api/orders', { method: 'POST', body: { lotId, tonnage } }),
  setOrderStatus: (id, status) => request(`/api/orders/${id}/status`, { method: 'PATCH', body: { status } }),
  creditCheck: (requestedNaira) => request('/api/orders/credit-check', { method: 'POST', body: { requestedNaira } }),

  // stats
  summary: () => request('/api/stats/summary'),
  byCrop: () => request('/api/stats/by-crop'),

  // operational - used by the About panel to show the running commit
  version: () => request('/version'),
};

export { ApiError };
export default api;
