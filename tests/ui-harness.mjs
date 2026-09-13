// Synthetic UI acceptance harness. No credentials, real models, MCP, or AI calls.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const extension = new URL('../extension/', import.meta.url);
const port = 8768;
let models = [];
let apps = [];
let llm = { provider: 'claude', model: '', revision: 1, models: { claude: '', openai: '' } };
let anaplanConnection = { clientId: 'synthetic-detected-client', source: 'detected', savedAt: null };
let authMode = 'connected';
let discoveryMode = 'available';
let aiMode = 'connected';
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const server = createServer(async (req, res) => {
  if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, {});
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/tenant-reader') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(readFileSync(new URL('tenant-reader.html', import.meta.url)));
  }
  if (url.pathname === '/test/auth' && req.method === 'POST') {
    let input = ''; for await (const chunk of req) input += chunk;
    const mode = new URLSearchParams(input).get('mode');
    if (!['connected', 'login', 'error'].includes(mode)) return send(res, 400, {});
    authMode = mode;
    return send(res, 200, { mode });
  }
  if (url.pathname === '/test/discovery') {
    if (req.method === 'POST') {
      let input = ''; for await (const chunk of req) input += chunk;
      const mode = new URLSearchParams(input).get('mode');
      if (!['available', 'unavailable'].includes(mode)) return send(res, 400, {});
      discoveryMode = mode;
    }
    return send(res, 200, { mode: discoveryMode });
  }
  if (url.pathname.startsWith('/api/')) {
    let input = ''; for await (const chunk of req) input += chunk;
    const body = input ? JSON.parse(input) : {};
    const fakeStatus = { installed: aiMode !== 'unavailable', loggedIn: aiMode === 'connected', method: 'SYNTHETIC UI TEST' };
    if (url.pathname === '/api/connection' && req.method === 'GET') return send(res, 200, { connection: anaplanConnection });
    if (url.pathname === '/api/connection' && req.method === 'POST') {
      await new Promise(resolve => setTimeout(resolve, 1200));
      if (body.clientId === 'synthetic-save-error') return send(res, 500, { error: 'Synthetic save failure. Please retry.' });
      if (!body.clientId?.trim()) return send(res, 400, { error: 'Anaplan OAuth client ID is required.' });
      anaplanConnection = { clientId: body.clientId.trim(), source: 'saved', savedAt: new Date().toISOString() };
      return send(res, 200, { saved: true, connection: anaplanConnection });
    }
    if (url.pathname === '/api/status') return send(res, 200, { local: true, readOnly: true, mcpAvailable: true, anaplanConfigured: true, llm, provider: { ...fakeStatus, id: llm.provider, label: llm.provider === 'openai' ? 'OpenAI' : 'Claude', model: llm.model }, connections: { openai: fakeStatus, claude: fakeStatus } });
    if (url.pathname === '/api/llm' && req.method === 'GET') return send(res, 200, { llm });
    if (url.pathname === '/api/llm' && req.method === 'POST') {
      if (body.revision !== llm.revision) return send(res, 409, { error: 'AI settings changed.' });
      llm = { ...llm, provider: body.provider, model: body.model.trim(), models: { ...llm.models, [body.provider]: body.model.trim() }, revision: llm.revision + 1 };
      return send(res, 200, { llm });
    }
    if (url.pathname === '/api/llm/test') return send(res, 200, { success: true, provider: body.provider, model: body.model, message: 'Synthetic connection test passed. No AI provider was contacted.' });
    if (url.pathname === '/api/workspaces') {
      await new Promise(resolve => setTimeout(resolve, 1200));
      if (authMode === 'login') return send(res, 401, { code: 'ANAPLAN_LOGIN', error: 'Sign in to Anaplan, then select “Check connection” to continue.', url: 'https://iam.anaplan.com/test-only', userCode: 'SYNTHETIC' });
      if (authMode === 'error') return send(res, 502, { error: 'Synthetic Anaplan connection failure. Please retry.' });
      return send(res, 200, { items: [{ id: 'testworkspace', name: 'Synthetic workspace' }], incomplete: false });
    }
    if (url.pathname === '/api/apps' && req.method === 'GET') return send(res, 200, { apps, legacyModelCount: 0 });
    if (url.pathname === '/api/app-discovery') {
      await new Promise(resolve => setTimeout(resolve, 600));
      return send(res, 200, { ticket: 'synthetic-ticket', discovery: { appId: body.appId, origin: body.origin, name: body.name, tenantId: body.tenantId, tenantName: body.tenantName, models: [
        { key: 'testworkspace:testmodel', workspaceId: 'testworkspace', workspaceName: 'Synthetic workspace', modelId: 'testmodel', name: 'Synthetic sales model' },
        { key: 'testworkspace:forecastmodel', workspaceId: 'testworkspace', workspaceName: 'Synthetic workspace', modelId: 'forecastmodel', name: 'Synthetic forecast model' },
      ] } });
    }
    if (url.pathname === '/api/apps' && req.method === 'POST') {
      await new Promise(resolve => setTimeout(resolve, 600));
      const existing = apps[0];
      if ((body.revision ?? 0) !== (existing?.revision ?? 0)) return send(res, 409, { error: 'App context changed.' });
      const app = { key: 'https://us1a.app.anaplan.com|testtenant|00000000-0000-0000-0000-000000000001', appId: '00000000-0000-0000-0000-000000000001', origin: 'https://us1a.app.anaplan.com', tenantId: 'testtenant', tenantName: 'Synthetic tenant', name: 'Synthetic business planning', context: body.context, revision: (existing?.revision ?? 0) + 1, savedAt: new Date().toISOString(), models: body.modelKeys.map(key => ({ key, workspaceId: 'testworkspace', workspaceName: 'Synthetic workspace', modelId: key.split(':')[1], name: key.endsWith(':testmodel') ? 'Synthetic sales model' : 'Synthetic forecast model' })) };
      apps = [app]; return send(res, 200, { app });
    }
    if (url.pathname.startsWith('/api/apps/') && req.method === 'DELETE') { apps = []; return send(res, 200, { removed: true }); }
    if (url.pathname === '/api/available-models') return send(res, 200, { items: [{ id: 'testmodel', name: 'Synthetic sales model' }], incomplete: false });
    if (url.pathname === '/api/models' && req.method === 'GET') return send(res, 200, { models });
    if (url.pathname === '/api/models' && req.method === 'POST') {
      const existing = models[0];
      if ((body.revision ?? 0) !== (existing?.revision ?? 0)) return send(res, 409, { error: 'Context changed.' });
      const model = { ...body, key: `${body.workspaceId}:${body.modelId}`, name: 'Synthetic sales model', workspaceName: 'Synthetic workspace', revision: (existing?.revision ?? 0) + 1, savedAt: new Date().toISOString() }; models = [model]; return send(res, 200, { model });
    }
    if (url.pathname.startsWith('/api/models/') && req.method === 'DELETE') { models = []; return send(res, 200, { removed: true }); }
    if (url.pathname === '/api/chat') return send(res, 200, { answer: 'SYNTHETIC UI TEST — no live data or AI was used.\n\nRevenue of USD 120k is USD 20k (20%) above a USD 100k budget for this test period.', appKey: body.appKey, revision: body.revision, sources: [{ id: 1, modelName: 'Synthetic sales model', tool: 'read_cells', arguments: { moduleId: 'testmodule', viewId: 'testview', maxRows: 500 }, readAt: new Date().toISOString(), partial: false, rowLimit: 500 }] });
    return send(res, 404, {});
  }
  if (url.pathname === '/') {
    if (['connected', 'signedout', 'unavailable'].includes(url.searchParams.get('ai'))) aiMode = url.searchParams.get('ai');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<!doctype html><html lang="en"><title>Xanaplan · SYNTHETIC UI TEST</title><body style="margin:0;background:#dfe5dc;font:12px system-ui;color:#193d37"><p style="text-align:center">SYNTHETIC UI TEST · no Anaplan connection · no AI calls</p><div style="text-align:center;margin:12px"><label for="auth-fixture">Simulated Anaplan response </label><select id="auth-fixture"><option value="connected" ${authMode === 'connected' ? 'selected' : ''}>Connected</option><option value="login" ${authMode === 'login' ? 'selected' : ''}>Sign-in needed</option><option value="error" ${authMode === 'error' ? 'selected' : ''}>Connection error</option></select><span id="fixture-status" role="status"></span></div><div style="text-align:center;margin:12px"><label for="discovery-fixture">Synthetic discovery </label><select id="discovery-fixture"><option value="available" ${discoveryMode === 'available' ? 'selected' : ''}>Available</option><option value="unavailable" ${discoveryMode === 'unavailable' ? 'selected' : ''}>Temporarily unavailable</option></select></div><iframe title="Extension panel under test" src="/panel.html" style="display:block;width:${[320,400,960].includes(Number(url.searchParams.get('width'))) ? Number(url.searchParams.get('width')) : 400}px;max-width:100%;height:calc(100vh - 100px);border:1px solid #bbcabc;margin:auto;background:#fff"></iframe><script>document.getElementById('discovery-fixture').addEventListener('change',async event=>{await fetch('/test/discovery',{method:'POST',body:new URLSearchParams({mode:event.target.value})});document.getElementById('fixture-status').textContent=' Discovery response ready.';});document.getElementById('auth-fixture').addEventListener('change', async event => {await fetch('/test/auth',{method:'POST',body:new URLSearchParams({mode:event.target.value})});document.getElementById('fixture-status').textContent=' Test response ready.';});</script></body></html>`);
  }
  if (url.pathname === '/local-config.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(`export const connection = {baseUrl:'http://127.0.0.1:${port}/api',token:'synthetic-test-only'};`); }
  if (url.pathname === '/app-discovery.mjs') {
    // Exercise the real background service and API parser with synthetic GET responses.
    // No request below is sent to Anaplan; browser session authentication is untested here.
    const shim = `import { createDiscoveryService } from './discovery-background.mjs';
    import { readAnaplanDiscovery } from './discovery-api.mjs';
    const syntheticFetch = async (url, options) => {
      if(options.method !== 'GET' || options.credentials !== 'include') throw new Error('Unexpected synthetic request');
      const fixture = await (await fetch('/test/discovery',{signal:options.signal})).json();
      if(fixture.mode === 'unavailable') return new Response('Synthetic outage',{status:503});
      await new Promise((resolve,reject) => {
        const abort = () => {clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};
        const timer = setTimeout(() => {options.signal.removeEventListener('abort',abort);resolve();}, 900);
        options.signal.addEventListener('abort',abort,{once:true});
        if(options.signal.aborted) abort();
      });
      const path = new URL(url).pathname, appId = '00000000-0000-0000-0000-000000000001';
      const bodies = {
        '/a/springboard-platform-gateway-service/customers': {customers:[{customerGuid:'testtenant',customerName:'Synthetic tenant',selectedCustomer:true},{customerGuid:'emptytenant',customerName:'Synthetic empty tenant'}]},
        '/a/springboard-definition-service/customer/testtenant/apps': {customerId:'testtenant',items:[{guid:appId,name:'Synthetic business planning'},{guid:'00000000-0000-0000-0000-000000000002',name:'Capital planning'},{guid:'00000000-0000-0000-0000-000000000003',name:'Supply chain'},{guid:'00000000-0000-0000-0000-000000000004',name:'Café revenue planning'}]},
        '/a/springboard-definition-service/customer/emptytenant/apps': {customerId:'emptytenant',items:[]},
        ['/a/springboard-definition-service/apps/'+appId]: {guid:appId,customerId:'testtenant'},
        ['/a/springboard-definition-service/pagemodels/app/'+appId]: {pages:[{models:[{modelId:'A'.repeat(32),modelName:'Synthetic sales model',workspaceName:'Synthetic workspace'},{modelId:'B'.repeat(32),modelName:'Synthetic forecast model',workspaceName:'Synthetic workspace'}]}]},
      };
      if(!Object.hasOwn(bodies,path)) throw new Error('Unexpected synthetic route');
      return new Response(JSON.stringify(bodies[path]),{headers:{'Content-Type':'application/json'}});
    };
    const runtime = {id:'synthetic-extension',getURL:file=>'chrome-extension://synthetic-extension/'+file};
    const service = createDiscoveryService({runtime},{read:(input,options)=>readAnaplanDiscovery(input,{...options,fetchImpl:syntheticFetch})});
    const syntheticChrome = {runtime:{sendMessage:message=>service(message,{id:runtime.id,url:runtime.getURL('panel.html')})}};`;
    res.setHeader('Content-Type', 'text/javascript');
    return res.end(shim + readFileSync(new URL('app-discovery.mjs', extension), 'utf8').replace('chromeApi = globalThis.chrome', 'chromeApi = syntheticChrome'));
  }
  const file = url.pathname.slice(1);
  if (!['panel.html', 'panel.js', 'panel.css', 'searchable-select.mjs', 'anaplan-auth.mjs', 'discovery-runner.mjs', 'discovery-cache.mjs', 'discovery-dom.js', 'discovery-api.mjs', 'discovery-background.mjs'].includes(file)) return send(res, 404, {});
  res.setHeader('Content-Type', /\.(mjs|js)$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(readFileSync(new URL(file, extension)));
});
server.listen(port, '127.0.0.1', () => console.log(`Synthetic UI harness at http://127.0.0.1:${port}. No Anaplan or AI calls.`));
