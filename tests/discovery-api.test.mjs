import test from 'node:test';
import assert from 'node:assert/strict';
import { readAnaplanDiscovery } from '../extension/discovery-api.mjs';

const origin = 'https://us1a.app.anaplan.com';
const appId = '00000000-0000-0000-0000-000000000001';
const customersPath = '/a/springboard-platform-gateway-service/customers';
const definition = '/a/springboard-definition-service';
const appsPath = `${definition}/customer/t2/apps`;
const detailsPath = `${definition}/apps/${appId}?includeUnpublished=true&includeReportPages=true`;
const modelsPath = `${definition}/pagemodels/app/${appId}?includeReportPages=true&includeArchived=false`;
const customers = { customers: [
  { customerGuid: 't1', customerName: 'Synthetic first tenant', selectedCustomer: true },
  { customerGuid: 't2', customerName: 'Synthetic chosen tenant', selectedCustomer: false },
] };
const catalog = { customerId: 't2', items: [{ guid: appId, name: 'Synthetic app' }] };
const model = { modelId: 'A'.repeat(32), modelName: 'Synthetic model', workspaceName: 'Synthetic workspace' };
const pages = { pages: [{ models: [model] }, { models: [model, { ...model, modelId: 'B'.repeat(32), modelName: 'Second model' }] }] };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function fixture(overrides = {}) {
  const calls = [];
  const bodies = { [customersPath]: customers, [appsPath]: catalog, [detailsPath]: { guid: appId, customerId: 't2' }, [modelsPath]: pages, ...overrides };
  return { calls, fetchImpl: async (url, options) => {
    const parsed = new URL(url), path = parsed.pathname + parsed.search;
    assert.equal(parsed.origin, origin); assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'include'); assert.equal(options.redirect, 'manual');
    assert.equal(options.cache, 'no-store'); assert.equal(options.headers.Accept, 'application/json');
    assert.equal(options.headers['x-api-version'], path === detailsPath ? '2' : '1');
    assert.equal(options.body, undefined); assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined);
    calls.push(path); assert.ok(Object.hasOwn(bodies, path), `Unexpected request: ${path}`);
    const value = typeof bodies[path] === 'function' ? bodies[path]() : bodies[path];
    return value instanceof Response ? value : json(value);
  } };
}

test('one GET lists all tenants; discovery does not enumerate every tenant catalog', async () => {
  const f = fixture(); const result = await readAnaplanDiscovery({ origin }, f);
  assert.deepEqual(f.calls, [customersPath]);
  assert.equal(result.selectedId, 't1'); assert.equal(result.items.length, 2);
  assert.equal(result.items[1].id, 't2'); assert.equal(result.kind, 'tenants');
});

test('catalog reads target the chosen tenant without switching the active tenant', async () => {
  const f = fixture(); const result = await readAnaplanDiscovery({ origin, tenantId: 't2' }, f);
  assert.deepEqual(f.calls, [customersPath, appsPath]);
  assert.equal(result.tenantName, 'Synthetic chosen tenant'); assert.equal(result.tenantId, 't2');
  assert.deepEqual(result.items, [{ id: appId, name: 'Synthetic app' }]);
});

test('single-tenant accounts need no menu or selected marker, and empty app catalogs are valid', async () => {
  const f = fixture({ [customersPath]: { customers: [customers.customers[1]] }, [appsPath]: { items: [] } });
  assert.equal((await readAnaplanDiscovery({ origin }, f)).selectedId, '');
  assert.deepEqual((await readAnaplanDiscovery({ origin, tenantId: 't2' }, f)).items, []);
});

test('Show models data is deduplicated across pages, with app ownership checked before and after', async () => {
  const f = fixture(); const result = await readAnaplanDiscovery({ origin, tenantId: 't2', appId }, f);
  assert.deepEqual(f.calls, [customersPath, detailsPath, modelsPath, detailsPath]);
  assert.deepEqual(result.models, [
    { id: model.modelId, name: model.modelName, workspaceName: model.workspaceName },
    { id: 'B'.repeat(32), name: 'Second model', workspaceName: model.workspaceName },
  ]);
  assert.equal(result.tenantId, 't2'); assert.equal(result.kind, 'models');
});

test('inaccessible tenants and wrong-tenant app responses stop before model reads', async () => {
  const unavailable = fixture();
  await assert.rejects(readAnaplanDiscovery({ origin, tenantId: 't3', appId }, unavailable), /no longer available/);
  assert.deepEqual(unavailable.calls, [customersPath]);
  const wrong = fixture({ [detailsPath]: { customerId: 't1', guid: appId } });
  await assert.rejects(readAnaplanDiscovery({ origin, tenantId: 't2', appId }, wrong), /selected tenant/);
  assert.deepEqual(wrong.calls, [customersPath, detailsPath]);
  const catalogWrong = fixture({ [appsPath]: { ...catalog, customerId: 't1' } });
  await assert.rejects(readAnaplanDiscovery({ origin, tenantId: 't2' }, catalogWrong), /different tenant/);
  let reads = 0;
  const changed = fixture({ [detailsPath]: () => ({ guid: appId, customerId: ++reads === 1 ? 't2' : 't1' }) });
  await assert.rejects(readAnaplanDiscovery({ origin, tenantId: 't2', appId }, changed), /selected tenant/);
  assert.equal(reads, 2);
});

