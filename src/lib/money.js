/**
 * Money helpers. BOG works with decimal major units (e.g. 25.50 GEL). We keep
 * everything as numbers rounded to 2 decimals and compare with a small
 * tolerance to avoid floating point surprises.
 */

/** Parse a value into a 2-decimal number, throwing on invalid/negative input. */
export function parseAmount(value) {
  let n;
  if (typeof value === 'number') {
    n = value;
  } else {
    const s = String(value ?? '').trim();
    if (s === '') throw new Error('Invalid amount: empty');
    n = Number(s);
  }
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid amount: ${JSON.stringify(value)}`);
  }
  return Math.round(n * 100) / 100;
}

/** Format a number as a fixed 2-decimal string ("25.50"). */
export function formatAmount(value) {
  return parseAmount(value).toFixed(2);
}

/** True when two amounts are equal within one cent. */
export function amountsMatch(a, b, tolerance = 0.005) {
  return Math.abs(parseAmount(a) - parseAmount(b)) <= tolerance;
}
