import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { analyse, validateBars } from '../backend/strategy.js';
import { createAccount, consume, mark, liquidate, backtest } from '../backend/paper.js';
import { fetchMarket, importCSV } from '../backend/market.js';
import { BotService } from '../backend/service.js';
import { reviewEntry } from '../backend/ai.js';
import { createHandler } from '../server.js';

// Synthetic fixtures test mechanics only. They are never served as market data.
function fixture(count=150, start=Date.UTC(2025,0,1), interval=86400000) {
  return Array.from({length:count},(_,i)=>{
    const close=1.08+i*0.0002+Math.sin(i*1.4)*0.001;
    return {time:new Date(start+i*interval).toISOString(),open:close,high:close+0.0003,low:close-0.0003,close};
  });
}
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const source=(bars=fixture(),kind='reference')=>({provider:kind==='intraday'?'twelve':'frankfurter',name:'TEST ONLY',kind,interval:kind==='intraday'?'1min':'1day',fetchedAt:'2025-01-01T00:00:00Z',bars});
const csv=bars=>'time,open,high,low,close\n'+bars.map(b=>[b.time,b.open,b.high,b.low,b.close].join(',')).join('\n');
async function service(options={}) { const s=new BotService({file:null,market:async()=>source(),...options});await s.run('market',{provider:'frankfurter'});return s; }
const fund=s=>s.run('allocate',{amount:20000,consent:true,mode:'replay'});

