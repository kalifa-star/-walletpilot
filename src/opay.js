const $=id=>document.getElementById(id);
const text=(id,value)=>{$(id).textContent=value;};
const money=(n,currency='NGN')=>new Intl.NumberFormat(currency==='NGN'?'en-NG':'en-US',{style:'currency',currency}).format(n);
let bot=null,payments=null,busy=false,selectedReference='',requestId=null,timer;
const buttons=[...document.querySelectorAll('button')];
function error(message){$('host-error').hidden=!message;text('host-error',message||'');}
function toast(message){text('host-toast',message);$('host-toast').classList.add('visible');clearTimeout(timer);timer=setTimeout(()=>$('host-toast').classList.remove('visible'),5000);}
async function api(path,body){
  const response=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed.');return data;
}
function showTab(name){
  if(!['wallet','trading','integration'].includes(name))name='wallet';
  for(const tab of ['wallet','trading','integration'])$('view-'+tab).hidden=tab!==name;
  document.querySelectorAll('nav [data-tab]').forEach(button=>{button.classList.toggle('active',button.dataset.tab===name);button.setAttribute('aria-selected',String(button.dataset.tab===name));});
  if(name==='trading'&&$('trading-frame').getAttribute('src')==='about:blank')$('trading-frame').src='/';
  if(location.hash!=='#'+name)history.replaceState(null,'','#'+name);
}
async function refresh(){
  const results=await Promise.allSettled([api('/api/status'),api('/api/opay/status')]);
  if(results[0].status==='fulfilled')bot=results[0].value;
  if(results[1].status==='fulfilled')payments=results[1].value;
  const failed=results.find(result=>result.status==='rejected');if(failed)error(failed.reason.message);
  render();
}
async function command(path,input={},message){
  if(busy)return;busy=true;render();let ok=false;
  try{
    const data=await api(path,input);if(path.startsWith('/api/opay/'))payments=data;else bot=data;
    error(null);if(message)toast(message);ok=true;
  }catch(e){error(e.message);await refresh();}
  finally{busy=false;render();}return ok;
}
function render(){
  buttons.forEach(button=>button.disabled=busy);
  if(bot){
    const a=bot.account,m=bot.market,done=!!a&&bot.mode==='replay'&&m?.cursor>=m?.totalBars-1;
    text('host-wallet',money(bot.walletNGN));text('host-equity',a?money(a.equity,'USD'):'No allocation');
    text('host-return',a?`${a.netPnl>=0?'+':''}${money(a.netPnl,'USD')} · ${a.returnPct.toFixed(2)}% after trading costs`:'Choose a virtual budget to explore the strategy.');
    $('host-return').classList.toggle('negative',!!a&&a.netPnl<0);
    const status=bot.settled?'Funds returned · settled snapshot':a?.stopped?'Drawdown stop reached':done?'Historical replay complete':bot.running?'Paper strategy running':bot.funded?'Paper strategy paused':'Ready to explore';
    text('host-strategy-status',status);text('native-status',`${status}. ${a?.strategy==='trained'?'Trained classifier':'Experimental indicator rules'} · virtual funds only.`);
    text('wallet-allocate',a?'View strategy ↗':'↗  Allocate to strategy');text('native-allocate',a?'View full controls':'Allocate virtual funds');
    for(const id of ['wallet-return','native-withdraw'])$(id).disabled=busy||!bot.funded;
    $('native-toggle').disabled=busy||!bot.funded||a?.stopped||done;
    $('native-step').disabled=busy||!bot.funded||bot.running||done;
    text('native-toggle',bot.running?'Pause paper bot':'Start paper bot');
    text('native-step',bot.mode==='forward'?'Poll new candle':'Next observation →');
    text('mini-price',m?.bars.length?m.bars.at(-1).close.toFixed(5):'Awaiting market data');
    text('mini-decision',bot.analysis?.reason||'Connect market data to see the current strategy decision.');
    text('mini-mode',a?.strategy==='trained'?'TRAINED PAPER MODEL':'INDICATOR PAPER STRATEGY');
    text('backend-state','Connected · paper only');
    const model=bot.research?.models.at(-1);text('host-model',model?model.gate.passed?'Passed paper screen':'Failed paper screen':'No registered model');
  }
  if(payments){
    const mock=payments.mode==='mock';
    text('payment-mode',mock?'Local mock':'OPay staging adapter');
    text('integration-badge',mock?'LOCAL MOCK · NO PROVIDER CALLS':'OPAY STAGING · TEST ONLY');
    text('integration-notice',mock?'Local simulation mode. Create a pending payment, simulate its outcome, and reconcile it. No request is sent to OPay and no trading balance changes.':'OPay staging mode. Requests go only to the documented test host. Staging results remain isolated from the paper wallet; production payments and investment funding are unavailable.');
    text('credentials-status',mock?'No merchant credentials are needed for the local mock. To exercise OPay staging, configure the server .env and restart. Never enter your wallet PIN, OTP, or merchant keys here.':`${payments.configured?'Staging credentials configured.':'Staging credentials missing; configure the server .env.'} Callback URL ${payments.callbackConfigured?'configured':'not configured; use manual reconciliation'}. Status authentication: ${payments.statusAuth}.`);
    const order=payments.orders.find(o=>o.reference===selectedReference)||payments.orders[0];
    if(order)selectedReference=order.reference;
    $('payment-result').hidden=!order;
    if(order){
      text('payment-reference',order.reference);text('payment-status',order.status);
      text('payment-message',order.error||`${money(order.amountKobo/100)} · ${order.mode==='mock'?'local simulation':'OPay staging'}. Trading wallet unchanged.`);
      $('payment-qr').hidden=!order.qrUrl;
      if(order.qrUrl)$('payment-qr').href=order.qrUrl;
      const finalized=['SUCCESS','FAIL','CLOSE'].includes(order.status);
      for(const id of ['simulate-success','simulate-fail','simulate-close']){$(id).hidden=!mock;$(id).disabled=busy||finalized||order.mode!==payments.mode;}
      $('payment-query').disabled=busy||order.mode!==payments.mode;
      $('payment-events').replaceChildren(...order.events.slice().reverse().map(event=>{
        const p=document.createElement('p'),time=document.createElement('time');time.textContent=event.time.replace('T',' ').slice(0,19)+' UTC';p.append(time,document.createTextNode(event.message));return p;
      }));
    }
    if(!payments.orders.length)$('payment-orders').innerHTML='<tr><td colspan="5">No payment requests yet.</td></tr>';
    else $('payment-orders').replaceChildren(...payments.orders.map(order=>{
      const tr=document.createElement('tr');
      [order.reference,money(order.amountKobo/100),order.mode,order.status].forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td);});
      const td=document.createElement('td'),button=document.createElement('button');button.className='plain-button';button.textContent='Inspect →';button.disabled=busy;button.onclick=()=>{selectedReference=order.reference;render();};td.append(button);tr.append(td);return tr;
    }));
    $('payment-create').disabled=busy||(!mock&&!payments.configured);
  }
}
function openFunding(){
  if(bot?.account){showTab('trading');return;}
  text('fund-error','');$('fund-error').hidden=true;$('fund-dialog').showModal();
}
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>showTab(button.dataset.tab));
$('feature-open').onclick=()=>showTab('trading');
$('wallet-allocate').onclick=openFunding;$('native-allocate').onclick=openFunding;
for(const id of ['wallet-return','native-withdraw'])$(id).onclick=()=>command('/api/withdraw',{},'Available virtual funds returned to the local wallet. No OPay payout was made.');
$('native-toggle').onclick=()=>command(bot?.running?'/api/bot/pause':'/api/bot/start');
$('native-step').onclick=()=>command('/api/bot/step');
$('fund-form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const fields=new FormData(event.currentTarget);busy=true;render();
  try{
    if(!bot?.market||bot.market.provider!==fields.get('provider'))bot=await api('/api/market',{provider:fields.get('provider')});
    bot=await api('/api/allocate',{amount:Number(fields.get('amount')),consent:fields.has('consent'),mode:'replay',strategy:'rules'});
    $('fund-dialog').close();error(null);showTab('trading');toast('Virtual allocation ready. Start the paper bot to explore its decisions.');
  }catch(e){text('fund-error',e.message);$('fund-error').hidden=false;}
  finally{busy=false;render();}
};
$('payment-form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const amount=Number($('payment-amount').value),consent=$('payment-consent').checked;
  requestId ||= crypto.randomUUID();
  const ok=await command('/api/opay/payments/create',{amount,consent,requestId},'Test payment recorded. Inspect its status before creating another.');
  const order=payments?.orders.find(o=>o.requestId===requestId);
  if(order){selectedReference=order.reference;requestId=null;render();}
  else if(ok)requestId=null;
};
$('payment-query').onclick=()=>command('/api/opay/payments/query',{reference:selectedReference},'Payment status reconciled. Trading balance unchanged.');
for(const [id,status]of [['simulate-success','SUCCESS'],['simulate-fail','FAIL'],['simulate-close','CLOSE']])$(id).onclick=()=>command('/api/opay/payments/simulate',{reference:selectedReference,status},'Local payment outcome recorded. No OPay request was made.');
$('reset-open').onclick=()=>$('host-reset-dialog').showModal();
$('reset-confirm').onclick=async()=>{if(await command('/api/reset',{},'Virtual trading session reset. Payment records and research preserved.'))$('host-reset-dialog').close();};
document.querySelectorAll('.close-dialog').forEach(button=>button.onclick=()=>button.closest('dialog').close());
window.addEventListener('hashchange',()=>showTab(location.hash.slice(1)));
showTab(location.hash.slice(1));await refresh();setInterval(()=>{if(!busy)refresh().catch(()=>error('Cannot reach the local server. Restart npm run dev.'));},3000);
