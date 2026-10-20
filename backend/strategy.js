export const STRATEGY = Object.freeze({ name: 'Trend + momentum v1', fast: 5, slow: 20, rsi: 14, atr: 14, warmup: 21 });
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

// Only the supplied prefix is visible. There is no future price access here.
export function analyse(bars, hasPosition = false) {
  if (bars.length < STRATEGY.warmup) return { action: 'hold', reason: `Warming up: ${bars.length}/${STRATEGY.warmup} observations.`, indicators: null };
  const recent = bars.slice(-21);
  const closes = recent.map(b => b.close);
  const fast = mean(closes.slice(-5));
  const slow = mean(closes.slice(-20));
  const changes = closes.slice(-15).slice(1).map((value, i) => value - closes.slice(-15)[i]);
  const gains = mean(changes.map(d => Math.max(0, d)));
  const losses = mean(changes.map(d => Math.max(0, -d)));
  const rsi = gains === 0 && losses === 0 ? 50 : losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
  const ranges = recent.slice(-14).map((b, i) => Math.max(b.high - b.low, Math.abs(b.high - recent[recent.length - 15 + i].close), Math.abs(b.low - recent[recent.length - 15 + i].close)));
  const atr = mean(ranges);
  const trend = (fast - slow) / slow;
  const indicators = { fast, slow, rsi, atr, trend, close: closes.at(-1) };
  const summary = `SMA5 ${fast.toFixed(5)}, SMA20 ${slow.toFixed(5)}, RSI14 ${rsi.toFixed(1)}, ATR14 ${atr.toFixed(5)}.`;
  if (hasPosition && (fast < slow || rsi >= 75)) return { action: 'sell', reason: `${summary} Exit: ${fast < slow ? 'short trend fell below long trend' : 'momentum is overbought'}.`, indicators };
  if (!hasPosition && trend > 0.0002 && rsi >= 45 && rsi <= 70) return { action: 'buy', reason: `${summary} Entry: positive trend with moderate momentum.`, indicators };
  return { action: 'hold', reason: `${summary} ${hasPosition ? 'Keep the existing position; no exit signal.' : 'Entry conditions are not met; stay in cash.'}`, indicators };
}

export function validateBars(input) {
  if (!Array.isArray(input) || !input.length || input.length > 5000) throw new Error('Expected 1–5,000 market observations.');
  let previous = -Infinity;
  return input.map(row => {
    const time = Date.parse(row.time);
    if (!Number.isFinite(time) || time <= previous) throw new Error('Market timestamps must be valid, unique, and strictly increasing.');
    previous = time;
    const bar = { time: new Date(time).toISOString(), open: row.open, high: row.high, low: row.low, close: row.close };
    for (const key of ['open', 'high', 'low', 'close']) if (!Number.isFinite(bar[key]) || bar[key] <= 0) throw new Error('Market prices must be positive finite numbers.');
    if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.low > bar.high) throw new Error('Invalid OHLC price range.');
    return bar;
  });
}
