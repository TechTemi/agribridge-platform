/**
 * The order lifecycle state machine.
 *
 * Pure logic. The API routes consult this before writing anything, so an
 * illegal transition is rejected identically whether it arrives from the web
 * app, from a script, or from a curl command during your demo.
 */

export const ORDER_STATUS = Object.freeze({
  PENDING: 'PENDING',
  MATCHED: 'MATCHED',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  SETTLED: 'SETTLED',
  CANCELLED: 'CANCELLED',
});

export const ORDER_STATUSES = Object.freeze(Object.values(ORDER_STATUS));

/** Legal transitions. Anything not listed here is refused. */
const TRANSITIONS = Object.freeze({
  PENDING: ['MATCHED', 'CANCELLED'],
  MATCHED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED'],
  DELIVERED: ['SETTLED'],
  SETTLED: [],
  CANCELLED: [],
});

/** Statuses from which no further movement is possible. */
export const TERMINAL_STATUSES = Object.freeze(['SETTLED', 'CANCELLED']);

export class TransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransitionError';
    this.statusCode = 409;
  }
}

export function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

export function allowedTransitions(status) {
  return TRANSITIONS[status] ? [...TRANSITIONS[status]] : [];
}

export function canTransition(from, to) {
  if (!TRANSITIONS[from]) return false;
  return TRANSITIONS[from].includes(to);
}

/**
 * Validate a transition, throwing a 409 if it is not permitted.
 * Returns the target status so callers can use it inline.
 */
export function assertTransition(from, to) {
  if (!ORDER_STATUSES.includes(to)) {
    throw new TransitionError(`unknown target status: ${to}`);
  }
  if (from === to) {
    throw new TransitionError(`order is already ${from}`);
  }
  if (!canTransition(from, to)) {
    const allowed = allowedTransitions(from);
    throw new TransitionError(
      allowed.length === 0
        ? `${from} is terminal; no further transitions are possible`
        : `cannot move from ${from} to ${to}; allowed: ${allowed.join(', ')}`,
    );
  }
  return to;
}

/**
 * Which role is permitted to perform a given transition.
 * Farmers move goods, buyers confirm and settle, agents can do either.
 */
const TRANSITION_ROLES = Object.freeze({
  MATCHED: ['farmer', 'agent'],
  IN_TRANSIT: ['farmer', 'agent'],
  DELIVERED: ['buyer', 'agent'],
  SETTLED: ['buyer', 'agent'],
  CANCELLED: ['farmer', 'buyer', 'agent'],
});

export function roleMayTransition(role, to) {
  const roles = TRANSITION_ROLES[to];
  return Array.isArray(roles) && roles.includes(role);
}
