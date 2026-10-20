import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fetchMarket, importCSV } from './market.js';
import { analyse, STRATEGY } from './strategy.js';
import { createAccount, consume, liquidate, accountView, backtest, event, configWith } from './paper.js';
import { reviewEntry } from './ai.js';
import { blankResearch, archiveMarket, researchView, seriesKey } from './research.js';
import { trainExperiment, learnedDecision } from './learning.js';

export function blankState() {
  return { version: 1, walletNGN: 100000, allocationNGN: 0, conversionCostsNGN: 0, fx: 1600, market: null, account: null, funded: false, settled: false, mode: 'replay', cursor: 20, running: false, error: null, lastPoll: 0, report: null, research: blankResearch() };
}
export class BotService {
  constructor({ file = '.runtime/walletpilot.json', market = fetchMarket, now = () => Date.now(), reviewer = reviewEntry, aiEnabled = process.env.AI_REVIEW_ENABLED === 'true' } = {}) {
    this.file = file; this.fetchMarket = market; this.now = now; this.state = blankState(); this.queue = Promise.resolve(); this.nextPollAt = 0;
    this.reviewer = reviewer; this.aiEnabled = aiEnabled;
  }
  async init() {
    if (!this.file) return;
    try {
      const saved = JSON.parse(await readFile(this.file,'utf8'));
      if (saved.version !== 1 || !Number.isFinite(saved.walletNGN)) throw new Error('Incompatible paper-account state. Back up .runtime/walletpilot.json before resetting it.');
      this.state = saved; this.state.running = false;
      this.state.research ||= blankResearch();
      this.state.research.schedule ||= {enabled:false,watermarks:{},error:null};
      this.state.research.schedule.watermarks ||= {};
      if (saved.market) archiveMarket(this.state.research,saved.market,new Date(this.now()).toISOString());
      if (this.state.account) {
        this.state.account.pending = null;
        event(this.state.account, 'system', 'Server restarted: automation paused and pending proposal discarded. Existing position preserved.');
      }
      await this.save();
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async save() {
    if (!this.file) return;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file + '.tmp', JSON.stringify(this.state), { mode: 0o600 });
    await rename(this.file + '.tmp',this.file);
  }
  run(action, input = {}) {
    const task = this.queue.then(async () => {
      if (action === 'status') return this.view();
      if (action === 'observerTick' && (!this.state.research.observer.enabled || this.now() < this.state.research.observer.nextAttempt)) return this.view();
      if (action === 'autoTick' && (!this.state.funded || (!this.state.running && !(this.state.mode === 'forward' && this.state.account?.position)) || (this.state.mode === 'forward' && this.now() < this.nextPollAt))) return this.view();
      const before = structuredClone(this.state);
      try { await this.command(action,input); }
      catch (error) {
        this.state = before;
        if (action.startsWith('observer')) {
          const o=this.state.research.observer;
          o.error=error.message;o.lastAttempt=new Date(this.now()).toISOString();o.nextAttempt=this.now()+(o.provider==='twelve'?60000:3600000);
        } else if (['train','promote'].includes(action)) this.state.research.error=error.message;
        else if (this.state.account) {
          this.state.running = false; this.state.account.pending = null;
          event(this.state.account,'error',error.message);
        }
        if (!action.startsWith('observer') && !['train','promote'].includes(action)) this.state.error = error.message;
        await this.save(); throw error;
      }
      try { await this.save(); }
      catch {
        this.state = before; this.state.running = false;
        if (this.state.account) this.state.account.pending = null;
        this.state.error = 'Paper-account persistence failed. Automation halted.';
        throw new Error(this.state.error);
      }
      return this.view();
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async command(action, input) {
    const s = this.state;
    if (['observerStart','observerStop','observerTick','observerRefresh'].includes(action)) {
      const o=s.research.observer;
      if (action==='observerStop') {o.enabled=false;return;}
      if (action==='observerStart') {
        if (!['frankfurter','twelve'].includes(input.provider)) throw new Error('Choose a supported observation provider.');
        o.provider=input.provider;
        s.research.schedule.enabled=input.retrain===true;
      }
      if(action==='observerRefresh'&&!o.enabled&&input.provider){
        if(!['frankfurter','twelve'].includes(input.provider))throw new Error('Choose a supported observation provider.');
        o.provider=input.provider;
      }
      o.lastAttempt=new Date(this.now()).toISOString();
      o.nextAttempt=this.now()+(o.provider==='twelve'?60000:3600000);
      const market=await this.fetchMarket(o.provider);
      archiveMarket(s.research,market,new Date(this.now()).toISOString());
      o.lastSuccess=o.lastAttempt;o.error=null;
      if(action==='observerStart')o.enabled=true;
      await this.maybeRetrain(seriesKey(market));
      return;
    }
    if (action==='train') {
      const key=input.datasetKey||s.research.selectedDataset;
      const dataset=s.research.datasets[key];
      if(!dataset)throw new Error('Collect or import a historical dataset before training.');
      const amount=input.amount??(s.allocationNGN||20000);
      if(!Number.isFinite(amount)||amount<10000||amount>100000)throw new Error('Training allocation must be virtual ₦10,000–₦100,000.');
      if(s.research.models.length>=20)throw new Error('The local registry holds 20 experiments. Export/archive the research state before creating another registry.');
      const source={key:dataset.key,name:dataset.name,provider:dataset.provider,kind:dataset.kind,interval:dataset.interval,sourceUrl:dataset.sourceUrl};
      const artifact=trainExperiment(dataset.bars.slice(-5000),{capital:amount*0.995/s.fx,config:input.config||s.account?.config||{},source,trainedAt:new Date(this.now()).toISOString()});
      artifact.allocationNGN=amount;
      if(!s.research.models.some(m=>m.id===artifact.id))s.research.models.push(artifact);
      s.research.schedule.watermarks[key]=artifact.dataThrough;
      s.research.selectedDataset=key;s.research.error=null;return;
    }
    if(action==='promote') {
      const model=s.research.models.find(m=>m.id===input.modelId);
      if(!model?.gate.passed)throw new Error('Candidate did not pass the paper-deployment screening checks.');
      if(model.source.kind!=='intraday'||model.source.provider!=='twelve')throw new Error('Only an intraday-provider model can be promoted to forward paper trading. Daily/CSV models remain historical research.');
      if(s.funded)throw new Error('Withdraw the current paper account before changing the active model.');
      s.research.activeModelId=model.id;s.research.error=null;return;
    }
    if (action === 'market' || action === 'import') {
      if (s.funded || s.account) throw new Error('Reset the paper account before replacing its market dataset.');
      const market = action === 'market' ? await this.fetchMarket(input.provider) : { provider: 'csv', name: 'User-imported CSV (unverified provenance)', kind: 'historical', interval: 'imported', fetchedAt: new Date(this.now()).toISOString(), bars: importCSV(input.csv), note: 'User-supplied historical observations; provenance has not been independently verified.' };
      if (market.bars.length < 30) throw new Error('At least 30 valid market observations are needed.');
      archiveMarket(s.research,market,new Date(this.now()).toISOString());
      s.market = market; s.cursor = 20; s.report = null; s.error = null; return;
    }
    if (action === 'reset') { const research=s.research;this.state = blankState();this.state.research=research;return; }
    if (!s.market && !(action==='allocate'&&input.strategy==='trained'&&input.mode==='replay')) throw new Error('Connect a market-data provider or import a CSV first.');
    if (action === 'backtest') {
      s.report = backtest(s.market.bars, input.capital ?? 100, configWith(input.config || {}));
      s.error = null; return;
    }
    if (action === 'allocate') {
      if (s.account) throw new Error('Reset before allocating another paper account.');
      if (input.consent !== true) throw new Error('Confirm adult eligibility, ability to accept losses, and virtual-funds use.');
      const amount = input.amount;
      if (!Number.isFinite(amount) || amount < 10000 || amount > s.walletNGN) throw new Error('Allocate ₦10,000–₦100,000 of virtual funds.');
      if (!['replay','forward'].includes(input.mode)) throw new Error('Choose replay or forward paper trading.');
      const strategy=input.strategy||'rules';
      if(!['rules','trained'].includes(strategy))throw new Error('Choose rules or trained strategy.');
      let model;
      if(strategy==='trained') {
        model=s.research.models.find(m=>m.id===input.modelId);
        if(!model)throw new Error('Choose a trained model from the registry.');
        if(Math.abs(amount*0.995/s.fx-model.capital)>1e-8 || JSON.stringify(configWith(input.config||{}))!==JSON.stringify(model.config))throw new Error('Allocation and risk/cost settings must match this model experiment. Retrain for a different budget or policy.');
        if(input.mode==='replay') s.market={...model.source,provider:model.source.provider,name:model.source.name,bars:model.snapshot,interval:model.source.interval,fetchedAt:model.trainedAt,note:'Trained-model held-out research replay. Model parameters and threshold were selected before this segment. Replaying it does not make it fresh forward evidence.'};
        else {
          if(s.research.activeModelId!==model.id||!model.gate.passed)throw new Error('Forward paper requires the explicitly promoted, screened model.');
          if(seriesKey(s.market)!==model.source.key)throw new Error('The current feed does not match the model training series.');
          if(s.market.bars.at(-1).time<=model.dataThrough)throw new Error('Wait for genuinely new observations after the model experiment before forward paper trading.');
        }
      }
      if (input.mode === 'forward' && s.market.kind !== 'intraday') throw new Error('Forward paper trading requires the intraday provider. Daily reference rates and CSV imports support research replay only.');
      if (input.mode === 'forward') this.fresh(s.market.bars.at(-1));
      s.account = createAccount(amount * 0.995 / s.fx, input.config || {});
      s.walletNGN -= amount; s.allocationNGN = amount; s.conversionCostsNGN = amount * 0.005;
      s.mode = input.mode; s.funded = true; s.cursor = input.mode === 'forward' ? s.market.bars.length-1 : model?model.split.validationEnd-1:20;
      s.account.strategy=strategy;s.account.modelId=model?.id||null;
      s.account.lastTime = s.market.bars[s.cursor].time;
      s.account.decision = this.decide(s.market.bars.slice(0,s.cursor+1));
      event(s.account, 'system', `Allocated virtual ₦${amount}: $${s.account.initial.toFixed(4)} after conversion. Mode: ${s.mode}.`,s.market.bars[s.cursor].time);
      s.error = null; return;
    }
    if (action === 'autoTick') {
      if (!s.funded || (!s.running && !(s.mode === 'forward' && s.account?.position))) return;
      if (s.mode === 'forward' && this.now() - s.lastPoll < 60000) return;
      return this.tick();
    }
    if (!s.funded) throw new Error('Allocate virtual funds before controlling the bot.');
    if (action === 'start') {
      if (s.account.stopped) throw new Error('Drawdown stop is latched. Reset to start a new account.');
      if (s.mode === 'replay' && s.cursor >= s.market.bars.length-1) throw new Error('Replay is complete. Withdraw or reset.');
      if (s.mode === 'forward') {
        const market = await this.fetchMarket('twelve'); this.fresh(market.bars.at(-1));
        s.account.pending = null;
        archiveMarket(s.research,market,new Date(this.now()).toISOString());
        if (s.account.position) consume(s.account,market.bars,{paused:true,live:true,now:this.now(),decide:this.decide.bind(this)});
        s.market = market; s.cursor = market.bars.length-1; s.account.lastTime = market.bars.at(-1).time;
      }
      s.running = !s.account.stopped; s.error = null;
      event(s.account,'system',s.account.stopped?'Current market triggered a drawdown stop during resume; automation remains halted.':'Automation started. Decisions use calculated indicators; execution remains paper-only.'); return;
    }
    if (action === 'pause') {
      s.running = false; s.account.pending = null;
      event(s.account,'system','New strategy orders paused. Existing positions remain open; forward mode continues price/risk monitoring.'); return;
    }
    if (action === 'step') return this.tick(true);
    if (action === 'withdraw') {
      let bar = s.market.bars[s.cursor];
      if (s.mode === 'forward') {
        const market = await this.fetchMarket('twelve'); bar = market.bars.at(-1); this.fresh(bar);
        archiveMarket(s.research,market,new Date(this.now()).toISOString());
        s.market = market; s.cursor = market.bars.length-1;
      }
      liquidate(s.account,bar.close,bar.time,'Withdrawal'); s.account.pending = null;
      const gross = s.account.cash * s.fx;
      s.conversionCostsNGN += gross * 0.005; s.walletNGN += gross * 0.995;
      s.funded = false; s.settled = true; s.running = false;
      event(s.account,'system',`Returned virtual ₦${(gross*0.995).toFixed(2)} to the wallet after a ₦${(gross*0.005).toFixed(2)} conversion charge. USD account results below are a settled snapshot.`);
      s.error = null; return;
    }
    throw new Error('Unknown bot command.');
  }
  fresh(bar) {
    const age = this.now()-(Date.parse(bar.time)+60000);
    if (age > 180000 || age < 0) throw new Error('Intraday data is stale or future-dated. No orders placed; existing positions remain open.');
  }
  async tick(manual = false) {
    const s = this.state;
    if (s.mode === 'replay') {
      if (s.cursor >= s.market.bars.length-1) { s.running = false; return; }
      s.cursor++;
      consume(s.account,s.market.bars.slice(0,s.cursor+1), { paused: !s.running && !manual,decide:this.decide.bind(this) });
      if (s.cursor === s.market.bars.length-1) {
        s.running = false; s.account.pending = null;
        event(s.account,'system','Historical replay finished. Open positions remain marked; withdraw to close and settle.');
      }
    } else {
      this.nextPollAt = this.now() + 60000;
      s.lastPoll = this.now();
      const market = await this.fetchMarket('twelve');
      archiveMarket(s.research,market,new Date(this.now()).toISOString());
      const latest = market.bars.at(-1); this.fresh(latest);
      if (latest.time <= s.account.lastTime) return;
      if (Date.parse(latest.time)-Date.parse(s.account.lastTime) > 120000) {
        s.account.pending = null;
        event(s.account,'risk','Observation gap detected: pending proposal discarded. Monitoring resumes at the newest completed candle.',latest.time);
      }
      s.market = market; s.cursor = market.bars.length-1;
      consume(s.account,market.bars,{ paused: !s.running, live: true, now: this.now(),decide:this.decide.bind(this) });
    }
    if (s.account.stopped) s.running = false;
    await this.reviewPending();
    s.error = null;
  }
  async reviewPending() {
    const s = this.state, a = s.account;
    if (!this.aiEnabled || a.pending?.action !== 'buy') return;
    // Hard cap bounds optional API calls for a paper account; reset is explicit.
    if ((a.aiCalls || 0) >= 20) {
      a.pending = null;
      a.aiReview = { verdict:'veto', reason:'AI review limit of 20 calls per paper account reached.', status:'blocked' };
      event(a,'rejected',a.aiReview.reason); return;
    }
    a.aiCalls = (a.aiCalls || 0) + 1;
    try {
      const review = await this.reviewer({ pair:'EUR/USD', proposal:a.pending, indicators:a.decision.indicators, observations:s.market.bars.slice(Math.max(0,s.cursor-20),s.cursor+1), positionOpen:!!a.position });
      if (!review || !['allow','veto'].includes(review.verdict) || typeof review.reason !== 'string') throw new Error('Invalid AI review; entry blocked.');
      a.aiReview = { ...review, status:'completed', time:a.pending.signalTime };
      if (review.verdict !== 'allow') a.pending = null;
      event(a,'ai',`AI ${review.verdict}: ${review.reason}`,a.lastTime);
    } catch (error) {
      a.pending = null; a.aiReview = { verdict:'veto', status:'unavailable', reason:error.message };
      event(a,'rejected',error.message,a.lastTime);
    }
  }
  decide(history,hasPosition=false,account=this.state.account) {
    if(account?.strategy!=='trained')return analyse(history,hasPosition);
    const artifact=this.state.research.models.find(m=>m.id===account.modelId);
    if(!artifact)throw new Error('Pinned trained model is unavailable. No new orders allowed.');
    return learnedDecision(artifact,history,hasPosition,account,{forward:this.state.mode==='forward'});
  }
  async maybeRetrain(key) {
    const r=this.state.research,schedule=r.schedule,dataset=r.datasets[key];
    if(!schedule.enabled||dataset.bars.length<300)return;
    const prior=r.models.filter(m=>m.source.key===key).at(-1);
    const through=schedule.watermarks[key]||prior?.dataThrough;
    if(through&&dataset.bars.filter(b=>b.time>through).length<50)return;
    schedule.watermarks[key]=dataset.bars.at(-1).time;
    try {await this.command('train',{datasetKey:key});schedule.error=null;}
    catch(error){schedule.error=error.message;}
  }
  view() {
    const s = this.state;
    const bars = s.market ? s.market.bars.slice(0,s.account ? s.cursor+1 : s.market.bars.length) : [];
    const bar = bars.at(-1);
    return { walletNGN: s.walletNGN, allocationNGN: s.allocationNGN, conversionCostsNGN: s.conversionCostsNGN, fx: s.fx,
      mode: s.mode, running: s.running, funded: s.funded, settled: s.settled, error: s.error,
      market: s.market ? { ...s.market, bars: bars.slice(-160), totalBars: s.market.bars.length, cursor: s.cursor, latestAvailable: s.market.bars.at(-1).time } : null,
      account: s.account ? accountView(s.account,bar.close) : null,
      analysis: bar ? this.decide(bars,!!s.account?.position) : null, report: s.report, strategy: STRATEGY,research:researchView(s.research),
      capabilities: { intradayConfigured: !!process.env.TWELVE_DATA_API_KEY, realMoney: false, aiReviewEnabled: this.aiEnabled, modelConfigured: !!process.env.OPENAI_API_KEY && !!process.env.OPENAI_MODEL } };
  }
}
