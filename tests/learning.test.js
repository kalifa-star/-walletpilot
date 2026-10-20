import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { features, samples, fit, probability, trainExperiment, learnedDecision } from '../backend/learning.js';
import { configWith, createAccount, consume } from '../backend/paper.js';
import { blankResearch, archiveMarket, seriesKey, researchView, shadowView } from '../backend/research.js';
import { BotService } from '../backend/service.js';

// Explicit synthetic fixtures for algorithm/control verification, never production prices.
function bars(n=400,start=Date.UTC(2025,0,1),interval=86400000){
  return Array.from({length:n},(_,i)=>{
    const close=1.1+Math.sin(i/12)*0.03+Math.sin(i*1.7)*0.001+i*0.00001;
    return {time:new Date(start+i*interval).toISOString(),open:close,high:close+0.0004,low:close-0.0004,close};
  });
}
const market=(data=bars(),provider='frankfurter')=>({name:'TEST FIXTURE ONLY',provider,kind:provider==='twelve'?'intraday':'reference',interval:provider==='twelve'?'1min':'1day',fetchedAt:new Date().toISOString(),bars:data});
async function service(options={}){
  const s=new BotService({file:null,market:async()=>market(),...options});await s.run('market',{provider:'frankfurter'});return s;
}
const train=s=>s.run('train',{amount:20000});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
let cached;
function experiment(){return cached ||= trainExperiment(bars(),{capital:12.4375,source:{key:'test',provider:'frankfurter',kind:'reference',interval:'1day'}});}

