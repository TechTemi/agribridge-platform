/**
 * Input-credit eligibility.
 *
 * AgriBridge advances seed and fertiliser against a farmer's trailing
 * settled trade. Pure function: the caller supplies the settled orders and
 * the current time, so the tests do not need to mock a clock.
 */

export const TRAILING_WINDOW_DAYS = 365;
export const ADVANCE_RATE = 0.4;            // up to 40% of trailing settled value
export const HARD_CAP_NAIRA = 2_000_000;    // partner bank ceiling per farmer
export const MIN_SETTLED_ORDERS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {object} input
 * @param {Array<{totalNaira:number, settledAt:Date|string}>} input.settledOrders
 * @param {number} input.requestedNaira
 * @param {Date}   [input.now]
 * @returns {{eligible:boolean, limitNaira:number, trailingValueNaira:number,
 *            qualifyingOrders:number, reason:string}}
 */
export function assessCreditEligibility({ settledOrders = [], requestedNaira, now = new Date() }) {
  if (!Number.isFinite(requestedNaira) || requestedNaira <= 0) {
    return {
      eligible: false,
      limitNaira: 0,
      trailingValueNaira: 0,
      qualifyingOrders: 0,
      reason: 'requestedNaira must be a positive number',
    };
  }

  const cutoff = new Date(now.getTime() - TRAILING_WINDOW_DAYS * DAY_MS);

  const qualifying = settledOrders.filter((order) => {
    const at = order.settledAt instanceof Date ? order.settledAt : new Date(order.settledAt);
    return !Number.isNaN(at.getTime())
      && at >= cutoff
      && at <= now
      && Number.isFinite(order.totalNaira)
      && order.totalNaira > 0;
  });

  const trailingValueNaira = qualifying.reduce((sum, o) => sum + o.totalNaira, 0);

  if (qualifying.length < MIN_SETTLED_ORDERS) {
    return {
      eligible: false,
      limitNaira: 0,
      trailingValueNaira,
      qualifyingOrders: qualifying.length,
      reason: `at least ${MIN_SETTLED_ORDERS} settled order in the last `
        + `${TRAILING_WINDOW_DAYS} days is required`,
    };
  }

  const limitNaira = Math.min(
    Math.floor(trailingValueNaira * ADVANCE_RATE),
    HARD_CAP_NAIRA,
  );

  if (requestedNaira > limitNaira) {
    return {
      eligible: false,
      limitNaira,
      trailingValueNaira,
      qualifyingOrders: qualifying.length,
      reason: `requested amount exceeds the available limit of ${limitNaira}`,
    };
  }

  return {
    eligible: true,
    limitNaira,
    trailingValueNaira,
    qualifyingOrders: qualifying.length,
    reason: 'approved',
  };
}
