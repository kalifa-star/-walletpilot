import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { trainExperiment } from '../backend/learning.js';
import { seriesKey, researchView, blankResearch } from '../backend/research.js';

// Read-only with respect to the running paper account. Never overwrites its state.
const saved=JSON.parse(await readFile('.runtime/walletpilot.json','utf8'));
const selected=saved.research?.datasets[saved.research.selectedDataset];
const market=selected||saved.market;
if(!market)throw new Error('Connect/import market data in the dashboard before running training.');
const amount=saved.allocationNGN||20000;
const model=trainExperiment(market.bars.slice(-5000),{
  capital:amount*0.995/(saved.fx||1600),config:saved.account?.config||{},
  source:{key:selected?.key||seriesKey(market),name:market.name,provider:market.provider,kind:market.kind,interval:market.interval,sourceUrl:market.sourceUrl||null},
});
model.allocationNGN=amount;
await mkdir('.runtime/candidates',{recursive:true});
const path=`.runtime/candidates/${model.id}.json`;
await writeFile(path+'.tmp',JSON.stringify(model),{mode:0o600});await rename(path+'.tmp',path);
const research=blankResearch();research.models=[model];
const summary=researchView(research).models[0];
await mkdir('reports',{recursive:true});
await writeFile('reports/training-latest.json',JSON.stringify(summary,null,2)+'\n');
const p=n=>(n>=0?'+':'')+n.toFixed(2)+'%';
const report=`# Real-data training experiment\n\nGenerated ${model.trainedAt}. Research only; no active model or paper account was changed.\n\nSource: ${model.source.name} (${model.source.interval}), ${model.dataFrom.slice(0,10)} through ${model.dataThrough.slice(0,10)}. Dataset SHA-256: ${model.datasetHash}.\n\nModel: logistic-regression-v1, seven price-derived features. Virtual allocation: ₦${amount}; USD capital after conversion: $${model.capital.toFixed(4)}.\n\nTraining, validation, and test are chronological (60/20/20), with five-observation label purges. Labelled examples: ${model.metrics.train.samples} / ${model.metrics.validation.samples} / ${model.metrics.test.samples}. Normalization uses training examples only; validation selects the ${(model.threshold*100).toFixed(0)}% entry threshold.\n\n| Held-out test result | Value |\n| --- | ---: |\n| Trained strategy net return | ${p(model.evaluation.returnPct)} |\n| Fixed-rule baseline, same period/capital | ${p(model.rulesBaseline.returnPct)} |\n| Zero-interest USD cash | 0.00% |\n| Buy and hold EUR | ${p(model.evaluation.buyHoldPct)} |\n| Closed trades | ${model.evaluation.closedTrades} |\n| Assumed order fees | $${model.evaluation.fees.toFixed(2)} |\n| Max drawdown | ${(model.evaluation.maxDrawdown*100).toFixed(2)}% |\n| Test Brier / constant-prediction baseline | ${model.metrics.test.brier.toFixed(4)} / ${model.metrics.test.baselineBrier.toFixed(4)} |\n\nScreening: **${model.gate.passed?'passed experimental paper screening':'not passed; remains a research candidate'}**.\n\n${model.gate.checks.map(c=>`- ${c.passed?'PASS':'FAIL'}: ${c.description}`).join('\n')}\n\n${model.gate.note} ${model.target} ${market.kind==='reference'?'Daily fixings cannot establish realistic intraday execution.':''} Assumed spread, slippage, and fees apply; NGN conversion charges and model API costs are excluded. The test horizon overlaps across examples, so observations are not independent.\n\nThis offline artifact is saved under .runtime/candidates and is not automatically registered, promoted, or traded. Use Train & evaluate in the restarted dashboard to create the corresponding registry candidate.\n`;
await writeFile('reports/training-latest.md',report);
console.log(JSON.stringify({modelId:model.id,source:model.source.name,observations:model.split.total,capital:model.capital,testReturnPct:model.evaluation.returnPct,rulesReturnPct:model.rulesBaseline.returnPct,closedTrades:model.evaluation.closedTrades,gatePassed:model.gate.passed,report:'reports/training-latest.md'},null,2));
