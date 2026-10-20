import { createHash } from 'node:crypto';
import { analyse, validateBars } from './strategy.js';
import { configWith, createAccount, consume, liquidate, accountView } from './paper.js';

export const FEATURES = ['return1','return5','return20','trend','rsi','atrPct','volatility'];
export const HORIZON = 5;
const sigmoid = x => 1/(1+Math.exp(-Math.max(-35,Math.min(35,x))));
const average = xs => xs.reduce((a,b)=>a+b,0)/xs.length;
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function features(history) {
  if (history.length<21) return null;
  const b=history.slice(-21), last=b.at(-1).close;
  const indicators=analyse(b).indicators;
  const returns=b.slice(1).map((bar,i)=>Math.log(bar.close/b[i].close));
  const mean=average(returns);
  return [last/b.at(-2).close-1,last/b.at(-6).close-1,last/b[0].close-1,indicators.trend,(indicators.rsi-50)/50,indicators.atr/last,Math.sqrt(average(returns.map(x=>(x-mean)**2)))];
}
export function samples(bars,start,end,capital,config) {
  const output=[];
  for(let i=Math.max(20,start);i+HORIZON<end;i++) {
    const net=targetOutcome(bars,i,capital,config);
    output.push({index:i,time:bars[i].time,labelThrough:bars[i+HORIZON].time,x:features(bars.slice(Math.max(0,i-20),i+1)),y:net>0?1:0,net});
  }
  return output;
}
export function targetOutcome(bars,index,capital,config) {
  if(!bars[index+HORIZON])return null;
  const entry=bars[index+1].open+config.spread/2+config.slippage;
  const exit=bars[index+HORIZON].close-config.spread/2-config.slippage;
  return capital*config.maxPositionPct/entry*(exit-entry)-2*config.fee;
}
// Deterministic L2-regularized logistic regression. Scaler is fitted on training rows only.
export function fit(rows) {
  if(rows.length<100)throw new Error('At least 100 labelled training examples are required.');
  if(!rows.some(r=>r.y===1)||!rows.some(r=>r.y===0))throw new Error('Training needs both profitable and unprofitable target examples after costs.');
  const means=FEATURES.map((_,j)=>average(rows.map(r=>r.x[j])));
  const scales=means.map((mean,j)=>Math.sqrt(average(rows.map(r=>(r.x[j]-mean)**2)))||1);
  const xs=rows.map(r=>r.x.map((x,j)=>(x-means[j])/scales[j]));
  const prevalence=average(rows.map(r=>r.y));
  const weights=FEATURES.map(()=>0);let intercept=Math.log(prevalence/(1-prevalence));
  for(let epoch=0;epoch<400;epoch++){
    const gradient=weights.map(()=>0);let bias=0;
    for(let i=0;i<rows.length;i++){
      const error=sigmoid(intercept+weights.reduce((sum,w,j)=>sum+w*xs[i][j],0))-rows[i].y;
      bias+=error;for(let j=0;j<weights.length;j++)gradient[j]+=error*xs[i][j];
    }
    intercept-=0.08*bias/rows.length;
    for(let j=0;j<weights.length;j++)weights[j]-=0.08*(gradient[j]/rows.length+0.02*weights[j]);
  }
  return {algorithm:'logistic-regression-v1',features:FEATURES,means,scales,weights,intercept,prevalence,epochs:400,l2:0.02};
}
export function probability(model,x) {
  if(!x||x.length!==FEATURES.length||x.some(v=>!Number.isFinite(v)))throw new Error('Invalid model features.');
  const score=model.intercept+model.weights.reduce((sum,w,j)=>sum+w*(x[j]-model.means[j])/model.scales[j],0);
  const p=sigmoid(score);if(!Number.isFinite(p))throw new Error('Model returned an invalid probability.');return p;
}
export function predictionMetrics(model,rows) {
  const predictions=rows.map(r=>({p:probability(model,r.x),y:r.y}));
  return {samples:rows.length,positiveRate:average(rows.map(r=>r.y)),brier:average(predictions.map(r=>(r.p-r.y)**2)),baselineBrier:average(rows.map(r=>(model.prevalence-r.y)**2)),logLoss:-average(predictions.map(r=>r.y*Math.log(Math.max(1e-12,r.p))+(1-r.y)*Math.log(Math.max(1e-12,1-r.p)))),accuracy:average(predictions.map(r=>(r.p>=0.5?1:0)===r.y?1:0)),baselineAccuracy:average(rows.map(r=>(model.prevalence>=0.5?1:0)===r.y?1:0))};
}
export function learnedDecision(artifact,history,hasPosition=false,account=null,{forward=false}={}) {
  const baseline=analyse(history,hasPosition);
  if(!baseline.indicators)return baseline;
  const time=history.at(-1).time;
  const earliest=forward?artifact.dataThrough:artifact.selectionThrough;
  if(time<=earliest)return {action:'hold',reason:'Model is restricted to observations after its parameter-selection period (after the full experiment for forward paper).',indicators:baseline.indicators,modelId:artifact.id};
  const x=features(history);
  const drift=artifact.parameters.features.filter((_,j)=>Math.abs((x[j]-artifact.parameters.means[j])/artifact.parameters.scales[j])>6);
  if(drift.length)return {action:hasPosition&&baseline.action==='sell'?'sell':'hold',indicators:baseline.indicators,modelId:artifact.id,drift,reason:`Model abstained: ${drift.join(', ')} outside six training standard deviations. Independent risk exits remain enabled.`};
  const p=probability(artifact.parameters,x);
  const held=hasPosition&&account?.position?history.filter(b=>b.time>account.position.openedAt).length:0;
  let action='hold';
  if(hasPosition&&(held>=HORIZON||p<0.45||baseline.action==='sell'))action='sell';
  else if(!hasPosition&&p>=artifact.threshold)action='buy';
  return {action,indicators:baseline.indicators,probability:p,modelId:artifact.id,reason:`Trained model ${artifact.id.slice(0,10)}: estimated ${(p*100).toFixed(1)}% probability of a positive ${HORIZON}-observation hypothetical trade after assumed costs; entry threshold ${(artifact.threshold*100).toFixed(0)}%. ${action==='buy'?'Propose entry.':action==='sell'?'Propose exit (horizon, probability, or trend condition).':'No new order.'} This estimate is not a guaranteed win probability for the actual order.`};
}

