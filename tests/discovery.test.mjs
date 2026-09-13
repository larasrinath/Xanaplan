import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { appOrigin, discoverApps } from '../extension/app-discovery.mjs';
import { runDiscovery } from '../extension/discovery-runner.mjs';
import { createDiscoveryService } from '../extension/discovery-background.mjs';

const origin = 'https://us1a.app.anaplan.com';
const appId = '00000000-0000-0000-0000-000000000001';
const tenant = { kind: 'tenants', selectedId: 'tenant1', items: [{ id: 'tenant1', name: 'Synthetic tenant', selected: true }] };
const catalog = { kind: 'catalog', items: [{ id: appId, name: 'Synthetic app' }] };
const forbiddenTabs = new Proxy({}, { get() { assert.fail('Discovery must never use browser tabs.'); } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('panel discovery uses background messages only, including failure and cancellation', async () => {
  for (const value of ['https://anaplan.com.evil.test', 'http://us1a.app.anaplan.com', 'https://user:pass@us1a.app.anaplan.com', 'https://us1a.app.anaplan.com:9999']) assert.throws(() => appOrigin(value));
  const messages = [], controller = new AbortController();
  const chromeApi = { tabs: forbiddenTabs, runtime: { sendMessage: async message => {
    messages.push(message);
    if (message.action === 'start') { controller.abort(); return new Promise(() => {}); }
    return { ok: true };
  } } };
  await assert.rejects(discoverApps({ origin, signal: controller.signal, chromeApi }), /cancelled/);
  assert.deepEqual(messages.map(item => item.action), ['start', 'cancel']);
  assert.equal(messages[0].jobId, messages[1].jobId);
  assert.equal(messages[0].input.origin, origin);
  const failed = { tabs: forbiddenTabs, runtime: { sendMessage: async () => ({ ok: false, error: 'Anaplan could not load' }) } };
  await assert.rejects(discoverApps({ origin, chromeApi: failed }), /could not load/);
  const success = { tabs: forbiddenTabs, runtime: { sendMessage: async () => ({ ok: true, result: tenant }) } };
  assert.deepEqual(await discoverApps({ origin, chromeApi: success }), tenant);
});

test('cancelling before a request prevents background discovery', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(discoverApps({ origin, signal: controller.signal, chromeApi: { runtime: { sendMessage: () => assert.fail() } } }), /cancelled/);
});

test('hidden discovery rejects old documents, waits for stable rows and verifies the tenant', async () => {
  const navigations = []; let switches = 0, reads = 0, closed = 0;
  const transport = {
    navigate: async url => { navigations.push(url); }, close: async () => { closed++; },
    inspect: async (action, args) => {
      if (action === 'tenant') {
        assert.equal(args.tenantId, 'tenant1');
        if (!switches && args.allowSwitch) { switches++; return { documentId: 'old', result: { kind: 'tenant-switching' } }; }
        return { documentId: navigations.length === 2 ? 'new' : 'old', result: tenant };
      }
      reads++;
      return { documentId: reads === 1 ? 'old' : 'new', result: reads === 2 ? { kind: 'catalog', items: [] } : catalog };
    },
  };
  const result = await runDiscovery({ origin, tenantId: 'tenant1' }, transport, { interval: 0 });
  assert.equal(result.tenantName, 'Synthetic tenant'); assert.deepEqual(result.items, catalog.items);
  assert.deepEqual(navigations, [origin + '/a/apps', origin + '/a/apps']);
  assert.equal(reads, 5); assert.equal(switches, 1); assert.equal(closed, 1);
});

test('a tenant change during catalog discovery is rejected and cleaned up', async () => {
  let reads = 0, closed = false;
  const transport = { navigate: async () => {}, close: async () => { closed = true; }, inspect: async action => {
    if (action === 'tenant') return { documentId: 'doc', result: reads >= 3 ? { ...tenant, selectedId: 'unexpected' } : tenant };
    reads++; return { documentId: 'doc', result: catalog };
  } };
  await assert.rejects(runDiscovery({ origin, tenantId: 'tenant1' }, transport, { interval: 0 }), /tenant changed/);
  assert.equal(closed, true);
});

test('model discovery opens only the hidden app URL and preserves model provenance', async () => {
  const urls = [], models = [{ id: 'A'.repeat(32), name: 'Synthetic model', workspaceName: 'Finance' }];
  const transport = { navigate: async url => urls.push(url), close: async () => {}, inspect: async action => ({ documentId: urls.length === 2 ? 'new' : 'old', result: action === 'tenant' ? tenant : { kind: 'models', models } }) };
  const result = await runDiscovery({ origin, tenantId: 'tenant1', appId }, transport, { interval: 0 });
  assert.deepEqual(urls, [origin + '/a/apps', origin + '/a/apps/app/' + appId]);
  assert.deepEqual(result.models, models); assert.equal(result.tenantId, 'tenant1');
});

test('blocked frames time out inline; cancellation cleans up without a tab fallback', async () => {
  let closes = 0;
  const transport = { navigate: async () => {}, inspect: async () => null, close: async () => { closes++; } };
  await assert.rejects(runDiscovery({ origin }, transport, { timeout: 10, interval: 1 }), /background/);
  const controller = new AbortController();
  await assert.rejects(runDiscovery({ origin }, { ...transport, inspect: async () => { controller.abort(); return null; } }, { signal: controller.signal, interval: 1 }), /cancelled/);
  assert.equal(closes, 2);
});

test('background GET service cancels superseded reads, rejects page callers, and targets cancellation', async () => {
  const id = 'test-extension', getURL = file => `chrome-extension://${id}/${file}`;
  const jobs = [];
  const chromeApi = { tabs: forbiddenTabs, offscreen: forbiddenTabs, runtime: { id, getURL, getContexts: () => assert.fail('No background document'), sendMessage: () => assert.fail('No frame messaging') } };
  const read = async (input, { signal }) => { const done = deferred(); jobs.push({ input, signal, ...done }); return done.promise; };
  const handle = createDiscoveryService(chromeApi, { read }), sender = { id, url: getURL('panel.html') };
  const firstId = crypto.randomUUID(), secondId = crypto.randomUUID();
  const firstMessage = { action: 'start', jobId: firstId, input: { origin, tenantId: 'tenant1' } };
  await assert.rejects(handle(firstMessage, { id, url: origin + '/a/apps' }), /only.*panel/);
  const first = handle(firstMessage, sender);
  await new Promise(resolve => setImmediate(resolve));
  const second = handle({ ...firstMessage, jobId: secondId }, sender);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await first).ok, false);
  assert.equal(jobs[0].signal.aborted, true);
  await handle({ action: 'cancel', jobId: firstId }, sender);
  assert.equal(jobs[1].signal.aborted, false);
  await assert.rejects(handle({ ...firstMessage, input: { origin: 'https://evil.example' } }, sender));
  assert.equal(jobs[1].signal.aborted, false);
  jobs[0].resolve({ items: ['stale result'] });
  jobs[1].resolve(catalog);
  assert.deepEqual(await second, { ok: true, result: catalog });
  const third = handle({ ...firstMessage, jobId: crypto.randomUUID() }, sender);
  await new Promise(resolve => setImmediate(resolve));
  await handle({ action: 'cancel', jobId: firstId }, sender);
  assert.equal(jobs[2].signal.aborted, false);
  jobs[2].resolve(tenant); assert.equal((await third).ok, true);
});

