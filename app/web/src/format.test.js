import { describe, it, expect } from 'vitest';
import {
  formatNaira, formatTonnage, cropLabel, statusLabel, timeAgo,
} from './format.js';

describe('formatNaira', () => {
  it('adds thousands separators', () => {
    expect(formatNaira(6_000_000)).toBe('₦6,000,000');
  });

  it('abbreviates large sums in compact mode', () => {
    expect(formatNaira(2_100_000_000, { compact: true })).toBe('₦2.1bn');
    expect(formatNaira(6_000_000, { compact: true })).toBe('₦6.0m');
    expect(formatNaira(45_000, { compact: true })).toBe('₦45k');
  });

  it('falls back to zero for junk input', () => {
    expect(formatNaira(undefined)).toBe('₦0');
    expect(formatNaira('abc')).toBe('₦0');
    expect(formatNaira(null)).toBe('₦0');
  });
});

describe('formatTonnage', () => {
  it('drops the decimal on whole tonnages', () => {
    expect(formatTonnage(25)).toBe('25t');
  });

  it('keeps two decimals on partial tonnages', () => {
    expect(formatTonnage(25.5)).toBe('25.50t');
  });

  it('tolerates bad input', () => {
    expect(formatTonnage('x')).toBe('0t');
  });
});

describe('labels', () => {
  it('humanises crop keys', () => {
    expect(cropLabel('paddy_rice')).toBe('Paddy rice');
  });

  it('passes unknown values through unchanged', () => {
    expect(cropLabel('quinoa')).toBe('quinoa');
    expect(statusLabel('WEIRD')).toBe('WEIRD');
  });

  it('humanises order statuses', () => {
    expect(statusLabel('IN_TRANSIT')).toBe('In transit');
  });
});

describe('timeAgo', () => {
  const now = new Date('2025-10-13T12:00:00Z');

  it.each([
    ['just now', new Date('2025-10-13T11:59:30Z')],
    ['30m ago', new Date('2025-10-13T11:30:00Z')],
    ['7h ago', new Date('2025-10-13T05:00:00Z')],
    ['3d ago', new Date('2025-10-10T12:00:00Z')],
  ])('renders %s', (expected, input) => {
    expect(timeAgo(input, now)).toBe(expected);
  });

  it('falls back to a date for anything older than a month', () => {
    expect(timeAgo(new Date('2025-01-01T12:00:00Z'), now)).toMatch(/2025/);
  });

  it('returns an empty string for unparseable input', () => {
    expect(timeAgo('not a date', now)).toBe('');
  });
});
