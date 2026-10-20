import { analyse } from './strategy.js';

export const DEFAULT_CONFIG = Object.freeze({ maxPositionPct: 0.4, riskPerTradePct: 0.01, maxDrawdownPct: 0.05, dailyLossPct: 0.02, stopATR: 2, takeProfitR: 2, maxOrdersPerDay: 10, spread: 0.0001, slippage: 0.00002, fee: 0.01 });
export function configWith(input = {}) {
  const limits = { maxPositionPct: [0.01,1], riskPerTradePct: [0.001,0.02], maxDrawdownPct: [0.005,0.2], dailyLossPct: [0.005,0.1], stopATR: [1,5], takeProfitR: [1,5], maxOrdersPerDay: [1,100], spread: [0,0.01], slippage: [0,0.01], fee: [0,10] };
  for (const key of Object.keys(input)) if (!Object.hasOwn(limits,key)) throw new Error(`Unknown risk setting: ${key}`);
  const config = { ...DEFAULT_CONFIG, ...input };
  for (const [key,[min,max]] of Object.entries(limits)) if (!Number.isFinite(config[key]) || config[key] < min || config[key] > max) throw new Error(`Invalid ${key}; allowed range ${min}–${max}.`);
  if (!Number.isInteger(config.maxOrdersPerDay)) throw new Error('Daily order limit must be an integer.');
  return config;
}
export function createAccount(capital = 100, config = {}) {
  if (!Number.isFinite(capital) || capital < 5 || capital > 1000000) throw new Error('Paper capital must be $5–$1,000,000.');
  return { initial: capital, cash: capital, position: null, realised: 0, fees: 0, peak: capital, maxDrawdown: 0, stopped: false, day: null, dayStart: capital, dayBlocked: false, dayOrders: 0, pending: null, lastTime: null, trades: [], events: [], curve: [], config: configWith(config), decision: null };
}
export function mark(account, mid) {
  return account.cash + (account.position ? account.position.units * (mid - account.config.spread / 2 - account.config.slippage) : 0);
}
export function event(account, type, message, time = new Date().toISOString()) {
  account.events.unshift({ time, type, message });
  account.events = account.events.slice(0,200);
}
function buy(account, mid, atr, time) {
  const c = account.config;
  const value = mark(account, mid);
  const entry = mid + c.spread / 2 + c.slippage;
  const stopDistance = Math.max(atr * c.stopATR, mid * 0.002);
  const budget = Math.min(value * c.maxPositionPct, Math.max(0, account.cash - c.fee * 2));
  const units = Math.min(budget / entry, Math.max(0, value * c.riskPerTradePct - 2 * c.fee) / (stopDistance + c.spread + 2 * c.slippage));
  const notional = units * entry;
  if (account.stopped || account.dayBlocked || account.position || account.dayOrders >= c.maxOrdersPerDay || units <= 0 || notional < 1 || notional + c.fee > account.cash) {
    event(account, 'rejected', 'Entry rejected: risk budget, position, cash, daily loss, or order limit.', time); return;
  }
  account.cash -= notional + c.fee;
  account.fees += c.fee;
  account.position = { units, entry, stop: entry - stopDistance, target: entry + stopDistance * c.takeProfitR, openedAt: time };
  account.dayOrders++;
  account.trades.push({ side: 'BUY', time, price: entry, units, notional, fee: c.fee, netPnl: null });
  event(account, 'filled', `Bought €${units.toFixed(4)} at ${entry.toFixed(5)}; stop ${account.position.stop.toFixed(5)}, target ${account.position.target.toFixed(5)}.`, time);
}
export function liquidate(account, mid, time, reason = 'Withdrawal') {
  if (!account.position) return;
  const c = account.config;
  const fill = mid - c.spread / 2 - c.slippage;
  const { units, entry } = account.position;
  const gross = units * (fill - entry);
  account.cash += units * fill - c.fee;
  account.realised += gross;
  account.fees += c.fee;
  account.dayOrders++;
  account.trades.push({ side: 'SELL', time, price: fill, units, notional: units * fill, fee: c.fee, netPnl: gross - 2 * c.fee, reason });
  account.position = null;
  event(account, 'filled', `${reason}: sold at ${fill.toFixed(5)}; net trade P/L $${(gross - 2*c.fee).toFixed(4)}.`, time);
}
export function consume(account, history, { paused = false, live = false, now = Date.now(), decide = analyse } = {}) {
  const bar = history.at(-1);
  if (!bar) throw new Error('No market observation available.');
  if (account.lastTime && bar.time <= account.lastTime) return false;
  if (live && (now - (Date.parse(bar.time) + 60000) > 180000 || Date.parse(bar.time) + 60000 > now)) {
    account.pending = null;
    throw new Error('Market data is stale or future-dated. No new orders placed; existing positions remain open.');
  }
  // Historical signals execute on the next observation, never on the signal bar.
  // Forward paper uses the next newly observed completed close, not an old open.
  const fillMid = live ? bar.close : bar.open;
  const day = bar.time.slice(0,10);
  if (account.day !== day) { account.day = day; account.dayStart = mark(account, fillMid); account.dayOrders = 0; account.dayBlocked = false; }
  account.lastTime = bar.time;
  const c = account.config;
  const checkRisk = (mid) => {
    const value = mark(account, mid);
    const dailyLoss = (account.dayStart - value) / account.dayStart;
    const drawdown = (account.peak - value) / account.peak;
    account.maxDrawdown = Math.max(account.maxDrawdown, drawdown);
    if (drawdown >= c.maxDrawdownPct || dailyLoss >= c.dailyLossPct) {
      const reason = drawdown >= c.maxDrawdownPct ? 'Account drawdown limit' : 'Daily loss limit';
      if (drawdown >= c.maxDrawdownPct) account.stopped = true;
      else account.dayBlocked = true;
      account.pending = null;
      liquidate(account, mid, bar.time, reason);
      event(account, 'risk', `${reason} reached; new entries blocked. Thresholds are not guaranteed loss caps.`, bar.time);
      return true;
    }
    return false;
  };
  checkRisk(fillMid);
  if (account.position && (fillMid <= account.position.stop || fillMid >= account.position.target)) {
    liquidate(account, fillMid, bar.time, fillMid <= account.position.stop ? 'Position stop' : 'Profit target');
    account.pending = null;
  }
  const pending = account.pending;
  account.pending = null;
  if (!paused && !account.stopped && !account.dayBlocked && pending) {
    if (pending.action === 'buy') buy(account, fillMid, pending.atr, bar.time);
    if (pending.action === 'sell') liquidate(account, fillMid, bar.time, 'Strategy exit');
  }
  // Conservative OHLC model: when stop and target both occur, stop wins.
  if (!live && account.position) {
    if (bar.low <= account.position.stop) liquidate(account, Math.min(bar.open, account.position.stop), bar.time, 'Position stop');
    else if (bar.high >= account.position.target) liquidate(account, Math.max(bar.open, account.position.target), bar.time, 'Profit target');
  }
  checkRisk(bar.close);
  const value = mark(account, bar.close);
  account.peak = Math.max(account.peak, value);
  account.maxDrawdown = Math.max(account.maxDrawdown, (account.peak - value) / account.peak);
  account.curve.push({ time: bar.time, equity: value, price: bar.close });
  account.curve = account.curve.slice(-5000);
  account.decision = decide(history, !!account.position, account);
  if (!paused && !account.stopped && !account.dayBlocked && account.decision.action !== 'hold') {
    account.pending = { action: account.decision.action, atr: account.decision.indicators.atr, signalTime: bar.time };
  }
  event(account, 'decision', `${account.decision.action.toUpperCase()}: ${account.decision.reason}${account.pending ? ' Queued for the next observation.' : ''}`, bar.time);
  return true;
}