test('background timeouts stop hung reads and propagate authentication error codes', async () => {
  const id = 'test-extension', getURL = file => `chrome-extension://${id}/${file}`;
  const chromeApi = { tabs: forbiddenTabs, offscreen: forbiddenTabs, runtime: { id, getURL } };
  const sender = { id, url: getURL('panel.html') }, message = { action: 'start', jobId: crypto.randomUUID(), input: { origin } };
  let requestSignal;
  const handle = createDiscoveryService(chromeApi, { timeout: 10, read: async (_, { signal }) => { requestSignal = signal; return new Promise(() => {}); } });
  const result = await handle(message, sender);
  assert.equal(result.ok, false); assert.match(result.error, /timed out/); assert.equal(requestSignal.aborted, true);
  const denied = createDiscoveryService(chromeApi, { read: async () => { throw Object.assign(new Error('Sign in'), { code: 'ANAPLAN_BROWSER_LOGIN' }); } });
  assert.deepEqual(await denied(message, sender), { ok: false, error: 'Sign in', code: 'ANAPLAN_BROWSER_LOGIN' });
});


test('content bridge stays inactive outside its own extension parent', () => {
  const script = readFileSync(new URL('../extension/discovery-content.js', import.meta.url), 'utf8');
  const normal = {}; normal.top = normal;
  const chrome = { runtime: { id: 'test-extension' } };
  runInNewContext(script, { window: normal, chrome });
  for (const parentOrigin of [origin, 'chrome-extension://unrelated']) {
    runInNewContext(script, { window: { top: {}, parent: {} }, location: { ancestorOrigins: [parentOrigin] }, chrome });
  }
});