test('malformed, duplicate, or partial lists cannot produce accepted discovery', async () => {
  const bad = [
    [{ origin }, customersPath, { customers: [...customers.customers, customers.customers[0]] }],
    [{ origin }, customersPath, { customers: [{ customerGuid: '../bad', customerName: 'bad' }] }],
    [{ origin }, customersPath, { ...customers, totalCount: 3 }],
    [{ origin, tenantId: 't2' }, appsPath, { items: [{ guid: appId, name: '' }] }],
    [{ origin, tenantId: 't2' }, appsPath, { ...catalog, next: 'https://untrusted.example/next' }],
    [{ origin, tenantId: 't2' }, appsPath, { items: [...catalog.items, ...catalog.items] }],
    [{ origin, tenantId: 't2', appId }, detailsPath, { customerId: 't2', guid: 123 }],
    [{ origin, tenantId: 't2', appId }, modelsPath, { pages: [{ models: [{ ...model, modelId: 'invalid' }] }] }],
    [{ origin, tenantId: 't2', appId }, modelsPath, { pages: [{ models: [model, { ...model, workspaceName: 'Other' }] }] }],
    [{ origin, tenantId: 't2', appId }, modelsPath, { pages: [] }],
    [{ origin, tenantId: 't2', appId }, modelsPath, { ...pages, hasMore: true }],
  ];
  for (const [input, path, body] of bad) await assert.rejects(readAnaplanDiscovery(input, fixture({ [path]: body })), /Anaplan|app no longer/);
  const tooMany = { pages: Array.from({ length: 101 }, (_, i) => ({ models: [{ ...model, modelId: i.toString(16).padStart(32, '0') }] })) };
  await assert.rejects(readAnaplanDiscovery({ origin, tenantId: 't2', appId }, fixture({ [modelsPath]: tooMany })), /more than 100/);
});

test('authentication and network failures are distinguished without exposing response data', async () => {
  for (const status of [401, 403, 302, 500]) {
    const f = fixture({ [customersPath]: new Response('DO-NOT-EXPOSE', { status, headers: { location: 'https://login.example/SECRET' } }) });
    await assert.rejects(readAnaplanDiscovery({ origin }, f), error => {
      assert.ok(!/DO-NOT-EXPOSE|SECRET/.test(error.message));
      assert.equal(error.code, status === 401 || status === 302 ? 'ANAPLAN_BROWSER_LOGIN' : status === 403 ? 'ANAPLAN_BROWSER_FORBIDDEN' : 'ANAPLAN_DISCOVERY_FAILED'); return true;
    });
  }
  for (const response of [new Response('<html>SECRET</html>', { headers: { 'content-type': 'text/html' } }), { type: 'opaqueredirect', status: 0 }]) {
    await assert.rejects(readAnaplanDiscovery({ origin }, { fetchImpl: async () => response }), error => error.code === 'ANAPLAN_BROWSER_LOGIN');
  }
  await assert.rejects(readAnaplanDiscovery({ origin }, { fetchImpl: async () => { throw new Error('SECRET'); } }), error => error.code === 'ANAPLAN_DISCOVERY_FAILED' && !error.message.includes('SECRET'));
});

test('invalid JSON and response size limits fail safely', async () => {
  for (const response of [new Response('SECRET', { headers: { 'content-type': 'application/json' } }), json(null), json([])]) {
    await assert.rejects(readAnaplanDiscovery({ origin }, { fetchImpl: async () => response }), /unrecognized tenant/);
  }
  const large = new Response('x', { headers: { 'content-type': 'application/json', 'content-length': '17000000' } });
  await assert.rejects(readAnaplanDiscovery({ origin }, { fetchImpl: async () => large }), /too large/);
  const streamed = new Response('x'.repeat(16 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(readAnaplanDiscovery({ origin }, { fetchImpl: async () => streamed }), /too large/);
});

test('cancellation and timeouts abort requests and prevent subsequent reads', async () => {
  const already = new AbortController(); already.abort();
  await assert.rejects(readAnaplanDiscovery({ origin }, { signal: already.signal, fetchImpl: () => assert.fail() }), /cancelled/);
  const controller = new AbortController();
  const f = fixture({ [customersPath]: () => { controller.abort(); return customers; } });
  await assert.rejects(readAnaplanDiscovery({ origin, tenantId: 't2' }, { ...f, signal: controller.signal }), /cancelled/);
  assert.deepEqual(f.calls, [customersPath]);
  const pendingFetch = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  await assert.rejects(readAnaplanDiscovery({ origin }, { fetchImpl: pendingFetch, requestTimeout: 10 }), /too long/);
  const active = new AbortController();
  const result = readAnaplanDiscovery({ origin }, { fetchImpl: pendingFetch, signal: active.signal });
  active.abort(); await assert.rejects(result, /cancelled/);
});