test('indicator strategy requires warmup and gives data-grounded signals',()=>{
  const bars=fixture();
  assert.equal(analyse(bars.slice(0,20)).indicators,null);
  const result=analyse(bars.slice(0,21));
  assert.equal(result.action,'buy');
  assert.ok(result.indicators.rsi>45&&result.indicators.rsi<70);
  assert.match(result.reason,/SMA5/);
  assert.equal(analyse(fixture(21).map(b=>({...b,open:1,high:1,low:1,close:1}))).action,'hold');
});
test('market validator rejects duplicate, reversed, nonfinite and malformed prices',()=>{
  const bars=fixture(3);
  for(const bad of [[bars[0],bars[0]],bars.toReversed(),[{...bars[0],close:NaN}],[{...bars[0],low:3}], [{...bars[0],time:'no'}]])assert.throws(()=>validateBars(bad));
});
test('strategy signals queue on one observation and fill only the next',()=>{
  const bars=fixture(),a=createAccount(100);
  consume(a,bars.slice(0,21));
  assert.equal(a.trades.length,0);
  assert.equal(a.pending.action,'buy');
  consume(a,bars.slice(0,22));
  assert.equal(a.trades[0].time,bars[21].time);
  approx(a.trades[0].price,bars[21].open+a.config.spread/2+a.config.slippage);
  assert.ok(a.trades[0].notional<=40);
  assert.ok(a.cash>=0);
});
test('changing future data cannot change earlier fills',()=>{
  const bars=fixture(),other=structuredClone(bars);
  for(let i=40;i<other.length;i++)other[i]={...other[i],open:2,high:2.1,low:1.9,close:2};
  const a=createAccount(100),b=createAccount(100);
  for(let i=20;i<40;i++){consume(a,bars.slice(0,i+1));consume(b,other.slice(0,i+1));}
  assert.deepEqual(a.trades,b.trades);
  assert.deepEqual(a.curve,b.curve);
});
test('duplicate observations are idempotent',()=>{
  const a=createAccount(100),bars=fixture(22);
  consume(a,bars.slice(0,21));consume(a,bars);
  const snapshot=structuredClone(a);
  assert.equal(consume(a,bars),false);
  assert.deepEqual(a,snapshot);
});
test('stale or future data cannot execute pending live orders',()=>{
  const a=createAccount(100),bars=fixture(22,Date.UTC(2025,0,1),60000);
  consume(a,bars.slice(0,21));
  assert.throws(()=>consume(a,bars,{live:true,now:Date.parse(bars.at(-1).time)+600000}),/stale/);
  assert.equal(a.trades.length,0);
  assert.equal(a.pending,null);
  assert.throws(()=>consume(a,bars,{live:true,now:Date.parse(bars.at(-1).time)-1}),/future/);
});
test('paused strategy keeps positions but independent stops still close them',()=>{
  const bars=fixture(),a=createAccount(100);
  consume(a,bars.slice(0,21));consume(a,bars.slice(0,22));
  assert.ok(a.position);
  const previous=structuredClone(a.position);
  consume(a,bars.slice(0,23),{paused:true});
  assert.deepEqual(a.position,previous);
  const bad={time:bars[23].time,open:0.8,high:0.81,low:0.79,close:0.8};
  consume(a,[...bars.slice(0,23),bad],{paused:true});
  assert.equal(a.position,null);
  assert.equal(a.pending,null);
  assert.equal(a.stopped,true);
  assert.ok(a.maxDrawdown>=0.05);
});
test('daily order limit rejects an entry and leaves cash unchanged',()=>{
  const bars=fixture(22),a=createAccount(100,{maxOrdersPerDay:1});
  consume(a,bars.slice(0,21));
  a.day=bars[21].time.slice(0,10);a.dayStart=100;a.dayOrders=1;
  consume(a,bars);
  assert.equal(a.position,null);assert.equal(a.cash,100);
  assert.ok(a.events.some(e=>e.type==='rejected'));
});
test('historical candle touching both target and stop takes the conservative stop fill',()=>{
  const bars=fixture(22),a=createAccount(100);
  consume(a,bars.slice(0,21));
  const bar={...bars[21],high:1.2,low:1.0};
  consume(a,[...bars.slice(0,21),bar]);
  assert.equal(a.position,null);
  assert.equal(a.trades[1].reason,'Position stop');
  assert.ok(a.trades[1].netPnl<0);
});
test('liquidation reconciles realised P/L, spread, slippage and fees',()=>{
  const bars=fixture(22),a=createAccount(100);
  consume(a,bars.slice(0,21));consume(a,bars);
  liquidate(a,bars.at(-1).close,bars.at(-1).time);
  approx(a.cash-a.initial,a.realised-a.fees);
  approx(a.trades.at(-1).netPnl,a.cash-a.initial);
  assert.equal(a.position,null);
});
test('backtest uses chronological evaluation with earlier warmup and honest baselines',()=>{
  const bars=fixture(150),r=backtest(bars);
  assert.equal(r.evaluation.from,bars[105].time);
  assert.equal(r.evaluation.observations,45);
  assert.ok(r.evaluation.trades.every(t=>t.time>=bars[105].time));
  approx(r.evaluation.equity-r.evaluation.initial,r.evaluation.realised-r.evaluation.fees);
  assert.equal(r.evaluation.cashBaselinePct,0);
  assert.ok(Number.isFinite(r.evaluation.buyHoldPct));
  assert.equal(r.evaluation.position,null);
  assert.throws(()=>backtest(bars.slice(0,99)),/100/);
});
test('reference provider requests identified historical EUR/USD data',async()=>{
  let requested;
  const market=await fetchMarket('frankfurter',{now:Date.UTC(2025,6,1),fetcher:async url=>{requested=String(url);return {ok:true,json:async()=>fixture(40).map(b=>({date:b.time.slice(0,10),base:'EUR',quote:'USD',rate:b.close}))};}});
  assert.match(requested,/providers=ecb/);assert.equal(market.kind,'reference');assert.equal(market.bars.length,40);
  assert.equal(market.bars[0].high,market.bars[0].close);
});
test('provider errors do not manufacture fallback prices',async()=>{
  await assert.rejects(fetchMarket('frankfurter',{fetcher:async()=>{throw new Error('network');}}),/unreachable/);
  await assert.rejects(fetchMarket('twelve',{key:''}),/API_KEY/);
  await assert.rejects(fetchMarket('invalid'),/Choose/);
});
test('intraday adapter excludes incomplete candles and keeps credentials off returned metadata',async()=>{
  const now=Date.UTC(2025,0,1,1);
  const values=fixture(40,now-39*60000,60000).toReversed().map(b=>({datetime:b.time.slice(0,19).replace('T',' '),open:String(b.open),high:String(b.high),low:String(b.low),close:String(b.close)}));
  const market=await fetchMarket('twelve',{key:'test-secret',now,fetcher:async()=>({ok:true,json:async()=>({meta:{symbol:'EUR/USD',interval:'1min'},values})})});
  assert.equal(market.bars.length,39);
  assert.ok(Date.parse(market.bars.at(-1).time)+60000<=now);
  assert.equal(JSON.stringify(market).includes('test-secret'),false);
});
test('CSV imports require explicit timezone and valid OHLC',()=>{
  assert.equal(importCSV(csv(fixture(40))).length,40);
  assert.throws(()=>importCSV('date,close\n2025-01-01,1.2'),/header/);
  assert.throws(()=>importCSV('time,open,high,low,close\n2025-01-01,1,1,1,1'),/timezone/);
});
test('service allocation and withdrawal reconcile the virtual wallet',async()=>{
  const s=await service(); await fund(s);
  assert.equal(s.state.walletNGN,80000);
  await s.run('step');await s.run('step');
  const view=await s.run('withdraw');
  approx(view.walletNGN-100000,(view.account.realised-view.account.fees)*1600-view.conversionCostsNGN);
  assert.equal(view.funded,false);assert.equal(view.settled,true);
  await assert.rejects(s.run('withdraw'),/Allocate/);
});
test('serialized concurrent allocation cannot spend the same wallet twice',async()=>{
  const s=await service();
  const results=await Promise.allSettled([fund(s),fund(s)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(s.state.walletNGN,80000);
});
test('reference dataset cannot be used as forward paper prices',async()=>{
  const s=await service();
  await assert.rejects(s.run('allocate',{amount:20000,mode:'forward',consent:true}),/intraday provider/);
  assert.equal(s.state.walletNGN,100000);
});
test('provider failure halts automation and clears pending proposals',async()=>{
  let now=Date.UTC(2025,0,1,1),fail=false;
  const bars=fixture(40,now-40*60000,60000);
  const s=await service({now:()=>now,market:async()=>{if(fail)throw new Error('Provider offline');return source(bars,'intraday');}});
  await s.run('allocate',{amount:20000,mode:'forward',consent:true});
  await s.run('start');s.state.account.pending={action:'buy',atr:0.001};fail=true;
  await assert.rejects(s.run('step'),/offline/);
  assert.equal(s.state.running,false);assert.equal(s.state.account.pending,null);assert.equal(s.state.account.trades.length,0);
});
test('forward observation gap discards pending fills instead of replaying missed entries',async()=>{
  let now=Date.UTC(2025,0,1,1),bars=fixture(40,now-40*60000,60000);
  const s=await service({now:()=>now,market:async()=>source(bars,'intraday')});
  await s.run('allocate',{amount:20000,mode:'forward',consent:true});
  await s.run('start');s.state.account.pending={action:'buy',atr:0.001};
  now+=10*60000;bars=fixture(50,Date.UTC(2025,0,1,0,20),60000);
  await s.run('step');
  assert.equal(s.state.account.trades.length,0);
  assert.ok(s.state.account.events.some(e=>/gap detected/.test(e.message)));
});
test('a storage failure rolls back a paper command and halts automation',async()=>{
  const s=await service();await fund(s);
  const wallet=s.state.walletNGN;
  s.save=async()=>{throw new Error('disk failure');};
  await assert.rejects(s.run('start'),/persistence failed/);
  assert.equal(s.state.running,false);assert.equal(s.state.account.pending,null);assert.equal(s.state.walletNGN,wallet);
});
test('persistence restores accounting but pauses automation and clears pending orders',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'walletpilot-'));
  try{
    const file=join(directory,'state.json');
    const s=await service({file});await fund(s);await s.run('start');await s.run('step');
    assert.ok(s.state.account.pending);
    const loaded=new BotService({file});await loaded.init();
    assert.equal(loaded.state.walletNGN,80000);assert.equal(loaded.state.running,false);assert.equal(loaded.state.account.pending,null);
    const disk=JSON.parse(await readFile(file,'utf8'));assert.equal(disk.running,false);
    await writeFile(file,'broken json');
    await assert.rejects(new BotService({file}).init());
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('idle timer does not contact providers or create a spurious error',async()=>{
  const s=new BotService({file:null,market:async()=>{throw new Error('must not fetch');}});
  await s.run('autoTick');assert.equal(s.state.error,null);
});
test('optional AI review can veto but cannot change position sizes',async()=>{
  const s=await service({aiEnabled:true,reviewer:async()=>({verdict:'veto',reason:'Trend strength insufficient.'})});
  await fund(s);await s.run('step');
  assert.equal(s.state.account.pending,null);assert.equal(s.state.account.aiReview.verdict,'veto');
  await s.run('step');assert.equal(s.state.account.trades.length,0);
});
test('an AI allow verdict still passes through independent risk sizing',async()=>{
  const s=await service({aiEnabled:true,reviewer:async()=>({verdict:'allow',reason:'Indicators support review.',size:1000000})});
  await fund(s);await s.run('step');await s.run('step');
  assert.equal(s.state.account.trades.length,1);
  assert.ok(s.state.account.trades[0].notional<=s.state.account.initial*0.4);
  assert.ok(s.state.account.cash>=0);
});
test('AI unavailable blocks an entry without rolling back the observed market',async()=>{
  const s=await service({aiEnabled:true,reviewer:async()=>{throw new Error('AI offline');}});
  await fund(s);await s.run('step');
  assert.equal(s.state.cursor,21);assert.equal(s.state.account.pending,null);
  assert.equal(s.state.account.aiReview.status,'unavailable');
});
test('AI structured output is validated locally and incomplete/refused outputs block',async()=>{
  const options={key:'test-key',model:'test-model'};
  let body;
  const allowed=await reviewEntry({indicators:{rsi:55}},{...options,fetcher:async(url,init)=>{body=JSON.parse(init.body);return{ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"verdict":"allow","reason":"RSI is 55."}'}]}]})};}});
  assert.equal(allowed.verdict,'allow');assert.equal(body.text.format.strict,true);assert.equal(body.store,false);
  for(const output of [{status:'incomplete'}, {status:'completed',output:[{content:[{type:'refusal'}]}]}, {status:'completed',output:[{content:[{type:'output_text',text:'{"verdict":"allow","reason":"x","size":100000}'}]}]}]){
    await assert.rejects(reviewEntry({}, {...options,fetcher:async()=>({ok:true,json:async()=>output})}));
  }
});
async function api(handler,path,{method='GET',data,headers={}}={}) {
  const req=Readable.from(data===undefined?[]:[JSON.stringify(data)]);
  Object.assign(req,{url:path,method,headers:{host:'localhost:3000','content-type':'application/json',...headers}});
  const response={code:0,headers:null,writeHead(code,headers){this.code=code;this.headers=headers;return this;},end(body){this.body=body;return this;}};
  await handler(req,response);
  return response;
}
test('API enforces local host/origin and does not expose backend or environment files',async()=>{
  const s=await service(),handler=createHandler(s);
  assert.equal((await api(handler,'/api/status')).code,200);
  assert.equal((await api(handler,'/api/reset',{method:'POST',data:{},headers:{origin:'https://attacker.example'}})).code,403);
  assert.equal((await api(handler,'/api/status',{headers:{host:'attacker.example'}})).code,403);
  for(const path of ['/.env','/backend/service.js','/.runtime/walletpilot.json','/package.json'])assert.equal((await api(handler,path)).code,404);
  for(const path of ['/','/src/bot.js','/src/bot.css','/demo.html'])assert.equal((await api(handler,path)).code,200);
  assert.equal((await api(handler,'/api/allocate',{method:'POST',data:{amount:20000,mode:'replay',consent:true}})).code,200);
});
test('Railway HTTPS commands accept only the configured domain and origin',async()=>{
  const s=await service(),handler=createHandler(s,undefined,{publicOrigin:'https://walletpilot.up.railway.app'});
  const headers={host:'walletpilot.up.railway.app',origin:'https://walletpilot.up.railway.app'};
  assert.equal((await api(handler,'/api/status',{headers})).code,200);
  assert.equal((await api(handler,'/api/reset',{method:'POST',data:{},headers})).code,200);
  for(const origin of ['https://attacker.example','http://walletpilot.up.railway.app']){
    assert.equal((await api(handler,'/api/reset',{method:'POST',data:{},headers:{...headers,origin}})).code,403);
  }
  assert.equal((await api(handler,'/api/status',{headers:{host:'attacker.example'}})).code,403);
  assert.equal((await api(handler,'/health',{headers:{host:'healthcheck.railway.app'}})).code,200);
  assert.equal((await api(handler,'/.runtime/walletpilot.json',{headers})).code,404);
});
