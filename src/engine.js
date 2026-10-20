// Fictional, deterministic observations. No live or historical market-data claims.
export const replay = [
  { time: '09:00', price: 1.0800, action: 'buy', reason: 'The fictional trend signal turns positive. Propose a small EUR position.' },
  { time: '09:15', price: 1.0808, action: 'hold', reason: 'The position is positive, but the fictional exit signal has not changed.' },
  { time: '09:30', price: 1.0825, action: 'sell', reason: 'The fictional target has been reached. Propose closing the EUR position.' },
  { time: '09:45', price: 1.0820, action: 'buy', reason: 'A second fictional entry signal appears. Propose another limited position.' },
  { time: '10:00', price: 1.0600, action: 'hold', reason: 'An adverse price move triggers the independent loss-threshold check.' },
  { time: '10:15', price: 1.0610, action: 'hold', reason: 'The replay is complete. Review the loss, costs, and stopped strategy.' },
];
export const FX = 1600;
export const FEE = 0.01;
export const SPREAD = 0.0001;
export function initialState() {
  return { wallet: 100000, cash: 0, units: 0, entry: 0, invested: 0, realised: 0, fees: 0, conversionCosts: 0, step: -1, paused: false, stopped: false, funded: false, positionLimit: 5, lossLimit: 0.005, trades: [], events: [] };
}
export function price(s) { return replay[Math.max(0, s.step)].price; }
export function equity(s) { return s.cash + s.units * (price(s) - SPREAD / 2); }
export function pnl(s) { return equity(s) - s.invested; }
export function unrealised(s) { return s.units * (price(s) - SPREAD / 2 - s.entry); }
function log(s, message, kind = 'info') { s.events.unshift({ message, kind, time: s.step < 0 ? 'Setup' : replay[s.step].time }); }
export function allocate(s, amount, positionLimit, lossLimit, suitable) {
  if (!suitable) throw new Error('Confirm that you can accept losses and are using discretionary virtual funds.');
  if (s.funded || s.stopped) throw new Error('Reset the demo before making another allocation.');
  if (!Number.isFinite(amount) || amount < 5000 || amount > s.wallet) throw new Error('Allocate between ₦5,000 and your available wallet balance.');
  if (!Number.isFinite(positionLimit) || positionLimit < 1 || positionLimit > 10) throw new Error('Position limit must be between $1 and $10.');
  if (!Number.isFinite(lossLimit) || lossLimit < 0.001 || lossLimit > 0.10) throw new Error('Loss threshold must be between 0.1% and 10%.');
  const conversionFee = amount * 0.005;
  s.wallet -= amount;
  s.cash = (amount - conversionFee) / FX;
  s.invested = s.cash;
  s.conversionCosts = conversionFee;
  s.positionLimit = positionLimit;
  s.lossLimit = lossLimit;
  s.funded = true;
  log(s, `Allocated ₦${amount.toLocaleString()}; ₦${conversionFee.toFixed(2)} conversion charge.`, 'success');
}
export function propose(s, action, amount = s.positionLimit) {
  if (!s.funded) return reject(s, 'Allocate virtual funds first.');
  if (s.paused || s.stopped) return reject(s, 'New orders are blocked while the strategy is paused or stopped.');
  if (!['buy', 'sell', 'hold'].includes(action)) return reject(s, 'Invalid proposal action.');
  if (action === 'hold') { log(s, 'Hold: no new order placed.'); return true; }
  if (action === 'sell') {
    if (!s.units) return reject(s, 'There is no open position to close.');
    closePosition(s); return true;
  }
  if (!Number.isFinite(amount) || amount <= FEE || amount > s.positionLimit) return reject(s, 'Proposed order exceeds the position-size limit or has an invalid amount.');
  if (s.units) return reject(s, 'Only one open position is permitted in this demo.');
  if (amount + FEE > s.cash) return reject(s, 'Insufficient available cash, including the order fee.');
  s.entry = price(s) + SPREAD / 2;
  s.units = amount / s.entry;
  s.cash -= amount + FEE;
  s.fees += FEE;
  s.trades.unshift({ side: 'BUY', time: replay[Math.max(0, s.step)].time, price: s.entry, amount, result: null });
  log(s, `Buy approved: €${s.units.toFixed(4)} at $${s.entry.toFixed(5)}. Notional $${amount.toFixed(2)}; fee $${FEE.toFixed(2)}.`, 'success');
  return true;
}
function reject(s, message) { log(s, message, 'rejected'); return false; }
export function closePosition(s) {
  if (!s.units) return;
  const executionPrice = price(s) - SPREAD / 2;
  const proceeds = s.units * executionPrice;
  const result = proceeds - s.units * s.entry;
  s.cash += proceeds - FEE;
  s.realised += result;
  s.fees += FEE;
  s.trades.unshift({ side: 'SELL', time: replay[Math.max(0, s.step)].time, price: executionPrice, amount: proceeds, result });
  s.units = 0;
  s.entry = 0;
  log(s, `Sold at $${executionPrice.toFixed(5)}. Realised P/L $${result.toFixed(4)} before the $${FEE.toFixed(2)} closing fee; spread included.`);
}
export function advance(s) {
  if (!s.funded) return reject(s, 'Allocate virtual funds first.');
  if (s.step >= replay.length - 1) return false;
  s.step++;
  // Mark existing positions before considering a proposal; risk checks also run while paused.
  if (!s.stopped && pnl(s) <= -s.invested * s.lossLimit) {
    s.stopped = true;
    closePosition(s);
    log(s, 'Loss threshold reached: position closed and new orders stopped. Execution can exceed the threshold.', 'rejected');
    return true;
  }
  if (!s.paused && !s.stopped) propose(s, replay[s.step].action);
  else log(s, 'Replay advanced. New orders remain blocked.');
  return true;
}
export function withdraw(s) {
  if (!s.funded) throw new Error('There are no trading funds to withdraw.');
  closePosition(s);
  const gross = s.cash * FX;
  const charge = gross * 0.005;
  s.wallet += gross - charge;
  s.conversionCosts += charge;
  s.cash = 0;
  s.funded = false;
  s.stopped = true;
  log(s, `Returned ₦${(gross - charge).toFixed(2)} to the wallet after a ₦${charge.toFixed(2)} conversion charge.`, 'success');
  return gross - charge;
}
