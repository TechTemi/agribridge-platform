import { describe, it, expect } from 'vitest';
import {
  assessCreditEligibility, ADVANCE_RATE, HARD_CAP_NAIRA, TRAILING_WINDOW_DAYS,
} from '../../src/domain/credit.js';

const NOW = new Date('2025-10-13T05:20:00Z');   // Harvest Monday, 05:20
const daysBefore = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('assessCreditEligibility', () => {
  it('refuses a farmer with no settled trade', () => {
    const result = assessCreditEligibility({
      settledOrders: [], requestedNaira: 100_000, now: NOW,
    });

    expect(result.eligible).toBe(false);
    expect(result.limitNaira).toBe(0);
    expect(result.reason).toMatch(/settled order/);
  });

  it('advances up to the advance rate on trailing settled value', () => {
    const result = assessCreditEligibility({
      settledOrders: [{ totalNaira: 1_000_000, settledAt: daysBefore(30) }],
      requestedNaira: 400_000,
      now: NOW,
    });

    expect(result.eligible).toBe(true);
    expect(result.limitNaira).toBe(1_000_000 * ADVANCE_RATE);
    expect(result.trailingValueNaira).toBe(1_000_000);
    expect(result.qualifyingOrders).toBe(1);
  });

  it('rejects a request one naira above the limit', () => {
    const result = assessCreditEligibility({
      settledOrders: [{ totalNaira: 1_000_000, settledAt: daysBefore(30) }],
      requestedNaira: 400_001,
      now: NOW,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/exceeds the available limit/);
  });

  it('applies the partner bank hard cap regardless of trade volume', () => {
    const result = assessCreditEligibility({
      // 40% of this would be 40m, far above the cap.
      settledOrders: [{ totalNaira: 100_000_000, settledAt: daysBefore(10) }],
      requestedNaira: HARD_CAP_NAIRA,
      now: NOW,
    });

    expect(result.limitNaira).toBe(HARD_CAP_NAIRA);
    expect(result.eligible).toBe(true);
  });

  it('ignores orders settled outside the trailing window', () => {
    const result = assessCreditEligibility({
      settledOrders: [
        { totalNaira: 5_000_000, settledAt: daysBefore(TRAILING_WINDOW_DAYS + 1) },
        { totalNaira: 1_000_000, settledAt: daysBefore(30) },
      ],
      requestedNaira: 400_000,
      now: NOW,
    });

    expect(result.qualifyingOrders).toBe(1);
    expect(result.trailingValueNaira).toBe(1_000_000);
  });

  it('sums several qualifying orders', () => {
    const result = assessCreditEligibility({
      settledOrders: [
        { totalNaira: 600_000, settledAt: daysBefore(200) },
        { totalNaira: 400_000, settledAt: daysBefore(100) },
        { totalNaira: 500_000, settledAt: daysBefore(5) },
      ],
      requestedNaira: 600_000,
      now: NOW,
    });

    expect(result.trailingValueNaira).toBe(1_500_000);
    expect(result.limitNaira).toBe(600_000);
    expect(result.eligible).toBe(true);
  });

  it('discards future-dated and malformed records rather than trusting them', () => {
    const result = assessCreditEligibility({
      settledOrders: [
        { totalNaira: 1_000_000, settledAt: daysBefore(-5) },   // future
        { totalNaira: -50_000, settledAt: daysBefore(10) },     // negative
        { totalNaira: 900_000, settledAt: 'not-a-date' },       // unparseable
      ],
      requestedNaira: 10_000,
      now: NOW,
    });

    expect(result.qualifyingOrders).toBe(0);
    expect(result.eligible).toBe(false);
  });

  it('accepts ISO date strings as well as Date objects', () => {
    const result = assessCreditEligibility({
      settledOrders: [{ totalNaira: 1_000_000, settledAt: daysBefore(30).toISOString() }],
      requestedNaira: 100_000,
      now: NOW,
    });

    expect(result.eligible).toBe(true);
  });

  it.each([
    ['zero', 0],
    ['negative', -1000],
    ['non-numeric', 'a lot'],
  ])('rejects a %s request amount', (_label, requestedNaira) => {
    const result = assessCreditEligibility({
      settledOrders: [{ totalNaira: 1_000_000, settledAt: daysBefore(30) }],
      requestedNaira,
      now: NOW,
    });
    expect(result.eligible).toBe(false);
  });
});
