import { validateBars } from './strategy.js';

async function getJSON(url, fetcher) {
  let response;
  try { response = await fetcher(url, { signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('Market provider is unreachable. Check network access; no substitute prices were generated.'); }
  if (!response.ok) throw new Error(`Market provider returned HTTP ${response.status}. No new orders were placed.`);
  return response.json();
}

export async function fetchMarket(provider = 'frankfurter', { fetcher = fetch, key = process.env.TWELVE_DATA_API_KEY, now = Date.now() } = {}) {
  if (provider === 'frankfurter') {
    const to = new Date(now - 86400000).toISOString().slice(0, 10);
    const from = new Date(now - 550 * 86400000).toISOString().slice(0, 10);
    const url = `https://api.frankfurter.dev/v2/rates?base=EUR&quotes=USD&providers=ecb&from=${from}&to=${to}`;
    const rows = await getJSON(url, fetcher);
    if (!Array.isArray(rows) || rows.some(row => row.base !== 'EUR' || row.quote !== 'USD')) throw new Error('Unexpected reference-rate response.');
    const bars = validateBars(rows.map(row => ({ time: row.date + 'T00:00:00Z', open: row.rate, high: row.rate, low: row.rate, close: row.rate })).sort((a,b) => a.time.localeCompare(b.time)));
    return { provider, name: 'Frankfurter / ECB', kind: 'reference', interval: '1day', fetchedAt: new Date(now).toISOString(), sourceUrl: url, bars, note: 'Daily reference fixings, not executable quotes. Next-observation fills are research approximations; no intraday high/low data.' };
  }
  if (provider !== 'twelve') throw new Error('Choose frankfurter or twelve as the market provider.');
  if (!key) throw new Error('Set TWELVE_DATA_API_KEY on the server to connect intraday forex data.');
  const url = new URL('https://api.twelvedata.com/time_series');
  Object.entries({ symbol: 'EUR/USD', interval: '1min', outputsize: '500', timezone: 'UTC', apikey: key }).forEach(([name,value]) => url.searchParams.set(name,value));
  const result = await getJSON(url, fetcher);
  if (result.status === 'error' || !Array.isArray(result.values)) throw new Error('Intraday provider rejected the request. Check the server API key, plan, and rate limits.');
  if (result.meta?.symbol !== 'EUR/USD' || result.meta?.interval !== '1min') throw new Error('Provider returned an unexpected symbol or interval.');
  const bars = validateBars(result.values.map(row => ({ time: row.datetime.replace(' ', 'T') + 'Z', ...Object.fromEntries(['open','high','low','close'].map(k => [k, Number(row[k])])) })).filter(b => Date.parse(b.time) + 60000 <= now).sort((a,b) => a.time.localeCompare(b.time)));
  return { provider, name: 'Twelve Data', kind: 'intraday', interval: '1min', fetchedAt: new Date(now).toISOString(), sourceUrl: 'https://twelvedata.com/docs#time-series', bars, note: 'Completed one-minute candles. Feed entitlement/delay depends on provider plan. Paper fills use observed candle closes with assumed costs, not broker quotes.' };
}

export function importCSV(csv) {
  if (typeof csv !== 'string' || csv.length > 800000) throw new Error('CSV must be text under 800 KB.');
  const rows = csv.trim().split(/\r?\n/);
  const header = rows.shift()?.toLowerCase().trim();
  if (header !== 'time,open,high,low,close') throw new Error('CSV header must be time,open,high,low,close. Use ISO timestamps with a timezone.');
  return validateBars(rows.map(line => {
    const [time, ...values] = line.trim().split(',');
    if (values.length !== 4 || !/(Z|[+-]\d\d:\d\d)$/.test(time)) throw new Error('Each CSV row needs an ISO timestamp with timezone and four prices.');
    return { time, ...Object.fromEntries(['open','high','low','close'].map((key,i) => [key, Number(values[i])])) };
  }));
}
