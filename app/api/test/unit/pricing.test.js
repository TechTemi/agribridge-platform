import { describe, it, expect } from 'vitest';
import {
  calculateOrderTotal, PricingError, MOISTURE_MULTIPLIER, PLATFORM_FEE_RATE,
} from '../../src/domain/pricing.js';

describe('calculateOrderTotal', () => {
  it('prices a grade A lot at the full asking price', () => {
    const result = calculateOrderTotal({
      tonnage: 10, pricePerTonneNaira: 600_000, moistureGrade: 'A',
    });

    expect(result.grossNaira).toBe(6_000_000);
    expect(result.gradeMultiplier).toBe(1.0);
    expect(result.totalNaira).toBe(6_000_000);
  });

  it('discounts grade B and grade C against the asking price', () => {
    const base = { tonnage: 10, pricePerTonneNaira: 600_000 };

    const b = calculateOrderTotal({ ...base, moistureGrade: 'B' });
    const c = calculateOrderTotal({ ...base, moistureGrade: 'C' });

    expect(b.totalNaira).toBe(Math.round(6_000_000 * MOISTURE_MULTIPLIER.B));
    expect(c.totalNaira).toBe(Math.round(6_000_000 * MOISTURE_MULTIPLIER.C));
    // The whole point of moisture grading: waiting costs the farmer money.
    expect(c.totalNaira).toBeLessThan(b.totalNaira);
    expect(b.totalNaira).toBeLessThan(6_000_000);
  });

  it('splits the total into platform fee and farmer payout', () => {
    const result = calculateOrderTotal({
      tonnage: 20, pricePerTonneNaira: 500_000, moistureGrade: 'A',
    });

    expect(result.platformFeeNaira).toBe(Math.round(result.totalNaira * PLATFORM_FEE_RATE));
    expect(result.farmerPayoutNaira + result.platformFeeNaira).toBe(result.totalNaira);
    expect(result.farmerPayoutNaira).toBeGreaterThan(0);
  });

  it('returns whole naira, never fractions', () => {
    const result = calculateOrderTotal({
      tonnage: 3.33, pricePerTonneNaira: 617_777, moistureGrade: 'B',
    });

    expect(Number.isInteger(result.totalNaira)).toBe(true);
    expect(Number.isInteger(result.platformFeeNaira)).toBe(true);
    expect(Number.isInteger(result.farmerPayoutNaira)).toBe(true);
  });

  it('handles fractional tonnage proportionally', () => {
    const half = calculateOrderTotal({
      tonnage: 0.5, pricePerTonneNaira: 600_000, moistureGrade: 'A',
    });
    expect(half.totalNaira).toBe(300_000);
  });

  describe('input validation', () => {
    it.each([
      ['zero tonnage', { tonnage: 0, pricePerTonneNaira: 100, moistureGrade: 'A' }],
      ['negative tonnage', { tonnage: -5, pricePerTonneNaira: 100, moistureGrade: 'A' }],
      ['tonnage below the minimum', { tonnage: 0.1, pricePerTonneNaira: 100, moistureGrade: 'A' }],
      ['absurd tonnage', { tonnage: 999_999, pricePerTonneNaira: 100, moistureGrade: 'A' }],
      ['non-numeric tonnage', { tonnage: 'ten', pricePerTonneNaira: 100, moistureGrade: 'A' }],
      ['zero price', { tonnage: 5, pricePerTonneNaira: 0, moistureGrade: 'A' }],
      ['negative price', { tonnage: 5, pricePerTonneNaira: -100, moistureGrade: 'A' }],
      ['unknown grade', { tonnage: 5, pricePerTonneNaira: 100, moistureGrade: 'Z' }],
      ['missing grade', { tonnage: 5, pricePerTonneNaira: 100 }],
    ])('rejects %s', (_label, input) => {
      expect(() => calculateOrderTotal(input)).toThrow(PricingError);
    });

    it('reports a 400 status on the thrown error', () => {
      try {
        calculateOrderTotal({ tonnage: 0, pricePerTonneNaira: 1, moistureGrade: 'A' });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });
  });
});
