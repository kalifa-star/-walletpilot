const $ = id => document.getElementById(id);
const text = (id,value) => { $(id).textContent = value; };
const money = (n,currency='USD') => new Intl.NumberFormat(currency==='NGN'?'en-NG':'en-US',{ style:'currency',currency }).format(n);
const pct = n => `${n>=0?'+':''}${n.toFixed(2)}%`;
const date = time => time ? new Date(time).toISOString().replace('T',' ').slice(0,16)+' UTC' : '—';
let state = null, busy = false, toastTimer;
let connected = false;
let selectedModelId='',selectedDatasetKey='',observerInitialized=false,trainingInitialized=false;
function toast(message) { text('toast',message); $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),5000); }
function showError(message) { $('error').hidden = !message; text('error',message || ''); }
async function request(path,input) {
  const response = await fetch(path,input===undefined ? { cache:'no-store' } : { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Server request failed.');
  return data;
}
async function act(path,input={},message) {
  if (busy) return;
  busy=true; render();
  try { state=await request(path,input); connected=true; showError(state.error); if(message)toast(message); }
  catch(error) { showError(error.message); try { state=await request('/api/status'); } catch {} }
  finally { busy=false; render(); }
}
function signed(id,n,format=money) {
  text(id,format===pct?pct(n):(n>0?'+':'')+format(n)); $(id).classList.toggle('negative',n<0); $(id).classList.toggle('positive',n>0);
}
function render() {
  text('connection',connected?'Local backend connected':'Backend disconnected');
  const s=state;
  const m=s?.market, a=s?.account, analysis=s?.analysis;
  const active=!!s?.funded;
  $('connect').disabled=busy||!!a;
  $('provider').disabled=busy||!!a;
  $('csv').disabled=busy||!!a;
  $('allocate').disabled=busy||(!m&&!s?.research?.models.length)||!!a;
  $('step').disabled=busy||!active||s?.running||(s?.mode==='replay'&&m.cursor>=m.totalBars-1);
  $('toggle').disabled=busy||!active||a?.stopped||(s?.mode==='replay'&&m.cursor>=m.totalBars-1);
  $('withdraw').disabled=busy||!active;
  $('backtest').disabled=busy||!m||m.totalBars<100;
  $('reset').disabled=busy;
  $('confirm-reset').disabled=busy;
  text('connect',busy?'Working…':'Connect market ↗');
  renderLearning(s);
  if(!s)return;
  text('wallet',money(s.walletNGN,'NGN'));
  text('equity-label',s.settled?'SETTLED ACCOUNT VALUE · USD':'TRADING EQUITY · USD');
  text('equity',a?money(a.equity):'—');
  text('capital',a?`${money(a.initial)} starting capital after conversion`:'Allocate virtual funds to begin');
  if(a){ signed('pnl',a.netPnl); text('return',`${pct(a.returnPct)} · conversion costs excluded`); }
  else {text('pnl','—'); text('return','After spread, slippage, and fees'); $('pnl').classList.remove('negative','positive');}
  text('drawdown',a?`${(a.maxDrawdown*100).toFixed(2)}%`:'—');
  text('drawdown-limit',`Account stop: ${((a?.config.maxDrawdownPct??0.05)*100).toFixed(1)}%`);
  text('feed-name',m?m.name:'No market feed connected');
  text('feed-detail',m?`${m.totalBars} observations · ${m.interval} · fetched ${date(m.fetchedAt)}`:'Choose a source to begin. No prices or results are fabricated.');
  $('feed-light').classList.toggle('active',!!m&&!s.error);
  text('price-source',m?`${m.name} · ${m.interval}`:'Waiting for market observations');
  const last=m?.bars.at(-1);
  text('price',last?last.close.toFixed(5):'—'); text('price-time',last?date(last.time):'No timestamp available');
  text('mode-tag',m?(active||a?(s.mode==='forward'?'FORWARD PAPER':'HISTORICAL REPLAY'):'HISTORICAL DATA'):'NO DATA');
  text('chart-label',m?.kind==='reference'?'DAILY REFERENCE RATE':'MARKET PRICE');
  text('data-window',m?`${date(m.bars[0].time).slice(0,10)} → ${date(last.time).slice(0,10)}`:'—');
  text('replay-progress',a&&s.mode==='replay'?`Observation ${m.cursor+1} / ${m.totalBars}`:m?`${m.bars.length} recent observations shown`:'No replay loaded');
  $('chart-empty').hidden=!!m;
  const status=s.settled?'Funds returned':a?.stopped?'Drawdown stop latched':a&&s.mode==='replay'&&m.cursor>=m.totalBars-1?'Replay complete':s.running?'Bot running':active?'Strategy paused':'Not funded';
  text('bot-status',status); $('bot-light').classList.toggle('active',s.running);
  text('bot-detail',s.error?'Check the feed/error message above.':active?(s.mode==='forward'?'Polling once per minute; paper fills only.':'Historical replay advances once per second.'):'Connect data, then set an allocation.');
  text('toggle',s.running?'Ⅱ Pause bot':'▶ Start bot');
  text('step',s.mode==='forward'?'Poll new candle ↗':'Single step →');
  const action=analysis?.action||'waiting';
  text('strategy-title',a?.strategy==='trained'?'Trained price classifier':'Trend + momentum v1');
  text('strategy-type',a?.strategy==='trained'?'TRAINED MODEL':'RULE BASED');
  text('signal',action.toUpperCase()); $('signal').classList.toggle('sell',action==='sell');
  text('pending',a?.pending?`${a.pending.action.toUpperCase()} queued · next observation`:'No queued order');
  text('explanation',(analysis?.reason||'The strategy calculates moving averages, momentum, and volatility from observed prices.')+(s.capabilities.aiReviewEnabled ? ` AI entry review enabled.${a?.aiReview ? ' Latest reviewer: '+a.aiReview.reason : ' No entry reviewed yet.'}` : a?.strategy==='trained'?' Optional language-model reviewer disabled.':' Rules-only mode; language-model reviewer disabled.'));
  const i=analysis?.indicators;
  text('sma-fast',i?i.fast.toFixed(5):'—'); text('sma-slow',i?i.slow.toFixed(5):'—'); text('rsi',i?i.rsi.toFixed(1):'—'); text('atr',i?i.atr.toFixed(5):'—');
  text('max-position',`${((a?.config.maxPositionPct??0.4)*100).toFixed(0)}% of equity`);
  text('risk-budget',`${((a?.config.riskPerTradePct??0.01)*100).toFixed(1)}% of equity`);
  text('risk-loss',`${((a?.config.dailyLossPct??0.02)*100).toFixed(1)}% / ${((a?.config.maxDrawdownPct??0.05)*100).toFixed(1)}%`);
  text('position',a?.position?`€${a.position.units.toFixed(4)} long`:'None');
  text('cash',a?money(a.cash)+(s.settled?' settled':''):'—');
  text('realised',a?`${money(a.realised)} / ${money(a.unrealised)}`:'—');
  text('stop-target',a?.position?`${a.position.stop.toFixed(5)} / ${a.position.target.toFixed(5)}`:'—');
  text('fees',a?money(a.fees):'—'); text('fx-cost',money(s.conversionCostsNGN,'NGN'));
  text('source-note',m?`${m.note} Data fetched ${date(m.fetchedAt)}. Costs assumed: spread ${a?.config.spread??0.0001}, slippage ${a?.config.slippage??0.00002} per side, fee ${money(a?.config.fee??0.01)} per order.`:'Market source and timestamps appear once connected.');
  text('event-count',`${a?.events.length??0} EVENTS`);
  renderEvents(a?.events||[]); renderOrders(a?.trades||[]);
  renderReport(s.report);
  drawPrices(m?.bars||[]); drawEquity(s.report?.evaluation.curve||[]);
}
function renderEvents(events) {
  const root=$('events');
  if(!events.length){root.innerHTML='<div class="empty-state">Decisions, fills, and rejected entries will appear here as observations arrive.</div>';return;}
  root.replaceChildren(...events.map(event=>{
    const row=document.createElement('div'); row.className=`event ${event.type}`;
    const label=document.createElement('span'); label.className='event-type'; label.textContent=event.type.toUpperCase();
    const body=document.createElement('div'); const p=document.createElement('p');p.textContent=event.message;
    const time=document.createElement('time');time.textContent=date(event.time);body.append(p,time);row.append(label,body);return row;
  }));
}
function fillOptions(id,entries,value,empty) {
  const select=$(id);
  const signature=JSON.stringify(entries);
  if(select.dataset.options!==signature){
    select.replaceChildren(...(entries.length?entries:[['',empty]]).map(([value,label])=>new Option(label,value)));
    select.dataset.options=signature;
  }
  if([...select.options].some(option=>option.value===value))select.value=value;
}
function currentModel(){return state?.research?.models.find(m=>m.id===selectedModelId)||state?.research?.models.at(-1);}
function renderLearning(s) {
  const r=s?.research,models=r?.models||[],datasets=r?.datasets||[],o=r?.observer;
  if(!selectedDatasetKey||!datasets.some(d=>d.key===selectedDatasetKey))selectedDatasetKey=r?.selectedDataset||datasets[0]?.key||'';
  if(!selectedModelId||!models.some(m=>m.id===selectedModelId))selectedModelId=models.at(-1)?.id||'';
  fillOptions('training-dataset',datasets.map(d=>[d.key,`${d.name} · ${d.count} observations · ${d.interval}`]),selectedDatasetKey,'Collect a dataset first');
  fillOptions('model-select',models.map(m=>[m.id,`${m.id.slice(0,10)} · ${m.gate.passed?'passes screen':'research only'} · ${money(m.capital)} · ${m.trainedAt.slice(0,16)}`]),selectedModelId,'No model trained');
  const d=datasets.find(d=>d.key===selectedDatasetKey),model=currentModel();
  $('train-model').disabled=busy||!d||d.count<300;
  $('training-dataset').disabled=busy||!datasets.length;
  $('training-amount').disabled=busy;
  $('model-select').disabled=busy||!models.length;
  $('observer-toggle').disabled=busy;
  $('observer-refresh').disabled=busy;
  $('observer-provider').disabled=busy||!!o?.enabled;
  $('observer-auto').disabled=busy||!!o?.enabled;
  $('replay-model').disabled=busy||!model||!!s?.account;
  $('promote-model').disabled=busy||!model?.gate.passed||model?.source.kind!=='intraday'||!!s?.funded||r?.activeModelId===model?.id;
  if(o&&!observerInitialized){$('observer-provider').value=o.provider;$('observer-auto').checked=r.schedule?.enabled||false;observerInitialized=true;}
  if(s&&!trainingInitialized){$('training-amount').value=s.allocationNGN||20000;trainingInitialized=true;}
  text('observer-toggle',o?.enabled?'Stop observing':'Start observing');
  text('observer-state',o?`${o.enabled?'OBSERVING':'STOPPED'} · ${o.provider==='twelve'?'minute':'hourly'} collection · last success ${date(o.lastSuccess)}${r.schedule?.enabled?' · candidate retraining enabled':''}`:'Observer stopped.');
  text('observer-analysis',d?.analysis?`Latest archived analysis (${d.to.slice(0,16)} UTC): ${d.analysis.reason}`:'No archived observations yet.');
  const observerError=o?.error||r?.schedule?.error;
  $('observer-error').hidden=!observerError;text('observer-error',observerError||'');
  $('training-error').hidden=!r?.error;text('training-error',r?.error||'');
  text('archive-count',datasets.length);
  if(datasets.length)$('archive-list').replaceChildren(...datasets.map(dataset=>{
    const item=document.createElement('div');item.className='archive-item';
    const body=document.createElement('div');body.textContent=dataset.name;
    const detail=document.createElement('small');detail.textContent=`${dataset.interval} · ${dataset.from.slice(0,10)} → ${dataset.to.slice(0,10)} · ${dataset.revisions} revisions${dataset.discarded?' · oldest observations pruned':''}`;body.append(detail);
    const count=document.createElement('span');count.textContent=`${dataset.count} bars`;item.append(body,count);return item;
  }));
  text('learning-status',models.length?`${models.length} SAVED MODEL${models.length===1?'':'S'}${r.activeModelId?' · PAPER MODEL PROMOTED':''}`:'NO MODEL TRAINED');
  text('train-model',busy?'Working…':'Train & evaluate →');
  $('model-result').hidden=!model;
  text('model-action-note',s?.account?'Reset the paper account before replaying another candidate. The archive and models will be preserved.':model?.source.kind!=='intraday'?'Daily/CSV models support historical research replay. Forward promotion requires a screened intraday-provider model.':'Forward paper requires an explicit promotion, matching feed, and genuinely new observations after the full experiment.');
  if(!model)return;
  text('model-id',`MODEL ${model.id.slice(0,16)} · LOGISTIC CLASSIFIER`);
  text('model-verdict',model.gate.passed?'Passed paper screening · still experimental':'Research candidate · screening not passed');
  text('model-source',`${model.source.name} · ${model.source.interval}`);
  signed('model-return',model.evaluation.returnPct,pct);
  text('model-baseline',`${pct(model.rulesBaseline.returnPct)} / 0.00%`);
  text('model-trades',model.evaluation.closedTrades);
  text('model-brier',`${model.metrics.test.brier.toFixed(3)} / ${model.metrics.test.baselineBrier.toFixed(3)}`);
  text('model-details',`Test ${model.evaluation.from.slice(0,10)} → ${model.evaluation.to.slice(0,10)} · ${money(model.capital)} capital · ${(model.threshold*100).toFixed(0)}% entry threshold · ${(model.evaluation.maxDrawdown*100).toFixed(2)}% max drawdown · ${money(model.evaluation.fees)} test fees. Labelled examples: ${model.metrics.train.samples} train / ${model.metrics.validation.samples} validation / ${model.metrics.test.samples} test. Parameters trained through ${model.trainedThrough.slice(0,10)}; threshold selected through ${model.selectionThrough.slice(0,10)}.`);
  text('shadow-status',model.shadow?.predictions?`POST-EXPERIMENT MONITORING · ${model.shadow.predictions} predictions / ${model.shadow.resolved} resolved outcomes${model.shadow.brier!==null?' · Brier '+model.shadow.brier.toFixed(3)+' / constant baseline '+model.shadow.baselineBrier.toFixed(3):''}. ${model.shadow.note}`:'POST-EXPERIMENT MONITORING · Waiting for genuinely later observations. The observer will record predictions and score their outcomes as future data arrives, without funding trades.');
  $('model-gates').replaceChildren(...model.gate.checks.map(check=>{
    const item=document.createElement('div');item.className=`gate-item${check.passed?' passed':''}`;
    const icon=document.createElement('span');icon.textContent=check.passed?'✓':'×';const label=document.createElement('div');label.textContent=check.description;item.append(icon,label);return item;
  }));
  text('model-caveat',`¹ Brier is prediction error; lower is better. Comparison uses the training-set positive rate. ${model.target} ${model.gate.note} Test rows overlap in their target horizon; these metrics do not establish statistical independence. The model does not learn by spending money.`);
}
function configureAllocation(){
  const form=$('allocate-form'),model=currentModel(),trained=$('allocation-strategy').value==='trained';
  const values=model?{amount:model.allocationNGN,position:model.config.maxPositionPct*100,risk:model.config.riskPerTradePct*100,drawdown:model.config.maxDrawdownPct*100,daily:model.config.dailyLossPct*100}:{};
  for(const name of ['amount','position','risk','drawdown','daily']){
    const input=form.elements.namedItem(name);input.readOnly=trained;
    if(trained&&model)input.value=values[name];
  }
  const forward=form.elements.namedItem('mode').querySelector('option[value="forward"]');
  forward.disabled=trained&&(!model||state?.research.activeModelId!==model.id);
  if(forward.disabled)form.elements.namedItem('mode').value='replay';
  text('allocation-model-note',trained?model?`Selected model ${model.id.slice(0,10)}. Budget and risk settings are pinned to its evaluation. Historical replay starts after validation.`:'Train/select a model first.':'Fixed indicator rules. You can edit the risk controls.');
}
function renderOrders(orders) {
  text('order-count',`${orders.length} ORDERS`);
  if(!orders.length){$('orders').innerHTML='<tr><td colspan="7" class="empty-state">No orders executed.</td></tr>';return;}
  $('orders').replaceChildren(...orders.slice(-100).reverse().map(order=>{
    const row=document.createElement('tr');
    [date(order.time),order.side,order.units.toFixed(4),order.price.toFixed(5),money(order.notional),money(order.fee),order.netPnl===null?'—':money(order.netPnl)].forEach((value,index)=>{
      const td=document.createElement('td');td.textContent=value;
      if(index===1)td.className=order.side.toLowerCase();
      if(index===6&&order.netPnl!==null)td.className=order.netPnl>=0?'positive':'negative';
      row.append(td);
    });return row;
  }));
}
function renderReport(report) {
  $('report').hidden=!report; $('report-empty').hidden=!!report;
  if(!report)return;
  const r=report.evaluation;
  text('report-period',`RESERVED EVALUATION · ${r.from.slice(0,10)} → ${r.to.slice(0,10)} · ${r.observations} observations`);
  signed('eval-return',r.returnPct,pct);
  text('hold-return',pct(r.buyHoldPct));
  text('report-stats',`${r.closedTrades} closed trades · ${r.winRate===null?'No win rate':r.winRate.toFixed(1)+'% win rate'} · ${(r.maxDrawdown*100).toFixed(2)}% max drawdown · ${money(r.fees)} fees. Earlier research segment: ${pct(report.research.returnPct)}. Test capital: ${money(r.initial)}.`);
  text('report-assumptions',report.assumptions+' USD cash baseline earns zero interest; conversion costs and financing are excluded. Repeated inspection makes this a research split, not independent proof.');
}
function canvas(id) {
  const element=$(id), rect=element.getBoundingClientRect();
  const ratio=window.devicePixelRatio||1;
  element.width=Math.max(1,Math.round(rect.width*ratio));element.height=Math.max(1,Math.round(rect.height*ratio));
  const ctx=element.getContext('2d');ctx.scale(ratio,ratio);
  return {ctx,w:rect.width,h:rect.height};
}
function drawPrices(bars) {
  const {ctx,w,h}=canvas('price-chart'); if(!w||!h)return;
  const pad={l:12,r:62,t:16,b:20}, width=w-pad.l-pad.r, height=h-pad.t-pad.b;
  const lows=bars.map(b=>b.low), highs=bars.map(b=>b.high);
  const lo=bars.length?Math.min(...lows)*0.9995:1, hi=bars.length?Math.max(...highs)*1.0005:1.01;
  const y=value=>pad.t+(hi-value)/(hi-lo)*height;
  ctx.font='8px monospace';ctx.textAlign='left';
  for(let i=0;i<5;i++){
    const level=pad.t+height*i/4;ctx.strokeStyle='#2a3626';ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(pad.l,level);ctx.lineTo(w-pad.r,level);ctx.stroke();ctx.setLineDash([]);
    if(bars.length){ctx.fillStyle='#71835f';ctx.fillText((hi-(hi-lo)*i/4).toFixed(4),w-pad.r+10,level+3);}
  }
  if(!bars.length)return;
  const x=i=>pad.l+(i+0.5)/bars.length*width;
  const bodyWidth=Math.max(1,Math.min(7,width/bars.length*0.65));
  bars.forEach((bar,i)=>{
    const up=bar.close>=bar.open;ctx.strokeStyle=ctx.fillStyle=up?'#a9cd7b':'#ba8069';
    ctx.beginPath();ctx.moveTo(x(i),y(bar.high));ctx.lineTo(x(i),y(bar.low));ctx.stroke();
    ctx.fillRect(x(i)-bodyWidth/2,y(Math.max(bar.open,bar.close)),bodyWidth,Math.max(1,Math.abs(y(bar.open)-y(bar.close))));
  });
  for(const [period,color] of [[5,'#d0d89e'],[20,'#7294b5']]){
    ctx.strokeStyle=color;ctx.lineWidth=1.25;ctx.beginPath();
    for(let i=period-1;i<bars.length;i++){
      const avg=bars.slice(i-period+1,i+1).reduce((s,b)=>s+b.close,0)/period;
      if(i===period-1)ctx.moveTo(x(i),y(avg));else ctx.lineTo(x(i),y(avg));
    }ctx.stroke();
  }
  const last=bars.at(-1);ctx.setLineDash([2,4]);ctx.strokeStyle='#a7c87966';ctx.beginPath();ctx.moveTo(pad.l,y(last.close));ctx.lineTo(w-pad.r,y(last.close));ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#a7c879';ctx.fillText(last.close.toFixed(4),w-pad.r+10,y(last.close)+3);
  $('price-chart').setAttribute('aria-label',`EUR/USD ${bars.length} observations; latest ${last.close.toFixed(5)} at ${date(last.time)}.`);
}
function drawEquity(curve) {
  const {ctx,w,h}=canvas('equity-chart');if(!curve.length||!w||!h)return;
  const values=curve.map(p=>p.equity), min=Math.min(...values),max=Math.max(...values),range=max-min||1;
  ctx.beginPath();ctx.strokeStyle=values.at(-1)>=values[0]?'#b2d47e':'#da9b80';ctx.lineWidth=1.5;
  values.forEach((value,i)=>{const x=4+i/Math.max(1,values.length-1)*(w-8),y=8+(max-value)/range*(h-16);if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
  $('equity-chart').setAttribute('aria-label',`Evaluation equity: ${money(values[0])} to ${money(values.at(-1))}.`);
}
$('connect').onclick=()=>act('/api/market',{provider:$('provider').value},'Market data loaded. Inspect the strategy or allocate virtual funds.');
$('csv').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  if(file.size>800000){showError('CSV must be under 800 KB.');event.target.value='';return;}
  try{await act('/api/import',{csv:await file.text()},'Historical CSV imported; source provenance is user-supplied.');}catch(error){showError(error.message);}finally{event.target.value='';}
};
$('allocate').onclick=()=>{text('form-error','');configureAllocation();$('allocate-dialog').showModal();};
$('allocate-form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const data=new FormData(event.currentTarget);busy=true;render();
  try{
    state=await request('/api/allocate',{amount:Number(data.get('amount')),mode:data.get('mode'),strategy:data.get('strategy'),modelId:currentModel()?.id,consent:data.has('consent'),config:data.get('strategy')==='trained'?currentModel()?.config:{maxPositionPct:Number(data.get('position'))/100,riskPerTradePct:Number(data.get('risk'))/100,maxDrawdownPct:Number(data.get('drawdown'))/100,dailyLossPct:Number(data.get('daily'))/100}});
    $('allocate-dialog').close();showError(null);toast('Paper account ready. Start the bot or advance one observation.');
  }catch(error){text('form-error',error.message);}finally{busy=false;render();}
};
$('toggle').onclick=()=>act(state.running?'/api/bot/pause':'/api/bot/start',{},state.running?'New entries paused. Open positions remain exposed.':'Paper strategy started.');
$('step').onclick=()=>act('/api/bot/step');
$('withdraw').onclick=()=>act('/api/withdraw',{},'Positions closed; virtual funds returned to the wallet.');
$('backtest').onclick=()=>act('/api/backtest',{capital:state?.account?.initial??100,config:state?.account?.config??{}},'Backtest calculated. Inspect the reserved evaluation period and assumptions.');
$('reset').onclick=()=>$('reset-dialog').showModal();
$('confirm-reset').onclick=async()=>{await act('/api/reset',{},'Paper account reset.');$('reset-dialog').close();};
$('observer-toggle').onclick=()=>act(state?.research.observer.enabled?'/api/observer/stop':'/api/observer/start',{provider:$('observer-provider').value,retrain:$('observer-auto').checked},state?.research.observer.enabled?'Observation paused; archive preserved.':'Independent market observer started.');
$('observer-refresh').onclick=()=>act('/api/observer/refresh',{provider:$('observer-provider').value},'Market observations archived.');
$('training-dataset').onchange=event=>{selectedDatasetKey=event.target.value;render();};
$('model-select').onchange=event=>{selectedModelId=event.target.value;render();};
$('allocation-strategy').onchange=configureAllocation;
$('train-form').onsubmit=async event=>{
  event.preventDefault();
  await act('/api/models/train',{datasetKey:selectedDatasetKey,amount:Number($('training-amount').value),config:state?.account?.config||{}},'Model trained and evaluated. Inspect its held-out results and screening checks.');
  selectedModelId=state?.research.models.at(-1)?.id||'';render();
};
$('replay-model').onclick=()=>{$('allocation-strategy').value='trained';$('allocate-form').elements.namedItem('mode').value='replay';configureAllocation();text('form-error','');$('allocate-dialog').showModal();};
$('promote-model').onclick=()=>act('/api/models/promote',{modelId:currentModel()?.id},'Model promoted for future paper accounts only. No real-money execution is enabled.');
document.querySelectorAll('dialog .close').forEach(button=>button.onclick=()=>button.closest('dialog').close());
window.addEventListener('resize',()=>{drawPrices(state?.market?.bars||[]);drawEquity(state?.report?.evaluation.curve||[]);});
async function poll(){
  if(busy)return;
  try{state=await request('/api/status');connected=true;showError(state.error);render();}
  catch{connected=false;text('connection','Backend disconnected');showError('Cannot reach the local backend. Run npm run dev and open http://localhost:3000.');}
}
render();await poll();setInterval(poll,2000);
