/**
 * Pricing rules for AgriBridge produce lots.
 *
 * Pure functions only - no database, no clock, no I/O. That is deliberate:
 * this is the business logic that the unit tests in test/unit cover, and the
 * coverage gate in the pipeline depends on it being testable in isolation.
 */

/**
 * Moisture grade determines how much of the asking price a lot actually
 * realises. Grain that has been sitting in the open loses grade, which is
 * exactly why an outage during harvest costs a farmer real money.
 */
export const MOISTURE_MULTIPLIER = Object.freeze({
  A: 1.0,   // 13% moisture or below - premium, mill-ready
  B: 0.93,  // 13.1% to 15% - requires drying
  C: 0.85,  // 15.1% to 17% - discounted, drying plus storage risk
});

export const VALID_MOISTURE_GRADES = Object.freeze(Object.keys(MOISTURE_MULTIPLIER));

/** AgriBridge takes 2.5% of the graded value from the farmer payout. */
export const PLATFORM_FEE_RATE = 0.025;

export const MIN_TONNAGE = 0.5;
export const MAX_TONNAGE = 5000;

export class PricingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PricingError';
    this.statusCode = 400;
  }
}

/**
 * Work out what a buyer pays and what a farmer receives for a given quantity.
 *
 * @param {object} input
 * @param {number} input.tonnage           tonnes being purchased
 * @param {number} input.pricePerTonneNaira asking price per tonne, in naira
 * @param {string} input.moistureGrade     one of A, B, C
 * @returns {{grossNaira:number, gradeMultiplier:number, totalNaira:number,
 *            platformFeeNaira:number, farmerPayoutNaira:number}}
 */
export function calculateOrderTotal({ tonnage, pricePerTonneNaira, moistureGrade }) {
  if (!Number.isFinite(tonnage) || tonnage < MIN_TONNAGE || tonnage > MAX_TONNAGE) {
    throw new PricingError(
      `tonnage must be a number between ${MIN_TONNAGE} and ${MAX_TONNAGE}`,
    );
  }
  if (!Number.isFinite(pricePerTonneNaira) || pricePerTonneNaira <= 0) {
    throw new PricingError('pricePerTonneNaira must be a positive number');
  }
  const gradeMultiplier = MOISTURE_MULTIPLIER[moistureGrade];
  if (gradeMultiplier === undefined) {
    throw new PricingError(
      `moistureGrade must be one of ${VALID_MOISTURE_GRADES.join(', ')}`,
    );
  }

  const grossNaira = Math.round(tonnage * pricePerTonneNaira);
  const totalNaira = Math.round(grossNaira * gradeMultiplier);
  const platformFeeNaira = Math.round(totalNaira * PLATFORM_FEE_RATE);

  return {
    grossNaira,
    gradeMultiplier,
    totalNaira,
    platformFeeNaira,
    farmerPayoutNaira: totalNaira - platformFeeNaira,
  };
}