export function accountView(account, mid) {
  const equity = mark(account, mid);
  const closed = account.trades.filter(t => t.side === 'SELL');
  return { ...account, equity, netPnl: equity - account.initial, returnPct: (equity / account.initial - 1) * 100, unrealised: account.position ? account.position.units * (mid - account.config.spread/2 - account.config.slippage - account.position.entry) : 0, closedTrades: closed.length, winRate: closed.length ? closed.filter(t => t.netPnl > 0).length / closed.length * 100 : null };
}

export function backtest(bars, capital = 100, config = {}) {
  if (bars.length < 100) throw new Error('Backtesting requires at least 100 observations for a chronological 70/30 split.');
  const split = Math.floor(bars.length * 0.7);
  const run = (start, end) => {
    const account = createAccount(capital, config);
    for (let i = start; i < end; i++) consume(account, bars.slice(0,i+1));
    const last = bars[end-1];
    liquidate(account, last.close, last.time, 'End of test');
    if (account.curve.length) account.curve.at(-1).equity = account.cash;
    account.maxDrawdown = Math.max(account.maxDrawdown, (account.peak - account.cash) / account.peak);
    const first = bars[start];
    const c = account.config;
    const units = Math.max(0,capital-c.fee) / (first.open+c.spread/2+c.slippage);
    const hold = units*(last.close-c.spread/2-c.slippage)-c.fee;
    return { ...accountView(account,last.close), from: first.time, to: last.time, observations: end-start, cashBaselinePct: 0, buyHoldPct: (hold/capital-1)*100 };
  };
  return { strategy: 'Fixed SMA5/SMA20 + RSI14; ATR risk sizing', assumptions: 'Long-only, no leverage. Signals fill next observation open with assumed spread, slippage, and fees. OHLC stop-first rule. Final positions liquidated. Daily reference data cannot model intraday execution. No parameters are fitted to either segment; evaluation segment was reserved chronologically, not independently validated.', research: run(21,split), evaluation: run(split,bars.length) };
}
