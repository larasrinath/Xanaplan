import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AppError, identifier } from './validation.mjs';
import { validateLlmChoice } from './llm-settings.mjs';
import { acceptRequest, sendJson, jsonBody } from './http.mjs';
import { answerQuestion } from './chat.mjs';
import { verifyAppDiscovery } from './apps.mjs';

export function createApp({ store, mcp, providers, port = 8766 }) {
  let activeQuestion = false;
  let testingConnection = false;
  const workspaceCache = new Map();
  const modelCache = new Map();
  const appDiscoveries = new Map();
  let connectionEpoch = 0;
  const connectionSettings = () => ({
    clientId: mcp.clientId() || '',
    source: store.data.anaplanClientId ? 'saved' : mcp.clientId() ? 'detected' : null,
    savedAt: store.data.anaplanConnectionSavedAt ?? null,
  });
  return createServer(async (req, res) => {
    if (!acceptRequest(req, res, store.data.token, port)) return;
    const send = (status, body) => sendJson(res, status, body);
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (req.method === 'GET' && url.pathname === '/status') {
        const aiStatus = await providers.status();
        return send(200, { local: true, readOnly: true, mcpAvailable: mcp.available(), anaplanConfigured: Boolean(mcp.clientId()), ...aiStatus });
      }
      if (req.method === 'GET' && url.pathname === '/llm') return send(200, { llm: store.getLlm() });
      if (req.method === 'POST' && url.pathname === '/llm') {
        const body = await jsonBody(req);
        if (activeQuestion || testingConnection) throw new AppError('Wait for the current answer or connection test before changing AI settings.', 409);
        const choice = validateLlmChoice(body);
        return send(200, { llm: store.saveLlm({ ...choice, revision: body.revision }) });
      }
      if (req.method === 'POST' && url.pathname === '/llm/test') {
        const body = await jsonBody(req);
        if (activeQuestion || testingConnection) throw new AppError('Wait for the current answer or connection test to finish.', 409);
        testingConnection = true;
        try { return send(200, await providers.test(body, controller.signal)); }
        finally { testingConnection = false; }
      }
      if (req.method === 'GET' && url.pathname === '/connection') return send(200, { connection: connectionSettings() });
      if (req.method === 'POST' && url.pathname === '/connection') {
        if (activeQuestion) throw new AppError('Wait for the current answer before changing the connection.', 409);
        const body = await jsonBody(req);
        store.saveConnection(body.clientId);
        connectionEpoch++;
        await mcp.reset(); workspaceCache.clear(); modelCache.clear(); appDiscoveries.clear();
        return send(200, { saved: true, connection: connectionSettings() });
      }
      if (req.method === 'GET' && url.pathname === '/workspaces') {
        const result = await mcp.discover('show_workspaces', { ...(url.searchParams.get('search') ? { search: url.searchParams.get('search') } : {}) });
        result.items.forEach(item => workspaceCache.set(item.id, item));
        return send(200, result);
      }
      if (req.method === 'GET' && url.pathname === '/available-models') {
        const workspaceId = identifier(url.searchParams.get('workspaceId'), 'Workspace');
        const result = await mcp.discover('show_models', { workspaceId, ...(url.searchParams.get('search') ? { search: url.searchParams.get('search') } : {}) });
        result.items.forEach(item => modelCache.set(`${workspaceId}:${item.id}`, item));
        return send(200, result);
      }
      if (req.method === 'GET' && url.pathname === '/models') return send(200, { models: store.list() });
      if (req.method === 'GET' && url.pathname === '/apps') return send(200, { apps: store.listApps(), legacyModelCount: store.list().length });
      if (req.method === 'POST' && url.pathname === '/app-discovery') {
        if (activeQuestion) throw new AppError('Wait for the current answer before discovering app models.', 409);
        const epoch = connectionEpoch;
        const discovery = await verifyAppDiscovery(await jsonBody(req), mcp);
        if (epoch !== connectionEpoch) throw new AppError('The Anaplan connection changed. Reload connected models.', 409);
        const ticket = randomUUID();
        for (const [key, value] of appDiscoveries) if (value.expires < Date.now()) appDiscoveries.delete(key);
        if (appDiscoveries.size >= 50) appDiscoveries.delete(appDiscoveries.keys().next().value);
        appDiscoveries.set(ticket, { discovery, expires: Date.now() + 30 * 60 * 1000 });
        return send(200, { discovery, ticket });
      }
      if (req.method === 'POST' && url.pathname === '/apps') {
        const body = await jsonBody(req);
        // Saved context can be edited offline. Membership changes require fresh discovery.
        const known = body.key ? store.getApp(body.key) : null;
        let source = known;
        if (!known || body.ticket) {
          const cached = appDiscoveries.get(body.ticket);
          if (!cached || cached.expires < Date.now()) throw new AppError('Reload connected models before saving; discovery has expired.', 409);
          source = cached.discovery;
          if (known && (source.appId !== known.appId || (known.tenantId && source.tenantId !== known.tenantId) || source.origin !== known.origin)) throw new AppError('The selected app changed. Reload before saving.', 409);
        }
        if (!Array.isArray(body.modelKeys) || !body.modelKeys.length || new Set(body.modelKeys).size !== body.modelKeys.length) throw new AppError('Select the connected models to use.');
        const models = body.modelKeys.map(key => {
          const model = source.models.find(model => model.key === key);
          if (!model) throw new AppError('Only verified connected models can be enabled.', 403);
          return model;
        });
        return send(200, { app: store.saveApp({ ...source, ...(known ? { key: known.key } : {}), models, context: body.context, revision: body.revision }) });
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/apps/')) {
        const body = await jsonBody(req);
        store.removeApp(decodeURIComponent(url.pathname.slice('/apps/'.length)), body.revision);
        return send(200, { removed: true });
      }
      if (req.method === 'POST' && url.pathname === '/models') {
        const body = await jsonBody(req);
        const workspaceId = identifier(body.workspaceId, 'Workspace');
        const modelId = identifier(body.modelId, 'Model');
        const known = store.list().find(model => model.key === `${workspaceId}:${modelId}`);
        // Existing context can be edited offline. New models must come from a successful discovery in this local session.
        const discovered = modelCache.get(`${workspaceId}:${modelId}`);
        const workspace = workspaceCache.get(workspaceId);
        if (!known && (!discovered || !workspace)) throw new AppError('Connect to Anaplan and select a workspace and model first.', 409);
        const model = store.save({ ...body, name: known?.name ?? discovered.name, workspaceName: known?.workspaceName ?? workspace.name });
        return send(200, { model });
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/models/')) {
        const body = await jsonBody(req);
        store.remove(decodeURIComponent(url.pathname.slice('/models/'.length)), body.revision);
        return send(200, { removed: true });
      }
      if (req.method === 'POST' && url.pathname === '/chat') {
        const input = await jsonBody(req);
        if (activeQuestion || testingConnection) throw new AppError('Another question or connection test is running. Wait for it to finish.', 409);
        const provider = providers.select(input);
        activeQuestion = true;
        try {
          const answer = await answerQuestion({ store, mcp, provider, input, signal: controller.signal });
          provider.check();
          return send(200, { ...answer, llm: { provider: provider.settings.provider, model: provider.settings.model, revision: provider.settings.revision } });
        }
        finally { activeQuestion = false; }
      }
      return send(404, { error: 'Not found.' });
    } catch (error) {
      return send(error.status ?? 500, { error: error.status ? error.message : 'The local helper encountered an error. Restart it and retry.', ...(error.details ?? {}) });
    }
  });
}