test('offscreen content messages work when Chrome omits tab and documentId metadata', async () => {
  const { frameTransport } = await import('../extension/discovery-frame.mjs');
  const script = readFileSync(new URL('../extension/discovery-content.js', import.meta.url), 'utf8');
  const events = () => {
    const listeners = new Set();
    return { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f), emit: value => { for (const f of listeners) f(value); } };
  };
  const onConnect = events(), controller = new AbortController();
  const receiver = { sender: { id: 'test-extension', url: origin + '/a/apps', origin }, onMessage: events(), onDisconnect: events() };
  const client = { onMessage: events(), onDisconnect: events() };
  let closed = false;
  receiver.disconnect = client.disconnect = () => { closed = true; };
  receiver.postMessage = value => queueMicrotask(() => { if (!closed) client.onMessage.emit(value); });
  client.postMessage = value => queueMicrotask(() => { if (!closed) receiver.onMessage.emit(value); });
  const frame = { remove() {}, addEventListener() {}, removeEventListener() {} };
  const document = { createElement: () => frame, body: { append() {} }, addEventListener() {}, removeEventListener() {} };
  const transport = frameTransport(origin, crypto.randomUUID(), controller.signal, { document, chromeApi: { runtime: { id: 'test-extension', onConnect } } });
  try {
    transport.navigate(origin + '/a/apps');
    runInNewContext(script, {
      window: { top: {} }, location: { ancestorOrigins: ['chrome-extension://test-extension'] }, crypto,
      chrome: { runtime: { id: 'test-extension', connect: options => { receiver.name = options.name; return client; } } },
      XanaplanDiscoveryDOM: { inspectTenantDocument: () => tenant },
    });
    onConnect.emit(receiver);
    assert.equal(closed, false, 'A valid offscreen reader must not be rejected for missing optional Chrome metadata.');
    const result = await transport.inspect('tenant', { tenantId: '', allowSwitch: false });
    assert.deepEqual(result.result, tenant);
    assert.ok(result.documentId, 'The reader must still identify its document for navigation checks.');
  } finally { transport.close(); }
});


