/**
 * Display formatting. Pure functions, unit-tested in format.test.js - the web
 * tier's contribution to the coverage gate.
 */

export const CROP_LABELS = {
  maize: 'Maize',
  sorghum: 'Sorghum',
  soybean: 'Soybean',
  paddy_rice: 'Paddy rice',
};

export const GRADE_LABELS = {
  A: 'Grade A · mill-ready',
  B: 'Grade B · needs drying',
  C: 'Grade C · discounted',
};

export const STATUS_LABELS = {
  PENDING: 'Pending',
  MATCHED: 'Matched',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  SETTLED: 'Settled',
  CANCELLED: 'Cancelled',
  OPEN: 'Open',
  RESERVED: 'Reserved',
  SOLD: 'Sold',
  WITHDRAWN: 'Withdrawn',
};

/**
 * Naira with thousands separators. Large sums are abbreviated so a KPI tile
 * stays readable at 360 px.
 */
export function formatNaira(value, { compact = false } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '₦0';

  if (compact) {
    if (Math.abs(amount) >= 1_000_000_000) return `₦${(amount / 1_000_000_000).toFixed(1)}bn`;
    if (Math.abs(amount) >= 1_000_000) return `₦${(amount / 1_000_000).toFixed(1)}m`;
    if (Math.abs(amount) >= 1_000) return `₦${(amount / 1_000).toFixed(0)}k`;
  }
  return `₦${Math.round(amount).toLocaleString('en-NG')}`;
}

export function formatTonnage(value) {
  const tons = Number(value);
  if (!Number.isFinite(tons)) return '0t';
  return `${tons % 1 === 0 ? tons : tons.toFixed(2)}t`;
}

export function cropLabel(crop) {
  return CROP_LABELS[crop] ?? crop;
}

export function statusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

/** Relative time, so a farmer sees "2h ago" rather than an ISO timestamp. */
export function timeAgo(value, now = new Date()) {
  const then = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(then.getTime())) return '';

  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86_400)}d ago`;
  return then.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}
