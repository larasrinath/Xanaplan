import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { Store } from '../server/store.mjs';
import { verifyAppDiscovery } from '../server/apps.mjs';
import { answerQuestion } from '../server/chat.mjs';
import { createApp } from '../server/index.mjs';

const models = [
  { key: 'w1:m1', workspaceId: 'w1', workspaceName: 'Finance', modelId: 'm1', name: 'Actuals' },
  { key: 'w2:m2', workspaceId: 'w2', workspaceName: 'Sales', modelId: 'm2', name: 'Forecast' },
];
const app = { appId: 'sample-app', origin: 'https://us1a.app.anaplan.com', tenantId: 'tenant1', tenantName: 'Synthetic tenant', name: 'Business planning', context: 'USD, calendar year. Actual versus forecast. Do not combine alternative environments.', models };
const observed = { ...app, models: models.map(model => ({ id: model.modelId, name: model.name, workspaceName: model.workspaceName })) };
const mcp = {
  discover: async (tool, args) => ({ incomplete: false, items: tool === 'show_workspaces' ? [{ id: 'w1', name: 'Finance' }, { id: 'w2', name: 'Sales' }] : models.filter(model => model.workspaceId === args.workspaceId).map(model => ({ id: model.modelId, name: model.name })) }),
};
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'xanaplan-apps-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, store: new Store(directory) };
}
function request(server, store, method, path, body) {
  return new Promise(resolve => {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    Object.assign(req, { method, url: path, headers: { host: '127.0.0.1:8766', authorization: `Bearer ${store.data.token}`, 'content-type': 'application/json' } });
    const res = new EventEmitter(); res.setHeader = () => {}; res.writeHead = status => { res.status = status; }; res.end = text => resolve({ status: res.status, body: JSON.parse(text) });
    server.emit('request', req, res);
  });
}
test('app context persists with multiple models and rejects stale or empty memberships', t => {
  const { directory, store } = fixture(t), saved = store.saveApp(app);
  assert.deepEqual(new Store(directory).getApp(saved.key), saved);
  assert.equal(saved.models.length, 2);
  assert.throws(() => store.saveApp(app), /changed/);
  assert.throws(() => store.saveApp({ ...saved, models: [] }), /at least one/);
  assert.throws(() => store.saveApp({ ...saved, tenantId: 'other' }), /selected app changed/);
  assert.throws(() => store.removeApp(saved.key, 0), /changed/);
  const previous = store.getApp(saved.key); store.flush = () => { throw new Error('Disk full'); };
  assert.throws(() => store.saveApp({ ...saved, context: 'Unsaved' }), /Disk full/);
  assert.deepEqual(store.getApp(saved.key), previous);
});
test('app identity is tenant/app and does not depend on a selected workspace', t => {
  const { store } = fixture(t);
  const saved = store.saveApp(app);
  assert.equal(saved.key, `${app.origin}|tenant1|sample-app`);
  assert.equal(saved.workspaceId, undefined);
  const updated = store.saveApp({ ...saved, models: [models[1]] });
  assert.equal(updated.key, saved.key);
  assert.equal(updated.models[0].workspaceId, 'w2');
  const other = store.saveApp({ ...app, tenantId: 'tenant2', tenantName: 'Another tenant' });
  assert.notEqual(other.key, saved.key);
  assert.equal(store.listApps().length, 2);
});
test('legacy app context survives offline edits and tenant association', t => {
  const { store } = fixture(t);
  const { tenantId, tenantName, ...old } = app;
  const legacy = { ...old, key: `${app.origin}|w1|sample-app`, workspaceId: 'w1', workspaceName: 'Finance', revision: 1 };
  store.data.apps = [legacy]; store.flush();
  const edited = store.saveApp({ ...legacy, context: 'Preserved business context' });
  assert.equal(edited.key, legacy.key);
  const linked = store.saveApp({ ...edited, tenantId, tenantName });
  assert.equal(linked.key, `${app.origin}|tenant1|sample-app`);
  assert.equal(linked.context, 'Preserved business context');
  assert.equal(store.listApps().length, 1);
});
test('discovery verifies every model ID and workspace, failing on inaccessible and partial lists', async () => {
  const result = await verifyAppDiscovery(observed, mcp);
  assert.deepEqual(result.models, models);
  await assert.rejects(verifyAppDiscovery({ ...observed, tenantId: '' }, mcp), /Tenant/);
  await assert.rejects(verifyAppDiscovery({ ...observed, models: [{ ...observed.models[0], id: 'other' }] }, mcp), /not accessible/);
  const single = await verifyAppDiscovery({ ...observed, models: [observed.models[1]] }, mcp);
  assert.equal(single.models[0].workspaceId, 'w2');
  assert.equal(single.workspaceId, undefined);
  await assert.rejects(verifyAppDiscovery(observed, { discover: async () => ({ items: [], incomplete: true }) }), /incomplete/);
});
test('HTTP save requires a discovery ticket and cannot add arbitrary model keys', async t => {
  const { store } = fixture(t), server = createApp({ store, mcp, providers: {} });
  const call = (method, path, body) => request(server, store, method, path, body);
  assert.equal((await call('POST', '/apps', { ...app, modelKeys: ['w1:m1'] })).status, 409);
  const discovery = await call('POST', '/app-discovery', observed); assert.equal(discovery.status, 200);
  const input = { ticket: discovery.body.ticket, modelKeys: ['w1:m1'], context: app.context, revision: 0 };
  assert.equal((await call('POST', '/apps', { ...input, modelKeys: ['w1:unknown'] })).status, 403);
  const saved = await call('POST', '/apps', input); assert.equal(saved.status, 200); assert.equal(saved.body.app.models.length, 1);
  assert.equal((await call('POST', '/apps', input)).status, 409);
  const edited = await call('POST', '/apps', { key: saved.body.app.key, revision: 1, modelKeys: ['w1:m1'], context: 'Updated' }); assert.equal(edited.status, 200);
  assert.equal((await call('POST', '/apps', { key: saved.body.app.key, revision: 2, modelKeys: ['w2:m2'], context: 'Inject membership' })).status, 403);
});
test('questions route reads across only enabled app models and preserve source provenance', async t => {
  const { store } = fixture(t), saved = store.saveApp(app); let calls = 0;
  const schema = { properties: { workspaceId: {}, modelId: {} }, required: ['workspaceId', 'modelId'] };
  const bridge = { tools: async () => [{ name: 'show_modules', inputSchema: schema }], read: async (tool, args, model) => {
    assert.equal(args.modelKey, undefined); return { text: model.name, arguments: { modelId: model.modelId, workspaceId: model.workspaceId } };
  } };
  const provider = { decide: async payload => {
    assert.equal(payload.app.context, saved.context);
    assert.deepEqual(payload.tools[0].inputSchema.properties.modelKey.enum, ['w1:m1', 'w2:m2']);
    if (calls < 2) return { kind: 'read', tool: 'show_modules', arguments: JSON.stringify({ modelKey: models[calls++].key }) };
    assert.deepEqual(payload.evidence.map(source => source.modelName), ['Actuals', 'Forecast']);
    return { kind: 'answer', answer: 'Synthetic comparison.', sourceIds: [1, 2] };
  } };
  const input = { appKey: saved.key, revision: 1, question: 'How does the forecast compare?' };
  const answer = await answerQuestion({ store, mcp: bridge, provider, input });
  assert.equal(answer.appKey, saved.key); assert.deepEqual(answer.sources.map(source => source.modelKey), ['w1:m1', 'w2:m2']);
  await assert.rejects(answerQuestion({ store, mcp: bridge, provider: { decide: async () => ({ kind: 'read', tool: 'show_modules', arguments: '{"modelKey":"w1:unrelated"}' }) }, input }), /enabled connected models/);
  await assert.rejects(answerQuestion({ store, mcp: bridge, provider: { decide: async () => { store.removeApp(saved.key, 1); return { kind: 'answer', answer: 'Stale', sourceIds: [] }; } }, input }), /not enabled/);
});
