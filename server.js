import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BotService } from './backend/service.js';
import { OPayIntegration } from './backend/opay.js';

try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const routes = { '/api/market': 'market', '/api/import': 'import', '/api/allocate': 'allocate', '/api/bot/start': 'start', '/api/bot/pause': 'pause', '/api/bot/step': 'step', '/api/withdraw': 'withdraw', '/api/reset': 'reset', '/api/backtest': 'backtest' };
Object.assign(routes,{'/api/observer/start':'observerStart','/api/observer/stop':'observerStop','/api/observer/refresh':'observerRefresh','/api/models/train':'train','/api/models/promote':'promote'});
const assets = new Map([
  ['/', ['index.html','text/html']], ['/demo.html',['demo.html','text/html']],
  ['/opay',['opay.html','text/html']],['/opay.html',['opay.html','text/html']],
  ...['style.css','bot.css','learning.css','opay.css','app.js','bot.js','opay.js','engine.js'].map(name => [`/src/${name}`, [`src/${name}`, name.endsWith('.css') ? 'text/css' : 'text/javascript']]),
]);
const json = (res, code, data) => res.writeHead(code,{ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options':'nosniff' }).end(JSON.stringify(data));
export function createHandler(service,integration=new OPayIntegration({file:null})) {
  return async (req,res) => {
    try {
      const host = req.headers.host;
      const path = new URL(req.url,'http://localhost').pathname;
      const localHost=!!host&&/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
      const callbackHost=integration.adapter.config.callbackUrl?new URL(integration.adapter.config.callbackUrl).host:null;
      const callback=path==='/api/opay/callback';
      if (!localHost&&!(callback&&callbackHost&&host===callbackHost)) return json(res,403,{ error: 'Use the local localhost address.' });
      if (path === '/api/status' && req.method === 'GET') return json(res,200,await service.run('status'));
      if(path==='/api/opay/status'&&req.method==='GET')return json(res,200,await integration.run('status'));
      if (path.startsWith('/api/')) {
        const opayRoutes={'/api/opay/payments/create':'create','/api/opay/payments/query':'query','/api/opay/payments/simulate':'simulate','/api/opay/callback':'callback'};
        if (req.method !== 'POST' || (!routes[path]&&!opayRoutes[path])) return json(res,404,{ error: 'Unknown API route.' });
        if (!callback&&req.headers.origin && req.headers.origin !== `http://${host}`) return json(res,403,{ error:'Cross-origin commands are blocked.' });
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res,415,{ error:'Use application/json.' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1000000) return json(res,413,{ error:'Request body too large.' }); }
        let input;
        try { input = JSON.parse(body || '{}'); } catch { return json(res,400,{ error:'Invalid JSON.' }); }
        if (!input || Array.isArray(input) || typeof input !== 'object') return json(res,400,{ error:'Expected a JSON object.' });
        if(opayRoutes[path]){
          try{const result=await integration.run(opayRoutes[path],input);return json(res,200,callback?{received:true}:result);}
          catch(error){return json(res,callback?503:400,{error:error.message,...(error.reference?{reference:error.reference}:{})});}
        }
        return json(res,200,await service.run(routes[path],input));
      }
      if (req.method !== 'GET' || !assets.has(path)) return json(res,404,{ error:'Not found.' });
      const [file,type] = assets.get(path);
      const body = await readFile(file);
      res.writeHead(200,{ 'Content-Type': type+'; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; frame-src 'self'; base-uri 'none'; frame-ancestors 'self'" }).end(body);
    } catch (error) { json(res,400,{ error: error.message }); }
  };
}
export async function startServer() {
  const service = new BotService(); await service.init();
  const integration=new OPayIntegration();await integration.init();
  const server = createServer(createHandler(service,integration));
  const timer = setInterval(() => {
    service.run('observerTick').catch(() => {});
    service.run('autoTick').catch(() => {});
  },1000);
  timer.unref(); server.on('close',() => clearInterval(timer));
  server.on('error', error => { clearInterval(timer); console.error(`Cannot start local server: ${error.message}`); process.exitCode = 1; });
  server.listen(Number(process.env.PORT || 3000),'127.0.0.1',() => console.log(`WalletPilot bot: http://localhost:${process.env.PORT || 3000}`));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await startServer();
