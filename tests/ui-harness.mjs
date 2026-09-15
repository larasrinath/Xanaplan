/*
 * Copyright 2026 Lara Srinath
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Isolated synthetic UI harness. Production helper routes, no real MCP or AI.
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { AppError } from '../server/validation.mjs';
import { request, streamRequest } from './http-client.mjs';
import { app, appId, pageId, secondPageId, model, board, catalog, observation, syntheticMcp } from './fixtures/page.mjs';

const extension = new URL('../extension/', import.meta.url);
const port = Number(process.env.XANAPLAN_UI_PORT ?? 8768);
const directory = mkdtempSync(join(tmpdir(), 'xanaplan-ui-'));
const store = new Store(directory), mcp = syntheticMcp();
let authMode = 'connected', discoveryMode = 'available', pageMode = 'current';
mcp.clientId = () => 'synthetic-client'; mcp.available = () => true; mcp.reset = async () => {};
mcp.discover = async tool => {
  if (authMode === 'login') throw new AppError('Synthetic sign-in required.', 401, { code: 'ANAPLAN_LOGIN', url: 'https://iam.anaplan.com/test-only', userCode: 'SYNTHETIC' });
  if (authMode === 'error') throw new AppError('Synthetic connection failure.', 502);
  return { items: tool === 'show_workspaces' ? [{ id: model.workspaceId, name: model.workspaceName }] : [{ id: model.modelId, name: model.name }], incomplete: false };
};
const providerStatus = { installed: true, loggedIn: true, method: 'SYNTHETIC UI TEST' };
const providers = {
  status: async () => ({ llm: store.getLlm(), provider: { ...providerStatus, id: store.getLlm().provider }, connections: { openai: providerStatus, claude: providerStatus } }),
  test: async body => ({ success: true, provider: body.provider, model: body.model, message: 'Synthetic provider test passed.' }),
  select: () => ({ settings: store.getLlm(), check() {}, decide: async (payload, signal) => {
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new AppError('Question cancelled.', 499)); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 500);
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    });
    if (!payload.evidence.length) {
      const source = payload.pageContext.sources.find(item => !item.unsupported);
      return { kind: 'read', tool: 'read_cells', arguments: JSON.stringify({ modelKey: model.key, sourceId: source.id, moduleId: source.moduleId, viewId: source.viewId,
        ...(payload.question.includes('Feb 26') ? { contextOverrides: [{ dimensionId: '501', itemName: 'Feb 26', questionQuote: 'Feb 26' }] } : {}),
      }) };
    }
    const evidence = payload.evidence[0];
    return { kind: 'answer', answer: evidence.error ? `Synthetic test: ${evidence.error}` : `Synthetic example: Revenue is 120. ${evidence.effectiveFilters.map(filter => `${filter.dimensionName}: ${filter.label}`).join(' · ')}. No live Anaplan or AI calls were made.`, sourceIds: [evidence.id] };
  } }),
};
const helper = createApp({ store, mcp, providers });
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const senderShim = `
import { createDiscoveryService } from './discovery-background.mjs';
import { createPageService } from './page-background.mjs';
import { readAnaplanDiscovery } from './discovery-api.mjs';
import { readPageDefinition } from './page-api.mjs';
const fixtureFetch = (url, options) => fetch('/test/anaplan?route=' + encodeURIComponent(new URL(url).pathname), {signal:options.signal});
const runtime = {id:'synthetic-extension', getURL:path=>'chrome-extension://synthetic-extension/'+path};
const sender = {id:runtime.id,url:runtime.getURL('panel.html')};
const discoveryService = createDiscoveryService({runtime},{read:(input,options)=>readAnaplanDiscovery(input,{...options,fetchImpl:fixtureFetch})});
const pageService = createPageService({runtime},{read:(input,options)=>readPageDefinition(input,{...options,fetchImpl:fixtureFetch}),observe:async()=>{const response=await fetch('/test/page');return response.json();}});
const syntheticChrome = {runtime:{sendMessage:async message=>{try{return await (message.target==='page-background'?pageService:discoveryService)(message,sender);}catch(error){return {ok:false,error:error.message,code:error.code};}}}};
`;
const assets = new Set(['panel.html', 'panel.js', 'panel.css', 'local-api.mjs', 'chat-stream.mjs', 'question-progress.mjs', 'answer-markdown.mjs', 'conversation-view.mjs', 'chat-history.mjs', 'searchable-select.mjs', 'anaplan-auth.mjs', 'discovery-input.mjs', 'discovery-cache.mjs', 'discovery-api.mjs', 'discovery-background.mjs', 'page-api.mjs', 'page-observer.mjs', 'page-background.mjs', 'page-panel.mjs']);
assets.add('welcome.mjs'); assets.add('assets/xanaplan-logo.png');
const server = createServer(async (req, res) => {
  if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, {});
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    let input = ''; for await (const chunk of req) { input += chunk; if (input.length > 180000) return send(res, 413, {}); }
    if (url.pathname.startsWith('/api/')) {
      if (['/api/chat', '/api/page-context'].includes(url.pathname) && input && JSON.parse(input).stream) {
        const controller = new AbortController();
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        const response = await streamRequest(helper, store, req.method, url.pathname.slice(4), JSON.parse(input), { signal: controller.signal });
        res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') });
        for await (const chunk of response.body) { if (res.destroyed) break; res.write(chunk); }
        if (!res.destroyed) res.end();
        return;
      }
      const result = await request(helper, store, req.method, url.pathname.slice(4) + url.search, input ? JSON.parse(input) : undefined);
      return send(res, result.status, result.body);
    }
    if (url.pathname === '/test/auth') { authMode = new URLSearchParams(input).get('mode') || authMode; return send(res, 200, { mode: authMode }); }
    if (url.pathname === '/test/discovery') { discoveryMode = new URLSearchParams(input).get('mode') || discoveryMode; return send(res, 200, { mode: discoveryMode }); }
    if (url.pathname === '/test/page') {
      pageMode = new URLSearchParams(input).get('mode') || pageMode;
      const snapshot = structuredClone(observation);
      if (pageMode === 'february') snapshot.selections[0].label = 'Feb 26';
      if (pageMode === 'unknown') snapshot.selections = [];
      if (pageMode === 'outside') snapshot.url = 'https://example.com';
      return send(res, 200, snapshot);
    }
    if (url.pathname === '/test/anaplan') {
      if (discoveryMode === 'login') return send(res, 401, {});
      if (discoveryMode === 'unavailable') return send(res, 503, {});
      const root = '/a/springboard-definition-service';
      const bodies = {
        '/a/springboard-platform-gateway-service/customers': { customers: [{ customerGuid: app.tenantId, customerName: app.tenantName, selectedCustomer: true }] },
        [`${root}/customer/${app.tenantId}/apps`]: { customerId: app.tenantId, items: [{ guid: appId, name: app.name }] },
        [`${root}/apps/${appId}`]: catalog,
        [`${root}/pagemodels/app/${appId}`]: { pages: [{ models: [{ modelId: model.modelId, modelName: model.name, workspaceName: model.workspaceName }] }] },
        [`${root}/boards/${pageId}`]: board,
        [`${root}/grid-pages/${secondPageId}`]: { ...board, pageGuid: secondPageId, name: 'Costs', dataSourceId: '101', widgets: [{ widgetDefinition: board.widgets.budget }] },
      };
      const data = bodies[url.searchParams.get('route')]; return send(res, data ? 200 : 404, data || {});
    }
    if (url.pathname === '/') {
      const width = [320, 400, 960].includes(Number(url.searchParams.get('width'))) ? Number(url.searchParams.get('width')) : 400;
      res.setHeader('Content-Type', 'text/html');
      return res.end(`<!doctype html><html><head><title>Xanaplan synthetic test</title></head><body style="background:#e7eeea;font:14px system-ui"><p style="text-align:center">Synthetic test only · isolated settings · no Anaplan or AI calls</p><div style="display:flex;gap:12px;justify-content:center;margin:12px"><label>Access <select data-fixture="auth"><option>connected</option><option>login</option><option>error</option></select></label><label>Discovery <select data-fixture="discovery"><option>available</option><option>login</option><option>unavailable</option></select></label><label>Tab context <select data-fixture="page"><option>current</option><option>february</option><option>unknown</option><option>outside</option></select></label></div><iframe title="Extension panel under test" src="/panel.html" style="display:block;width:${width}px;max-width:100%;height:calc(100vh - 110px);border:1px solid #bbcabc;margin:auto;background:white"></iframe><script>document.querySelectorAll('[data-fixture]').forEach(select=>select.addEventListener('change',()=>fetch('/test/'+select.dataset.fixture,{method:'POST',body:new URLSearchParams({mode:select.value})})));</script></body></html>`);
    }
    if (url.pathname === '/local-config.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(`export const connection={baseUrl:'http://127.0.0.1:${port}/api',token:'synthetic-test-only'};`); }
    if (['/app-discovery.mjs', '/page-tracker.mjs'].includes(url.pathname)) {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(senderShim + readFileSync(new URL(url.pathname.slice(1), extension), 'utf8').replace('chromeApi = globalThis.chrome', 'chromeApi = syntheticChrome'));
    }
    const file = url.pathname.slice(1);
    if (!assets.has(file)) return send(res, 404, {});
    res.setHeader('Content-Type', /\.(mjs|js)$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html');
    return res.end(readFileSync(new URL(file, extension)));
  } catch (error) { return send(res, 500, { error: `Synthetic harness: ${error.message}` }); }
});
const cleanup = () => { server.close(); rmSync(directory, { recursive: true, force: true }); };
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
server.listen(port, '127.0.0.1', () => console.log(`Synthetic UI harness at http://127.0.0.1:${port}. No Anaplan or AI calls.`));
