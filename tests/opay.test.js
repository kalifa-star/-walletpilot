import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { canonicalJSON, ngnToKobo, opayConfiguration, OPayAdapter, OPayIntegration, callbackContent, verifyCallback } from '../backend/opay.js';
import { BotService } from '../backend/service.js';
import { createHandler } from '../server.js';

const config=()=>({mode:'sandbox',merchantId:'test-merchant',privateKey:'test-private-key',publicKey:'test-public-key',statusAuth:'public',callbackUrl:''});
const result=(order,status='PENDING')=>({reference:order.reference,orderNo:order.orderNo||'test-order-01',amount:{total:order.amountKobo,currency:'NGN'},status});
const create=(integration,requestId='request-1',amount=100)=>integration.run('create',{requestId,amount,consent:true});
function fakeSandbox({file=null,now}={}){
  const calls={create:0,query:0};let responseStatus='PENDING',createError=null;
  const adapter={config:config(),ready:true,async create(order){calls.create++;if(createError)throw new Error(createError);return result(order);},async query(order){calls.query++;return result(order,responseStatus);}};
  const integration=new OPayIntegration({file,adapter,...(now?{now}:{})});
  return {integration,adapter,calls,setStatus:s=>responseStatus=s,failCreate:e=>createError=e};
}
function signed(order,{status='SUCCESS',key='test-private-key',...overrides}={}){
  const payload={reference:order.reference,transactionId:order.orderNo||'test-order-01',token:order.orderNo||'test-order-01',amount:String(order.amountKobo),currency:'NGN',country:'NG',status,refunded:false,timestamp:'2025-01-01T00:00:00Z',...overrides};
  return {type:'transaction-status',payload,sha512:createHmac('sha3-512',key).update(callbackContent(payload)).digest('hex')};
}
test('request canonicalization sorts nested objects and preserves array order',()=>{
  assert.equal(canonicalJSON({z:[{b:2,a:1},3],a:{d:4,c:3}}),'{"a":{"c":3,"d":4},"z":[{"a":1,"b":2},3]}');
});
test('NGN inputs convert to integer kobo and reject precision loss or invalid amounts',()=>{
  assert.equal(ngnToKobo(100.25),10025);
  for(const value of [0,-1,NaN,Infinity,1.234,100001,'10'])assert.throws(()=>ngnToKobo(value));
});
test('only mock and staging modes are allowed and callback URLs are constrained',()=>{
  assert.equal(opayConfiguration({}).mode,'mock');
  assert.throws(()=>opayConfiguration({OPAY_MODE:'live'}),/Production/);
  assert.throws(()=>opayConfiguration({OPAY_CALLBACK_URL:'http://example.com/api/opay/callback'}),/HTTPS/);
  assert.throws(()=>opayConfiguration({OPAY_CALLBACK_URL:'https://example.com/not-a-callback'}),/callback/);
});
test('staging create signs exactly the sorted body sent to the fixed test host',async()=>{
  let captured;
  const adapter=new OPayAdapter({config:config(),fetcher:async(url,init)=>{captured={url,init};return {ok:true,json:async()=>({code:'00000',data:{}})};}});
  await adapter.create({reference:'test-ref',amountKobo:12345});
  assert.equal(captured.url,'https://testapi.opaycheckout.com/api/v1/international/payment/create');
  assert.equal(captured.init.redirect,'error');
  assert.equal(captured.init.headers.Authorization,'Bearer '+createHmac('sha512','test-private-key').update(captured.init.body).digest('hex'));
  const payload=JSON.parse(captured.init.body);assert.equal(payload.amount.total,12345);assert.equal(payload.payMethod,'OpayWalletNgQR');
  assert.equal(payload.callbackUrl,undefined);
});
test('payment-status authentication is explicit public-key or HMAC mode',async()=>{
  for(const mode of ['public','hmac']){
    let captured;
    const c={...config(),statusAuth:mode};
    const adapter=new OPayAdapter({config:c,fetcher:async(url,init)=>{captured=init;return {ok:true,json:async()=>({code:'00000',data:{}})};}});
    await adapter.query({reference:'test-ref'});
    const expected=mode==='public'?'test-public-key':createHmac('sha512','test-private-key').update(captured.body).digest('hex');
    assert.equal(captured.headers.Authorization,'Bearer '+expected);
  }
});
test('missing credentials and mock mode never issue external requests',async()=>{
  let calls=0;const fetcher=async()=>{calls++;throw new Error('must not call');};
  await assert.rejects(new OPayAdapter({config:opayConfiguration({}),fetcher}).create({}),/sandbox/);
  await assert.rejects(new OPayAdapter({config:opayConfiguration({OPAY_MODE:'sandbox'}),fetcher}).create({}),/credentials/);
  assert.equal(calls,0);
});
test('the published OPay callback vector verifies with its published example key',()=>{
  // Public documentation example, not a merchant credential.
  const body={type:'transaction-status',payload:{amount:'49160',country:'NG',currency:'NGN',reference:'10023',refunded:false,status:'SUCCESS',timestamp:'2022-05-07T06:20:46Z',token:'220507145660712931829',transactionId:'220507145660712931829'},sha512:'9f605d69f04e94172875dc156537071cead060bbcaeaca94a7b8805af9f89611e2fdf6836713c9c90b028ca7e4470b1356e996975f2abc862315aaa9b7f2ae2d'};
  const key='OPAYPRV16498196872570.13953388019021462';
  assert.equal(verifyCallback(body,key).reference,'10023');
  assert.throws(()=>verifyCallback({...body,payload:{...body.payload,amount:'49161'}},key),/signature/);
  assert.throws(()=>verifyCallback({...body,sha512:'bad'},key),/signature/);
});
test('mock payment lifecycle is explicit and finalized outcomes cannot be rewritten',async()=>{
  const integration=new OPayIntegration({file:null,adapter:new OPayAdapter({config:opayConfiguration({})})});
  await create(integration);const ref=integration.view().orders[0].reference;
  assert.equal(integration.view().orders[0].status,'PENDING');
  await integration.run('simulate',{reference:ref,status:'SUCCESS'});
  assert.equal(integration.view().orders[0].status,'SUCCESS');
  await assert.rejects(integration.run('simulate',{reference:ref,status:'FAIL'}),/finalized/);
  assert.equal(integration.view().customerWalletAccess,false);
});
test('concurrent duplicate creation contacts the provider only once',async()=>{
  const {integration,calls}=fakeSandbox();
  await Promise.all([create(integration),create(integration)]);
  assert.equal(calls.create,1);assert.equal(integration.state.orders.length,1);
  await assert.rejects(create(integration,'request-1',101),/Idempotency/);
});
test('uncertain creation keeps its durable reference and retries never create a second order',async()=>{
  const {integration,calls,failCreate,setStatus}=fakeSandbox();failCreate('Timeout');
  await assert.rejects(create(integration),/Timeout/);
  const order=integration.state.orders[0];assert.equal(order.status,'UNKNOWN');
  await create(integration);assert.equal(calls.create,1);
  setStatus('SUCCESS');await integration.run('query',{reference:order.reference});assert.equal(order.status,'SUCCESS');
});
test('mismatched provider amounts and currencies cannot finalize a payment',async()=>{
  for(const mutation of [data=>({...data,amount:{total:1,currency:'NGN'}}),data=>({...data,amount:{total:data.amount.total,currency:'USD'}}),data=>({...data,reference:'wrong-reference'}),data=>({...data,status:'MADE_UP'})]){
    const {integration,adapter}=fakeSandbox();await create(integration);const order=integration.state.orders[0];
    adapter.query=async()=>mutation(result(order,'SUCCESS'));
    await assert.rejects(integration.run('query',{reference:order.reference}),/does not match/);
    assert.equal(order.status,'PENDING');
  }
});
test('verified callbacks require an independent status query and duplicate delivery is idempotent',async()=>{
  const {integration,calls,setStatus}=fakeSandbox();await create(integration);const order=integration.state.orders[0];setStatus('SUCCESS');
  const body=signed(order);await integration.run('callback',body);await integration.run('callback',body);
  assert.equal(order.status,'SUCCESS');assert.equal(calls.query,1);assert.equal(order.callbackDigests.length,1);
});
test('a callback cannot force success when the status query still reports pending',async()=>{
  const {integration}=fakeSandbox();await create(integration);const order=integration.state.orders[0];
  await integration.run('callback',signed(order));assert.equal(order.status,'PENDING');
  assert.ok(order.events.some(event=>event.message.includes('disagreed')));
});
test('forged, unknown, wrong-amount, refunded, and wrong-transaction callbacks are rejected',async()=>{
  const {integration,calls}=fakeSandbox();await create(integration);const order=integration.state.orders[0];
  for(const body of [signed(order,{key:'wrong-key'}),signed(order,{amount:'1'}),signed(order,{refunded:true}),signed(order,{transactionId:'different-order'}),signed(order,{reference:'unknown-ref'})])await assert.rejects(integration.run('callback',body));
  assert.equal(calls.query,0);assert.equal(order.status,'PENDING');
});
test('provider outages do not acknowledge callbacks or record them as reconciled',async()=>{
  const {integration,adapter}=fakeSandbox();await create(integration);const order=integration.state.orders[0];adapter.query=async()=>{throw new Error('Provider offline');};
  await assert.rejects(integration.run('callback',signed(order)),/offline/);
  assert.equal(order.callbackDigests.length,0);assert.equal(order.status,'PENDING');
});
test('terminal provider results cannot silently regress or switch to another terminal result',async()=>{
  const {integration,setStatus}=fakeSandbox();await create(integration);const order=integration.state.orders[0];
  setStatus('SUCCESS');await integration.run('query',{reference:order.reference});
  setStatus('PENDING');await integration.run('query',{reference:order.reference});
  assert.equal(order.status,'SUCCESS');assert.match(order.error,/Manual reconciliation/);
});
test('unsafe QR destinations are not exposed as navigable links',async()=>{
  const {integration,adapter}=fakeSandbox();adapter.create=async order=>({...result(order),nextAction:{qrCode:'javascript:alert(1)'}});
  await create(integration);assert.equal(integration.view().orders[0].qrUrl,null);
});
test('a failure to persist the intent prevents any external creation request',async()=>{
  const {integration,calls}=fakeSandbox();integration.save=async()=>{throw new Error('Disk full');};
  await assert.rejects(create(integration),/Disk full/);assert.equal(calls.create,0);assert.equal(integration.state.orders.length,0);
});
test('a failure after provider creation keeps the original intent for restart reconciliation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'walletpilot-opay-'));
  try{
    const file=join(dir,'state.json');const {integration,adapter,calls}=fakeSandbox({file});
    const save=integration.save.bind(integration);let saves=0;
    integration.save=async()=>{if(++saves>1)throw new Error('Disk unavailable');return save();};
    await assert.rejects(create(integration),/could not be saved/);assert.equal(calls.create,1);
    const disk=JSON.parse(await readFile(file,'utf8'));assert.equal(disk.orders[0].status,'CREATING');
    const loaded=new OPayIntegration({file,adapter});await loaded.init();assert.equal(loaded.state.orders[0].status,'UNKNOWN');
    await create(loaded);assert.equal(calls.create,1);
    await loaded.run('query',{reference:loaded.state.orders[0].reference});assert.equal(loaded.state.orders[0].status,'PENDING');
  }finally{await rm(dir,{recursive:true,force:true});}
});
async function http(handler,path,{method='GET',body,headers={}}={}){
  const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);Object.assign(req,{url:path,method,headers:{host:'localhost:3000','content-type':'application/json',...headers}});
  const res={status:0,writeHead(status,headers){this.status=status;this.headers=headers;return this;},end(body){this.body=body;return this;}};
  await handler(req,res);return res;
}
test('payment routes and paper resets never credit or debit the trading wallet',async()=>{
  const bot=new BotService({file:null});const integration=new OPayIntegration({file:null,adapter:new OPayAdapter({config:opayConfiguration({})})});
  const handler=createHandler(bot,integration);
  const created=await http(handler,'/api/opay/payments/create',{method:'POST',body:{requestId:'http-test',amount:100,consent:true}});
  assert.equal(created.status,200);const reference=JSON.parse(created.body).orders[0].reference;
  assert.equal((await http(handler,'/api/opay/payments/simulate',{method:'POST',body:{reference,status:'SUCCESS'}})).status,200);
  assert.equal(bot.state.walletNGN,100000);assert.equal(bot.state.account,null);
  await bot.run('reset');assert.equal(integration.state.orders.length,1);
  for(const path of ['/opay','/src/opay.js','/src/opay.css'])assert.equal((await http(handler,path)).status,200);
  for(const path of ['/.runtime/opay-integration.json','/backend/opay.js','/.env'])assert.equal((await http(handler,path)).status,404);
});
test('only the configured public callback host is accepted, and control routes stay local',async()=>{
  const fake=fakeSandbox();fake.adapter.config.callbackUrl='https://callbacks.example.test/api/opay/callback';await create(fake.integration);fake.setStatus('SUCCESS');
  const handler=createHandler(new BotService({file:null}),fake.integration);
  const body=signed(fake.integration.state.orders[0]);
  assert.equal((await http(handler,'/api/opay/callback',{method:'POST',body,headers:{host:'callbacks.example.test'}})).status,200);
  assert.equal((await http(handler,'/api/status',{headers:{host:'callbacks.example.test'}})).status,403);
  assert.equal((await http(handler,'/api/opay/callback',{method:'POST',body,headers:{host:'attacker.example'}})).status,403);
});