export function evaluate(artifact,bars,start,end,{rules=false}={}) {
  const a=createAccount(artifact.capital,artifact.config);
  for(let i=start;i<end;i++)consume(a,bars.slice(0,i+1),{decide:rules?analyse:(history,position,account)=>learnedDecision(artifact,history,position,account)});
  const last=bars[end-1];liquidate(a,last.close,last.time,'End of evaluation');a.pending=null;
  if(a.curve.length)a.curve.at(-1).equity=a.cash;
  a.maxDrawdown=Math.max(a.maxDrawdown,(a.peak-a.cash)/a.peak);
  const c=a.config,first=bars[start];
  const units=(a.initial-c.fee)/(first.open+c.spread/2+c.slippage);
  return {...accountView(a,last.close),from:first.time,to:last.time,observations:end-start,cashBaselinePct:0,buyHoldPct:((units*(last.close-c.spread/2-c.slippage)-c.fee)/a.initial-1)*100};
}

export function trainExperiment(input,{capital=12.4375,config={},source={},trainedAt=new Date().toISOString()}={}) {
  const bars=validateBars(input);
  if(bars.length<300)throw new Error('Training requires at least 300 observations for training, validation, test, and label gaps.');
  config=configWith(config);createAccount(capital,config);
  const trainEnd=Math.floor(bars.length*0.6),validationEnd=Math.floor(bars.length*0.8);
  const train=samples(bars,20,trainEnd,capital,config),validation=samples(bars,trainEnd,validationEnd,capital,config),test=samples(bars,validationEnd,bars.length,capital,config);
  const parameters=fit(train);
  const datasetHash=fingerprint(bars);
  const id=fingerprint({datasetHash,sourceKey:source.key,capital,config,parameters,version:1});
  const artifact={id,version:1,trainedAt,capital,config,source,datasetHash,dataFrom:bars[0].time,dataThrough:bars.at(-1).time,trainedThrough:bars[trainEnd-1].time,selectionThrough:bars[validationEnd-1].time,parameters,threshold:0.6,horizon:HORIZON,split:{trainEnd,validationEnd,total:bars.length},target:'Positive net hypothetical long trade: next observation open to fifth observation close; fixed maximum-position notional, assumed round-trip costs. Actual risk-managed executions can differ.',metrics:{train:predictionMetrics(parameters,train),validation:predictionMetrics(parameters,validation),test:null},sampleAudit:{trainFirst:train[0].time,trainLast:train.at(-1).time,trainLabelThrough:train.at(-1).labelThrough,validationFirst:validation[0].time,validationLast:validation.at(-1).time,validationLabelThrough:validation.at(-1).labelThrough,testFirst:test[0].time,testLast:test.at(-1).time,testLabelThrough:test.at(-1).labelThrough},snapshot:bars};
  // Threshold search sees validation only. Test performance never chooses parameters.
  const trials=[0.55,0.6,0.65,0.7].map(threshold=>{
    const candidate={...artifact,threshold,selectionThrough:artifact.trainedThrough};
    const result=evaluate(candidate,bars,trainEnd,validationEnd);
    return {threshold,returnPct:result.returnPct,closedTrades:result.closedTrades};
  });
  const eligible=trials.filter(t=>t.closedTrades>=3).sort((a,b)=>b.returnPct-a.returnPct||b.threshold-a.threshold);
  artifact.threshold=eligible[0]?.threshold??0.7;
  artifact.thresholdTrials=trials;
  artifact.metrics.test=predictionMetrics(parameters,test);
  artifact.evaluation=evaluate(artifact,bars,validationEnd,bars.length);
  artifact.rulesBaseline=evaluate(artifact,bars,validationEnd,bars.length,{rules:true});
  const e=artifact.evaluation;
  const checks=[
    ['positiveReturn',e.returnPct>0,'Test net return must exceed zero-interest cash.'],
    ['beatsRules',e.returnPct>artifact.rulesBaseline.returnPct,'Test return must exceed the fixed-rule baseline.'],
    ['minimumTrades',e.closedTrades>=5,'At least five closed test trades are required.'],
    ['drawdown',e.maxDrawdown<config.maxDrawdownPct,'Test drawdown must remain below the configured account stop.'],
    ['predictionSkill',artifact.metrics.test.brier<artifact.metrics.test.baselineBrier,'Test Brier score must beat the training-prevalence predictor.'],
  ].map(([key,passed,description])=>({key,passed,description}));
  artifact.gate={passed:checks.every(c=>c.passed),checks,note:'Screening gate for experimental paper deployment only. One historical test does not establish profitability. Repeated inspection or retraining can overfit this test period.'};
  return artifact;
}
