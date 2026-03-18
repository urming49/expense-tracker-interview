import { describe, it, expect } from 'vitest';
import { safeNum, safeSum, percentChange } from '../src/utils/numbers';

// ── safeNum ───────────────────────────────────────────────────────────────────

describe('safeNum', () => {
  it('returns the number as-is for valid finite values', () => {
    expect(safeNum(42)).toBe(42);
    expect(safeNum(0)).toBe(0);
    expect(safeNum(-10)).toBe(-10);
    expect(safeNum(3.14)).toBe(3.14);
  });

  it('returns 0 for NaN', () => expect(safeNum(NaN)).toBe(0));
  it('returns 0 for Infinity', () => expect(safeNum(Infinity)).toBe(0));
  it('returns 0 for -Infinity', () => expect(safeNum(-Infinity)).toBe(0));
  it('returns 0 for null', () => expect(safeNum(null)).toBe(0));
  it('returns 0 for undefined', () => expect(safeNum(undefined)).toBe(0));
  it('returns 0 for empty string', () => expect(safeNum('')).toBe(0));
  it('returns 0 for non-numeric string', () => expect(safeNum('abc')).toBe(0));
  it('parses a numeric string', () => expect(safeNum('49.99')).toBe(49.99));
  it('returns 0 for object', () => expect(safeNum({})).toBe(0));
  it('returns 0 for array', () => expect(safeNum([])).toBe(0));
});

// ── safeSum ───────────────────────────────────────────────────────────────────

describe('safeSum', () => {
  it('sums valid numbers', () => expect(safeSum([10, 20, 30])).toBe(60));
  it('returns 0 for empty array', () => expect(safeSum([])).toBe(0));

  it('ignores NaN entries without corrupting the sum', () => {
    expect(safeSum([10, NaN, 20])).toBe(30);
  });

  it('ignores Infinity entries', () => {
    expect(safeSum([10, Infinity, 20])).toBe(30);
  });

  it('ignores null entries', () => {
    expect(safeSum([10, null, 20])).toBe(30);
  });

  it('ignores undefined entries', () => {
    expect(safeSum([10, undefined, 20])).toBe(30);
  });

  it('ignores string entries that are not numeric', () => {
    expect(safeSum([10, 'bad', 20])).toBe(30);
  });

  it('handles an array of all bad values', () => {
    expect(safeSum([NaN, null, undefined, 'x', Infinity])).toBe(0);
  });

  it('handles mixed valid and malformed values', () => {
    expect(safeSum([100, NaN, null, 50, Infinity, 25])).toBe(175);
  });
});

// ── percentChange ─────────────────────────────────────────────────────────────

describe('percentChange', () => {
  it('calculates positive change correctly', () => {
    expect(percentChange(120, 100)).toBeCloseTo(20);
  });

  it('calculates negative change correctly', () => {
    expect(percentChange(80, 100)).toBeCloseTo(-20);
  });

  it('returns 0 when previous is 0 (avoids division by zero)', () => {
    expect(percentChange(100, 0)).toBe(0);
  });

  it('returns 0 when previous is NaN', () => {
    expect(percentChange(100, NaN)).toBe(0);
  });

  it('returns 0 when previous is Infinity', () => {
    expect(percentChange(100, Infinity)).toBe(0);
  });

  it('returns 0 when both are 0', () => {
    expect(percentChange(0, 0)).toBe(0);
  });

  it('returns 0 when current is 0 and previous is positive', () => {
    expect(percentChange(0, 100)).toBeCloseTo(-100);
  });
});
