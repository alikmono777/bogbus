import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatAmount, amountsMatch } from '../src/lib/money.js';

test('parseAmount rounds to 2 decimals', () => {
  assert.equal(parseAmount('25.505'), 25.51);
  assert.equal(parseAmount(25.5), 25.5);
  assert.equal(parseAmount('1'), 1);
});

test('parseAmount rejects invalid / negative', () => {
  assert.throws(() => parseAmount('abc'));
  assert.throws(() => parseAmount(-1));
  assert.throws(() => parseAmount(''));
});

test('formatAmount always has 2 decimals', () => {
  assert.equal(formatAmount(1), '1.00');
  assert.equal(formatAmount('25.5'), '25.50');
});

test('amountsMatch tolerates floating point noise', () => {
  assert.equal(amountsMatch(0.1 + 0.2, 0.3), true);
  assert.equal(amountsMatch(25.5, 25.5), true);
  assert.equal(amountsMatch(25.5, 25.51), false);
});
