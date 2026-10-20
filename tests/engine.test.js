import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, allocate, advance, propose, withdraw, equity, pnl, unrealised, FX } from '../src/engine.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function funded() { const s = initialState(); allocate(s, 20000, 5, 0.005, true); return s; }

test('allocation isolates wallet funds and accounts for conversion costs', () => {
  const s = funded();
  assert.equal(s.wallet, 80000);
  assert.equal(s.conversionCosts, 100);
  near(s.cash, 19900 / FX);
  assert.equal(pnl(s), 0);
});
test('unsuitable, nonfinite, and overfunded allocations cannot alter the wallet', () => {
  for (const [amount, consent] of [[20000, false], [Infinity, true], [NaN, true], [100001, true], [-5, true]]) {
    const s = initialState();
    assert.throws(() => allocate(s, amount, 5, 0.005, consent));
    assert.deepEqual(s, initialState());
  }
});
test('invalid and oversized proposals leave cash and positions intact', () => {
  const s = funded();
  const cash = s.cash;
  for (const amount of [6, NaN, Infinity, -1]) assert.equal(propose(s, 'buy', amount), false);
  assert.equal(propose(s, 'invented'), false);
  assert.equal(s.cash, cash);
  assert.equal(s.units, 0);
});
test('replay includes hold, profitable close, loss, and independent stop', () => {
  const s = funded();
  advance(s);
  assert.ok(s.units > 0);
  assert.equal(s.trades.length, 1);
  near(pnl(s), s.realised + unrealised(s) - s.fees);
  advance(s);
  assert.equal(s.trades.length, 1);
  advance(s);
  assert.ok(s.realised > 0);
  assert.equal(s.units, 0);
  advance(s);
  advance(s);
  assert.equal(s.stopped, true);
  assert.equal(s.units, 0);
  assert.ok(pnl(s) < -s.invested * s.lossLimit);
  near(pnl(s), s.realised - s.fees);
  assert.equal(propose(s, 'buy'), false);
  assert.equal(s.trades.length, 4);
});
test('pause preserves positions and risk checks continue on the replay', () => {
  const s = funded();
  advance(s);
  s.paused = true;
  const units = s.units;
  assert.equal(propose(s, 'buy'), false);
  advance(s);
  assert.equal(s.units, units);
  advance(s); advance(s); advance(s);
  assert.equal(s.stopped, true);
  assert.equal(s.units, 0);
});
test('withdrawal closes an open position and reconciles wallet, FX charges and fees', () => {
  const s = funded();
  advance(s);
  const expectedGross = (equity(s) - 0.01) * FX;
  const returned = withdraw(s);
  near(returned, expectedGross * 0.995);
  near(s.wallet, 80000 + returned);
  near(s.wallet - 100000, (s.realised - s.fees) * FX - s.conversionCosts);
  assert.equal(s.cash, 0);
  assert.equal(s.units, 0);
  assert.throws(() => withdraw(s));
  assert.throws(() => allocate(s, 20000, 5, 0.005, true));
});
test('uninvested withdrawal charges only both conversion legs', () => {
  const s = funded();
  withdraw(s);
  near(s.wallet, 99800.5);
  near(s.conversionCosts, 199.5);
});
