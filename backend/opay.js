import { createHmac, timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const STAGING='https://testapi.opaycheckout.com';
const STATUSES=new Set(['INITIAL','PENDING','SUCCESS','FAIL','CLOSE']);
const TERMINAL=new Set(['SUCCESS','FAIL','CLOSE']);
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,100}$/.test(value);
export function canonicalJSON(value){
  if(Array.isArray(value))return '['+value.map(canonicalJSON).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJSON(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function ngnToKobo(amount){
  const kobo=Math.round(amount*100);
  if(!Number.isFinite(amount)||amount<1||amount>100000||Math.abs(amount*100-kobo)>1e-6||!Number.isSafeInteger(kobo))throw new Error('Use ₦1–₦100,000 with no more than two decimal places.');
  return kobo;
}
export function opayConfiguration(env=process.env){
  const mode=env.OPAY_MODE||'mock';
  if(!['mock','sandbox'].includes(mode))throw new Error('OPAY_MODE must be mock or sandbox. Production payments are not implemented.');
  const statusAuth=env.OPAY_STATUS_AUTH||'public';
  if(!['public','hmac'].includes(statusAuth))throw new Error('OPAY_STATUS_AUTH must be public or hmac.');
  let callbackUrl=env.OPAY_CALLBACK_URL||'';
  if(callbackUrl){
    let url;try{url=new URL(callbackUrl);}catch{throw new Error('OPAY_CALLBACK_URL must be a valid HTTPS URL.');}
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/api/opay/callback')throw new Error('OPAY_CALLBACK_URL must be HTTPS and end in /api/opay/callback without credentials or query parameters.');
    callbackUrl=url.href;
  }
  return {mode,statusAuth,merchantId:env.OPAY_MERCHANT_ID||'',privateKey:env.OPAY_PRIVATE_KEY||'',publicKey:env.OPAY_PUBLIC_KEY||'',callbackUrl};
}
export class OPayAdapter {
  constructor({config=opayConfiguration(),fetcher=fetch}={}){this.config=config;this.fetcher=fetcher;}
  get ready(){const c=this.config;return !!c.merchantId&&!!c.privateKey&&(c.statusAuth==='hmac'||!!c.publicKey);}
  async post(path,payload,{query=false}={}){
    if(this.config.mode!=='sandbox')throw new Error('External OPay requests require explicit sandbox mode.');
    if(!this.ready)throw new Error('Configure OPay staging merchant credentials in the server .env file.');
    if(!['/api/v1/international/payment/create','/api/v1/international/cashier/status'].includes(path))throw new Error('Unsupported staging operation.');
    const body=canonicalJSON(payload),c=this.config;
    const signature=query&&c.statusAuth==='public'?c.publicKey:createHmac('sha512',c.privateKey).update(body).digest('hex');
    let response;
    try{response=await this.fetcher(STAGING+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${signature}`,MerchantId:c.merchantId},body});}
    catch{throw new Error('OPay staging request did not complete. Keep this reference and query its status; do not create another payment blindly.');}
    if(!response.ok)throw new Error(`OPay staging returned HTTP ${response.status}. Query the saved reference before retrying.`);
    let result;try{result=await response.json();}catch{throw new Error('Invalid OPay staging response. Query the saved reference.');}
    if(result.code!=='00000'||!result.data)throw new Error(`OPay staging rejected the request (code ${typeof result.code==='string'&&/^\d{2,8}$/.test(result.code)?result.code:'unknown'}). Confirm merchant permissions and authentication with OPay.`);
    return result.data;
  }
  async create(order){
    const payload={amount:{currency:'NGN',total:order.amountKobo},country:'NG',payMethod:'OpayWalletNgQR',product:{name:'WalletPilot staging integration test',description:'Payment flow verification only; no investment allocation.'},reference:order.reference};
    if(this.config.callbackUrl)payload.callbackUrl=this.config.callbackUrl;
    return this.post('/api/v1/international/payment/create',payload);
  }
  async query(order){return this.post('/api/v1/international/cashier/status',{country:'NG',reference:order.reference},{query:true});}
}

export function callbackContent(payload){
  for(const key of ['reference','transactionId','status','timestamp','currency','amount'])if(typeof payload?.[key]!=='string')throw new Error('Malformed OPay callback payload.');
  if(!identifier(payload.reference)||!identifier(payload.transactionId)||!STATUSES.has(payload.status)||payload.currency!=='NGN'||!/^\d{1,12}$/.test(payload.amount)||!Number.isSafeInteger(Number(payload.amount))||typeof payload.refunded!=='boolean'||!Number.isFinite(Date.parse(payload.timestamp))||!/^[0-9T:.+Z-]+$/.test(payload.timestamp))throw new Error('Malformed OPay callback fields.');
  const token=payload.token??'';
  if(typeof token!=='string'||(token&&!identifier(token)))throw new Error('Malformed callback token.');
  // OPay documents this specific format for callback signatures, distinct from
  // the sorted JSON + SHA-512 format used for outbound API requests.
  return `{Amount:"${payload.amount}",Currency:"${payload.currency}",Reference:"${payload.reference}",Refunded:${payload.refunded?'t':'f'},Status:"${payload.status}",Timestamp:"${payload.timestamp}",Token:"${token}",TransactionID:"${payload.transactionId}"}`;
}
export function verifyCallback(body,key){
  if(!key)throw new Error('OPay callback verification is not configured.');
  if(body?.type!=='transaction-status'||typeof body.sha512!=='string'||! /^[a-f0-9]{128}$/i.test(body.sha512))throw new Error('Invalid OPay callback signature.');
  const expected=createHmac('sha3-512',key).update(callbackContent(body.payload)).digest();
  if(!timingSafeEqual(expected,Buffer.from(body.sha512,'hex')))throw new Error('Invalid OPay callback signature.');
  return body.payload;
}
function verifiedResult(order,data){
  if(data?.reference!==order.reference||data.amount?.currency!=='NGN'||!Number.isSafeInteger(data.amount?.total)||data.amount.total!==order.amountKobo||!identifier(data.orderNo)||!STATUSES.has(data.status))throw new Error('OPay response reference, amount, currency, order number, or status does not match the saved payment.');
  if(order.orderNo&&order.orderNo!==data.orderNo)throw new Error('OPay order number changed. Manual reconciliation required.');
  return data;
}
function publicOrder(order){return {reference:order.reference,requestId:order.requestId,amountKobo:order.amountKobo,currency:'NGN',mode:order.mode,status:order.status,providerStatus:order.providerStatus,orderNo:order.orderNo,createdAt:order.createdAt,updatedAt:order.updatedAt,qrUrl:order.qrUrl||null,error:order.error||null,events:order.events.slice(-15),callbacks:order.callbackDigests.length};}

export class OPayIntegration {
  constructor({file='.runtime/opay-integration.json',adapter=new OPayAdapter(),now=()=>Date.now()}={}){
    this.file=file;this.adapter=adapter;this.now=now;this.queue=Promise.resolve();this.state={version:1,orders:[]};
  }
  async init(){
    if(!this.file)return;
    try{
      const saved=JSON.parse(await readFile(this.file,'utf8'));
      if(saved.version!==1||!Array.isArray(saved.orders))throw new Error('Invalid saved OPay integration state.');
      this.state=saved;
      for(const order of this.state.orders)if(order.status==='CREATING'){order.status='UNKNOWN';order.error='Server restarted during creation. Reconcile this reference before making another payment.';}
      await this.save();
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  async save(){
    if(!this.file)return;
    await mkdir(dirname(this.file),{recursive:true});await writeFile(this.file+'.tmp',JSON.stringify(this.state),{mode:0o600});await rename(this.file+'.tmp',this.file);
  }
  view(){
    const c=this.adapter.config;
    return {target:'OPay Nigeria',mode:c.mode,configured:this.adapter.ready,callbackConfigured:!!c.callbackUrl,statusAuth:c.statusAuth,realMoney:false,embeddedInOPay:false,customerWalletAccess:false,orders:this.state.orders.map(publicOrder).reverse(),capabilities:{walletQRStaging:true,paymentStatus:true,signedCallbacks:true,automaticTradingFunding:false,customerBalance:false,payouts:false},notice:'Independent integration lab. Mock and OPay staging payments never credit or debit the paper-trading wallet. Embedding in OPay requires a separate agreement.'};
  }
  run(action,input={}){
    const task=this.queue.then(async()=>{
      if(action==='status')return this.view();
      await this.command(action,input);return this.view();
    });this.queue=task.catch(()=>{});return task;
  }
  log(order,message){order.events.push({time:new Date(this.now()).toISOString(),message});order.events=order.events.slice(-100);order.updatedAt=new Date(this.now()).toISOString();}
  find(reference){const order=this.state.orders.find(o=>o.reference===reference);if(!order)throw new Error('Unknown saved OPay payment reference.');if(order.mode!==this.adapter.config.mode)throw new Error('This reference belongs to a different integration mode. Restart with the original mode to reconcile it.');return order;}
  apply(order,result){
    const data=verifiedResult(order,result);
    if(TERMINAL.has(order.status)&&data.status!==order.status){order.error='Provider status conflicts with a finalized result. Manual reconciliation required.';this.log(order,order.error);return;}
    if(order.status==='PENDING'&&data.status==='INITIAL'){this.log(order,'Ignored an earlier INITIAL status after PENDING.');return;}
    order.orderNo=data.orderNo;order.status=data.status;order.providerStatus=data.status;order.error=null;
    const qr=data.nextAction?.qrCode;
    if(typeof qr==='string'){
      try{const url=new URL(qr);if(url.protocol==='https:'&&!url.username&&!url.password&&(url.hostname.endsWith('.operapay.com')||url.hostname.endsWith('.opaycheckout.com')))order.qrUrl=url.href;}
      catch{}
    }
    this.log(order,`Verified ${order.mode==='mock'?'local simulation':'OPay staging'} status: ${data.status}. No trading-wallet balance changed.`);
  }
  async reconcile(order){
    if(order.mode==='mock')this.apply(order,{reference:order.reference,orderNo:order.orderNo,amount:{total:order.amountKobo,currency:'NGN'},status:order.providerStatus||'PENDING'});
    else this.apply(order,await this.adapter.query(order));
    await this.save();
  }
  async command(action,input){
    if(action==='create'){
      if(input.consent!==true)throw new Error('Confirm that this is a payment-integration test, not investment funding.');
      if(!identifier(input.requestId))throw new Error('A unique requestId is required.');
      const amountKobo=ngnToKobo(input.amount);
      const existing=this.state.orders.find(o=>o.requestId===input.requestId);
      if(existing){if(existing.amountKobo!==amountKobo||existing.mode!==this.adapter.config.mode)throw new Error('Idempotency key was already used with different payment details.');return;}
      if(this.state.orders.length>=100)throw new Error('This local integration lab is limited to 100 saved payments; archive its state before creating another lab.');
      if(this.adapter.config.mode==='sandbox'&&!this.adapter.ready)throw new Error('Configure server-side OPay staging credentials before creating a sandbox payment.');
      const order={reference:'wp-sbx-'+randomUUID(),requestId:input.requestId,amountKobo,mode:this.adapter.config.mode,status:'CREATING',providerStatus:null,orderNo:null,createdAt:new Date(this.now()).toISOString(),updatedAt:new Date(this.now()).toISOString(),events:[],callbackDigests:[]};
      this.state.orders.push(order);this.log(order,'Payment intent recorded before contacting the provider.');
      try{await this.save();}catch(error){this.state.orders.pop();throw error;}
      try{
        const result=order.mode==='mock'?{reference:order.reference,orderNo:'MOCK-'+randomUUID(),status:'PENDING',amount:{total:amountKobo,currency:'NGN'}}:await this.adapter.create(order);
        this.apply(order,result);
      }catch(error){order.status='UNKNOWN';order.error=error.message;error.reference=order.reference;this.log(order,error.message);await this.save();throw error;}
      try{await this.save();}catch{order.status='UNKNOWN';order.error='Provider result could not be saved. Reconcile the existing reference.';throw new Error(order.error);}
      return;
    }
    if(action==='query'){const order=this.find(input.reference);try{await this.reconcile(order);}catch(error){order.error=error.message;this.log(order,error.message);await this.save();throw error;}return;}
    if(action==='simulate'){
      if(this.adapter.config.mode!=='mock')throw new Error('Simulated outcomes are available only in local mock mode.');
      const order=this.find(input.reference);
      if(!['SUCCESS','FAIL','CLOSE'].includes(input.status))throw new Error('Choose SUCCESS, FAIL, or CLOSE.');
      if(TERMINAL.has(order.status)&&order.status!==input.status)throw new Error('A finalized mock payment cannot be rewritten. Create a new test case.');
      order.providerStatus=input.status;await this.reconcile(order);return;
    }
    if(action==='callback'){
      if(this.adapter.config.mode!=='sandbox')throw new Error('Provider callbacks require sandbox mode. Mock outcomes use the local simulator.');
      const p=verifyCallback(input,this.adapter.config.privateKey),order=this.find(p.reference);
      if(p.country!=='NG'||Number(p.amount)!==order.amountKobo||p.currency!=='NGN'||p.refunded||Date.parse(p.timestamp)>this.now()+300000)throw new Error('Callback does not match the saved non-refund NGN payment.');
      if(order.orderNo&&p.transactionId!==order.orderNo)throw new Error('Callback transaction does not match the saved OPay order.');
      const digest=createHash('sha256').update(callbackContent(p)).digest('hex');
      if(order.callbackDigests.includes(digest))return;
      // Signature alone never finalizes a payment. Query OPay independently.
      await this.reconcile(order);
      if(p.transactionId!==order.orderNo)throw new Error('Callback transaction differs from the queried OPay order.');
      if(order.status!==p.status)this.log(order,'Callback/query disagreed; kept the independently queried provider status.');
      order.callbackDigests.push(digest);order.callbackDigests=order.callbackDigests.slice(-100);
      await this.save();return;
    }
    throw new Error('Unknown OPay integration operation.');
  }
}
