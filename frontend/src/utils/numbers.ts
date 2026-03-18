/**
 * Coerce any value to a finite number.
 * Returns 0 for NaN, Infinity, -Infinity, null, undefined, or non-numeric strings.
 */
export function safeNum(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/**
 * Sum an array of values, skipping malformed entries via safeNum.
 */
export function safeSum(values: unknown[]): number {
  return values.reduce<number>((acc, v) => acc + safeNum(v), 0);
}

/**
 * Calculate percentage change between two totals.
 * Returns 0 when previous is 0 or non-finite to avoid Infinity / NaN.
 */
export function percentChange(current: number, previous: number): number {
  if (!previous || !isFinite(previous)) return 0;
  const pct = ((current - previous) / previous) * 100;
  return isFinite(pct) ? pct : 0;
}