test('feature extraction sees only supplied past observations and has finite dimensions',()=>{
  assert.equal(features(bars(20)),null);
  const input=bars();const x=features(input.slice(0,21));
  assert.equal(x.length,7);assert.ok(x.every(Number.isFinite));
  input[300].close=500;
  assert.deepEqual(features(input.slice(0,21)),x);
});
test('labels include round-trip costs and never reach beyond their segment',()=>{
  const input=bars(),config=configWith();
  const rows=samples(input,20,240,12.4375,config);
  assert.ok(rows.every(r=>r.labelThrough<input[240].time));
  const last=rows.at(-1);assert.equal(last.labelThrough,input[239].time);
  const expensive=samples(input,20,240,12.4375,configWith({fee:10}));
  assert.ok(expensive.every(r=>r.y===0));
});
test('normalization is learned from training rows alone and fit is reproducible',()=>{
  const rows=samples(bars(),20,240,12.4375,configWith());
  const a=fit(rows),b=fit(rows);
  assert.deepEqual(a,b);
  near(a.means[0],rows.reduce((sum,r)=>sum+r.x[0],0)/rows.length);
  const p=probability(a,rows[0].x);assert.ok(p>0&&p<1);
  assert.throws(()=>probability(a,[NaN]),/features/);
});
test('insufficient data and single-class labels cannot create a candidate',()=>{
  assert.throws(()=>trainExperiment(bars(299)),/300/);
  assert.throws(()=>fit(Array.from({length:120},()=>({x:[0,0,0,0,0,0,0],y:0}))),/both/);
});
test('training, validation, and test have purged chronological label boundaries',()=>{
  const m=experiment();
  assert.ok(m.sampleAudit.trainLabelThrough<m.sampleAudit.validationFirst);
  assert.ok(m.sampleAudit.validationLabelThrough<m.sampleAudit.testFirst);
  assert.equal(m.split.trainEnd,240);assert.equal(m.split.validationEnd,320);
  assert.ok(m.metrics.train.samples>=100);assert.ok(m.metrics.test.samples>=40);
});
test('changing test outcomes cannot change fitted parameters or selected threshold',()=>{
  const a=experiment(),changed=bars();
  for(let i=320;i<changed.length;i++){
    const close=changed[i].close*0.8;
    changed[i]={...changed[i],open:close,high:close+0.0004,low:close-0.0004,close};
  }
  const b=trainExperiment(changed,{capital:a.capital,source:a.source});
  assert.deepEqual(a.parameters,b.parameters);assert.equal(a.threshold,b.threshold);
  assert.deepEqual(a.thresholdTrials,b.thresholdTrials);
  assert.notEqual(a.datasetHash,b.datasetHash);
});
test('trained decisions reject in-sample inference and forward reuse of the test period',()=>{
  const m=experiment(),input=bars();
  const inside=learnedDecision(m,input.slice(0,300));
  assert.equal(inside.action,'hold');assert.match(inside.reason,/restricted/);
  const test=learnedDecision(m,input.slice(0,350));assert.ok(Number.isFinite(test.probability));
  const forward=learnedDecision(m,input.slice(0,350),false,null,{forward:true});
  assert.equal(forward.action,'hold');assert.equal(forward.probability,undefined);
});
test('all model and rule comparisons use the same capital, costs and test period',()=>{
  const m=experiment(),e=m.evaluation,b=m.rulesBaseline;
  assert.equal(e.initial,b.initial);assert.equal(e.from,b.from);assert.equal(e.to,b.to);
  near(e.netPnl,e.realised-e.fees);assert.equal(e.position,null);
  assert.equal(e.pending,null);
  assert.ok(m.gate.checks.some(c=>c.key==='minimumTrades'));
  assert.equal(m.gate.passed,m.gate.checks.every(c=>c.passed));
});
test('a learned signal cannot bypass independent position and cash limits',()=>{
  const input=bars(),m=structuredClone(experiment());m.threshold=0;
  const a=createAccount(m.capital,m.config);
  for(let i=320;i<340;i++)consume(a,input.slice(0,i+1),{decide:(h,p,account)=>learnedDecision(m,h,p,account)});
  assert.ok(a.trades.some(t=>t.side==='BUY'));
  assert.ok(a.cash>=0);
  assert.ok(a.trades.filter(t=>t.side==='BUY').every(t=>t.notional<=m.capital));
});
test('out-of-distribution features make the learned strategy abstain',()=>{
  const model=experiment(),input=bars(350);
  input[349]={...input[349],open:5,high:5.1,low:4.9,close:5};
  const decision=learnedDecision(model,input);
  assert.equal(decision.action,'hold');assert.ok(decision.drift.length>0);
  assert.match(decision.reason,/abstained/);
});
test('archive merges duplicate times, records corrections, and separates source/interval',()=>{
  const r=blankResearch(),m=market(bars(40)),now='2026-01-01T00:00:00Z';
  archiveMarket(r,m,now);archiveMarket(r,m,now);
  assert.equal(r.datasets[seriesKey(m)].bars.length,40);
  const changed=structuredClone(m);changed.bars[0].high+=0.001;
  archiveMarket(r,changed,now);assert.equal(r.datasets[seriesKey(m)].revisions,1);
  archiveMarket(r,market(bars(40),'twelve'),now);
  assert.equal(Object.keys(r.datasets).length,2);
  assert.ok(researchView(r).datasets[0].analysis);
});
test('observer collects and analyses without funding or touching the wallet',async()=>{
  const s=new BotService({file:null,market:async()=>market()});
  await s.run('observerStart',{provider:'frankfurter'});
  assert.equal(s.state.account,null);assert.equal(s.state.walletNGN,100000);
  assert.equal(s.state.market,null);assert.equal(s.state.research.observer.enabled,true);
  assert.equal(Object.values(s.state.research.datasets)[0].bars.length,400);
  await s.run('observerStop');assert.equal(s.state.research.observer.enabled,false);
});
test('post-experiment monitoring records no hindsight predictions and waits for outcomes',()=>{
  const r=blankResearch(),initial=market(bars(400));
  const model=structuredClone(experiment());model.source.key=seriesKey(initial);r.models.push(model);
  archiveMarket(r,initial,'2026-03-01T00:00:00Z');
  assert.equal(model.shadow.length,0);
  // A batch with ten later observations produces just one newest prediction.
  archiveMarket(r,market(bars(410)),'2026-03-02T00:00:00Z');
  assert.equal(model.shadow.length,1);assert.equal(model.shadow[0].time,bars(410).at(-1).time);
  assert.equal(model.shadow[0].label,null);
  archiveMarket(r,market(bars(414)),'2026-03-03T00:00:00Z');
  assert.equal(model.shadow[0].label,null);
  archiveMarket(r,market(bars(415)),'2026-03-04T00:00:00Z');
  assert.notEqual(model.shadow[0].label,null);
  assert.equal(model.shadow[0].labelThrough,bars(415).at(-1).time);
  assert.equal(shadowView(model).resolved,1);
  assert.ok(Number.isFinite(shadowView(model).brier));
  const count=model.shadow.length;
  archiveMarket(r,market(bars(415)),'2026-03-04T01:00:00Z');assert.equal(model.shadow.length,count);
});
test('observer failure backs off and preserves the trading account and its pending signal',async()=>{
  let fail=false;
  const s=await service({market:async()=>{if(fail)throw new Error('Observation offline');return market();}});
  await s.run('allocate',{amount:20000,consent:true,mode:'replay'});
  s.state.running=true;s.state.account.pending={action:'buy',atr:0.001};
  fail=true;await assert.rejects(s.run('observerStart',{provider:'frankfurter'}),/offline/);
  assert.equal(s.state.running,true);assert.ok(s.state.account.pending);
  assert.equal(s.state.error,null);assert.match(s.state.research.observer.error,/offline/);
  assert.ok(s.state.research.observer.nextAttempt>Date.now());
});
test('training errors are isolated from a funded paper account',async()=>{
  const s=await service();await s.run('allocate',{amount:20000,consent:true,mode:'replay'});
  s.state.running=true;
  await assert.rejects(s.run('train',{datasetKey:'missing'}),/dataset/);
  assert.equal(s.state.running,true);assert.equal(s.state.walletNGN,80000);
  assert.ok(s.state.research.error);
});
test('model registry deduplicates repeated identical experiments',async()=>{
  const s=await service();await train(s);await train(s);
  assert.equal(s.state.research.models.length,1);
  assert.equal(s.state.research.activeModelId,null);
});
test('reset clears paper state but retains archived observations and model artifacts',async()=>{
  const s=await service();await train(s);
  const id=s.state.research.models[0].id;
  await s.run('allocate',{amount:20000,consent:true,mode:'replay'});
  await s.run('reset');
  assert.equal(s.state.walletNGN,100000);assert.equal(s.state.account,null);
  assert.equal(s.state.research.models[0].id,id);assert.equal(Object.keys(s.state.research.datasets).length,1);
});
test('candidate replay starts strictly after validation, with a pinned policy',async()=>{
  const s=await service();await train(s);const model=s.state.research.models[0];
  const input={amount:20000,consent:true,mode:'replay',strategy:'trained',modelId:model.id,config:model.config};
  await assert.rejects(s.run('allocate',{...input,amount:30000}),/match/);
  await s.run('allocate',input);
  assert.equal(s.state.cursor,model.split.validationEnd-1);
  const view=await s.run('step');
  assert.equal(view.account.modelId,model.id);
  assert.ok(view.analysis.probability>=0&&view.analysis.probability<=1);
  assert.equal(view.market.bars.at(-1).time,model.snapshot[model.split.validationEnd].time);
});
test('failed candidates and daily data cannot be promoted to forward paper',async()=>{
  const s=await service();await train(s);const model=s.state.research.models[0];
  model.gate.passed=false;
  await assert.rejects(s.run('promote',{modelId:model.id}),/screening/);
  s.state.research.models[0].gate.passed=true;
  await assert.rejects(s.run('promote',{modelId:model.id}),/intraday/);
  assert.equal(s.state.research.activeModelId,null);
});
test('forward paper requires explicit promotion, matching series, and new observations',async()=>{
  let now=Date.UTC(2025,0,2),data=bars(400,now-400*60000,60000);
  const s=await service({now:()=>now,market:async()=>market(data,'twelve')});await train(s);
  const model=s.state.research.models[0];
  // Inject a passed screen solely to exercise deployment controls, not profitability.
  model.gate.passed=true;
  const input={amount:20000,consent:true,mode:'forward',strategy:'trained',modelId:model.id,config:model.config};
  await assert.rejects(s.run('allocate',input),/promoted/);
  await s.run('promote',{modelId:model.id});
  await assert.rejects(s.run('allocate',input),/genuinely new/);
  now+=60000;data=bars(401,Date.UTC(2025,0,2)-400*60000,60000);
  await s.run('market',{provider:'twelve'});await s.run('allocate',input);
  assert.equal(s.state.account.strategy,'trained');assert.equal(s.state.research.activeModelId,model.id);
  await assert.rejects(s.run('promote',{modelId:model.id}),/Withdraw/);
});
test('scheduled retraining creates candidates only after enough new observations',async()=>{
  let data=bars(350);
  const s=new BotService({file:null,market:async()=>market(data)});
  await s.run('observerStart',{provider:'frankfurter',retrain:true});
  assert.equal(s.state.research.models.length,1);
  const first=s.state.research.models[0].id;
  data=bars(399);await s.run('observerRefresh');assert.equal(s.state.research.models.length,1);
  data=bars(400);await s.run('observerRefresh');assert.equal(s.state.research.models.length,2);
  assert.equal(s.state.research.models[0].id,first);assert.equal(s.state.research.activeModelId,null);
});
test('restart retains observer and trained artifacts while pausing trading',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'walletpilot-learning-'));
  try{
    const file=join(dir,'state.json'),s=await service({file});await train(s);
    await s.run('observerStart',{provider:'frankfurter'});
    await s.run('allocate',{amount:20000,consent:true,mode:'replay'});await s.run('start');
    const loaded=new BotService({file});await loaded.init();
    assert.equal(loaded.state.running,false);assert.equal(loaded.state.research.observer.enabled,true);
    assert.equal(loaded.state.research.models[0].id,s.state.research.models[0].id);
    assert.equal(loaded.state.walletNGN,80000);
    const disk=JSON.parse(await readFile(file,'utf8'));assert.equal(disk.running,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('old account state migrates into an archive without losing balances or trades',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'walletpilot-migration-'));
  try{
    const original=await service();await original.run('allocate',{amount:20000,consent:true,mode:'replay'});
    delete original.state.research;
    const file=join(dir,'state.json');await writeFile(file,JSON.stringify(original.state));
    const loaded=new BotService({file});await loaded.init();
    assert.equal(loaded.state.walletNGN,80000);assert.equal(loaded.state.account.initial,12.4375);
    assert.equal(Object.values(loaded.state.research.datasets)[0].bars.length,400);
  }finally{await rm(dir,{recursive:true,force:true});}
});
