import { validateBars, analyse } from './strategy.js';
import { fingerprint, features, probability, targetOutcome } from './learning.js';

export function blankResearch() {
  return {version:1,datasets:{},models:[],activeModelId:null,selectedDataset:null,error:null,schedule:{enabled:false,watermarks:{},error:null},observer:{enabled:false,provider:'frankfurter',lastAttempt:null,lastSuccess:null,nextAttempt:0,error:null}};
}
export function seriesKey(market) {
  return market.provider==='csv'?`csv:${fingerprint(market.bars).slice(0,16)}`:`${market.provider}:${market.kind}:${market.interval}:EURUSD`;
}
export function archiveMarket(research,market,now) {
  const bars=validateBars(market.bars),key=seriesKey(market);
  const prior=research.datasets[key];
  if(!prior&&Object.keys(research.datasets).length>=20)throw new Error('The local archive supports 20 distinct series. Archive/export existing research before adding another.');
  const merged=new Map((prior?.bars||[]).map(bar=>[bar.time,bar]));
  let added=0,revised=0;
  for(const bar of bars){const old=merged.get(bar.time);if(!old)added++;else if(JSON.stringify(old)!==JSON.stringify(bar))revised++;merged.set(bar.time,bar);}
  const all=[...merged.values()].sort((a,b)=>a.time.localeCompare(b.time));
  const retained=all.slice(-100000);
  research.datasets[key]={key,name:market.name,provider:market.provider,kind:market.kind,interval:market.interval,sourceUrl:market.sourceUrl||null,firstCollected:prior?.firstCollected||now,lastCollected:now,addedTotal:(prior?.addedTotal||0)+added,revisions:(prior?.revisions||0)+revised,discarded:(prior?.discarded||0)+all.length-retained.length,bars:retained,analysis:analyse(retained.slice(-21))};
  research.selectedDataset=key;
  observeModels(research,research.datasets[key],now);
  return {key,added,revised};
}
export function observeModels(research,dataset,recordedAt) {
  const compatible=research.models.filter(m=>m.source.key===dataset.key);
  const newest=compatible.at(-1);
  const bars=dataset.bars;
  for(const model of compatible){
    model.shadow ||= [];
    const generate=model.id===newest?.id||model.id===research.activeModelId;
    if(generate){
      const last=model.shadow.at(-1)?.time||model.dataThrough;
      // Only predict the newest observation. Never backfill predictions for bars
      // whose future outcomes are already present in the received batch.
      const i=bars.length-1;
      if(i>=20&&bars[i].time>model.dataThrough&&bars[i].time>last){
        const p=probability(model.parameters,features(bars.slice(i-20,i+1)));
        model.shadow.push({time:bars[i].time,recordedAt,p,label:null,labelThrough:null,net:null});
      }
    }
    const indices=new Map(bars.map((bar,i)=>[bar.time,i]));
    for(const prediction of model.shadow){
      if(prediction.label!==null)continue;
      const index=indices.get(prediction.time);
      if(index===undefined)continue;
      const net=targetOutcome(bars,index,model.capital,model.config);
      if(net!==null){prediction.net=net;prediction.label=net>0?1:0;prediction.labelThrough=bars[index+model.horizon].time;}
    }
    model.shadow=model.shadow.slice(-2000);
  }
}
export function shadowView(model) {
  const predictions=model.shadow||[],resolved=predictions.filter(p=>p.label!==null);
  const mean=values=>values.reduce((sum,v)=>sum+v,0)/values.length;
  return {predictions:predictions.length,resolved:resolved.length,latest:predictions.at(-1)||null,brier:resolved.length?mean(resolved.map(p=>(p.p-p.label)**2)):null,baselineBrier:resolved.length?mean(resolved.map(p=>(model.parameters.prevalence-p.label)**2)):null,note:'Only the latest newly archived observation is predicted, before its target outcome enters the archive. No prediction backfill. Historical imports/extensions are research, not live forward evidence. Prediction error is not trading return.'};
}
export function researchView(research) {
  const summary=e=>Object.fromEntries(['initial','equity','netPnl','returnPct','maxDrawdown','closedTrades','winRate','fees','from','to','observations','buyHoldPct'].map(key=>[key,e[key]]));
  const summarize=model=>({id:model.id,trainedAt:model.trainedAt,capital:model.capital,allocationNGN:model.allocationNGN,config:model.config,source:model.source,dataFrom:model.dataFrom,dataThrough:model.dataThrough,trainedThrough:model.trainedThrough,selectionThrough:model.selectionThrough,threshold:model.threshold,target:model.target,metrics:model.metrics,sampleAudit:model.sampleAudit,gate:model.gate,split:model.split,thresholdTrials:model.thresholdTrials,evaluation:summary(model.evaluation),rulesBaseline:summary(model.rulesBaseline),shadow:shadowView(model),featureWeights:model.parameters.features.map((name,i)=>({name,weight:model.parameters.weights[i]}))});
  return {observer:research.observer,schedule:research.schedule,error:research.error,selectedDataset:research.selectedDataset,activeModelId:research.activeModelId,datasets:Object.values(research.datasets).map(d=>({key:d.key,name:d.name,provider:d.provider,kind:d.kind,interval:d.interval,count:d.bars.length,from:d.bars[0].time,to:d.bars.at(-1).time,lastCollected:d.lastCollected,revisions:d.revisions,discarded:d.discarded,analysis:d.analysis})),models:research.models.map(summarize)};
}