test('native Chrome port connects only the hidden frame and survives navigation and cancellation', async () => {
  const { frameTransport } = await import('../extension/discovery-frame.mjs');
  const script = readFileSync(new URL('../extension/discovery-content.js', import.meta.url), 'utf8');
  const extensionOrigin = 'chrome-extension://test-extension';
  const controller = new AbortController(), jobId = crypto.randomUUID();
  const event = () => { const listeners = new Set(); return { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f), emit: value => { for (const f of listeners) f(value); }, get size() { return listeners.size; } }; };
  const onConnect = event(); let removed = false, inspected = 0, tenantResult = tenant;
  function ports(documentId, overrides = {}) {
    const receiver = { name: `xanaplan-discovery-frame-v3:${documentId}`, sender: { id: 'test-extension', url: origin + '/a/apps', ...overrides }, onMessage: event(), onDisconnect: event(), closed: false };
    const sender = { onMessage: event(), onDisconnect: event(), closed: false };
    receiver.postMessage = value => queueMicrotask(() => { if (!sender.closed) sender.onMessage.emit(value); });
    sender.postMessage = value => queueMicrotask(() => { if (!receiver.closed) receiver.onMessage.emit(value); });
    receiver.disconnect = sender.disconnect = () => { if (receiver.closed) return; receiver.closed = sender.closed = true; receiver.onDisconnect.emit(); sender.onDisconnect.emit(); };
    return { receiver, sender, documentId };
  }
  const load = event(), policy = event();
  const frame = { contentWindow: { postMessage() { assert.fail('No DOMWindow messaging is used.'); } }, remove: () => { removed = true; }, isConnected: false, addEventListener: (type, f) => load.addListener(f), removeEventListener: (type, f) => load.removeListener(f) };
  const document = { createElement: () => frame, body: { append: () => { frame.isConnected = true; } }, addEventListener: (type, f) => policy.addListener(f), removeEventListener: (type, f) => policy.removeListener(f) };
  const chromeApi = { runtime: { id: 'test-extension', onConnect } };
  const transport = frameTransport(origin, jobId, controller.signal, { document, chromeApi });
  await transport.navigate(origin + '/a/apps');
  assert.equal(await transport.inspect('tenant', { tenantId: '', allowSwitch: false }), null);
  assert.match(transport.timeoutMessage('tenants'), /did not connect/);
  load.emit();
  assert.match(transport.timeoutMessage('tenants'), /load-events=1, connections=0/);
  for (const override of [{ tab: { id: 10 } }, { id: 'other-extension' }, { url: 'https://evil.test/a/apps' }, { origin: 'null' }]) {
    const pair = ports(crypto.randomUUID(), override); onConnect.emit(pair.receiver); assert.equal(pair.receiver.closed, true);
  }
  const boot = pair => {
    runInNewContext(script, {
      window: { top: {} }, location: { ancestorOrigins: [extensionOrigin] }, crypto: { randomUUID: () => pair.documentId },
      chrome: { runtime: { id: 'test-extension', connect: options => { assert.equal(options.name, pair.receiver.name); return pair.sender; } } },
      XanaplanDiscoveryDOM: { inspectTenantDocument: () => { inspected++; return tenantResult; } },
    });
    onConnect.emit(pair.receiver);
  };
  const first = ports(crypto.randomUUID()); boot(first);
  const result = await transport.inspect('tenant', { tenantId: '', allowSwitch: false });
  assert.deepEqual(result.result, tenant); assert.equal(inspected, 1);
  assert.equal(result.documentId, first.documentId);
  assert.match(transport.timeoutMessage('tenants'), /tenant menu/);
  tenantResult = { kind: 'tenant-pending', stage: 'selection-unrecognized', selector: true, menu: true, totalItems: 3, visibleItems: 3, parsedItems: 3, selectedItems: 0, page: 'apps', ready: 'complete', accountName: 'PRIVATE-TEST-MARKER' };
  await transport.inspect('tenant', { tenantId: '', allowSwitch: false });
  const diagnostic = transport.timeoutMessage('tenants');
  assert.match(diagnostic, /active tenant could not be identified/);
  assert.match(diagnostic, /items=3, visible=3, parsed=3, selected=0, page=apps, ready=complete/);
  assert.ok(!diagnostic.includes('PRIVATE-TEST-MARKER'));
  tenantResult = { ...tenantResult, stage: 'toString', page: 'PRIVATE-TEST-MARKER', ready: 'PRIVATE-TEST-MARKER' };
  await transport.inspect('tenant', { tenantId: '', allowSwitch: false });
  assert.match(transport.timeoutMessage('tenants'), /^The tenant menu could not be read/);
  assert.ok(!transport.timeoutMessage('tenants').includes('PRIVATE-TEST-MARKER'));
  tenantResult = tenant;
  await transport.navigate(origin + '/a/apps/app/' + appId);
  assert.equal(first.receiver.closed, true);
  const stale = ports(first.documentId); onConnect.emit(stale.receiver); assert.equal(stale.receiver.closed, true);
  const next = ports(crypto.randomUUID()); boot(next);
  const second = await transport.inspect('tenant', { tenantId: '', allowSwitch: false });
  assert.notEqual(second.documentId, result.documentId);
  const pending = transport.inspect('tenant', { tenantId: '', allowSwitch: false });
  controller.abort(); assert.equal(await pending, null);
  const afterAbort = ports(crypto.randomUUID()); onConnect.emit(afterAbort.receiver); assert.equal(afterAbort.receiver.closed, true);
  await transport.close(); assert.equal(removed, true); assert.equal(onConnect.size, 0); assert.equal(next.receiver.closed, true);
  assert.equal(load.size, 0); assert.equal(policy.size, 0);
});
