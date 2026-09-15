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

import test from 'node:test';
import assert from 'node:assert/strict';
import { appOrigin, discoverApps } from '../extension/app-discovery.mjs';
import { discoveryInput } from '../extension/discovery-input.mjs';
import { createDiscoveryService } from '../extension/discovery-background.mjs';

const origin = 'https://us1a.app.anaplan.com';
const appId = '00000000-0000-0000-0000-000000000001';
const tenant = { kind: 'tenants', selectedId: 'tenant1', items: [{ id: 'tenant1', name: 'Synthetic tenant', selected: true }] };
const catalog = { kind: 'catalog', items: [{ id: appId, name: 'Synthetic app' }] };
const forbiddenTabs = new Proxy({}, { get() { assert.fail('Discovery must never use browser tabs.'); } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('discovery validates tenant and app identifiers before starting a background request', () => {
  assert.deepEqual(discoveryInput({ origin, tenantId: 'tenant1', appId }), { origin, tenantId: 'tenant1', appId });
  assert.deepEqual(discoveryInput({ origin: origin + '/a/apps' }), { origin, tenantId: '', appId: '' });
  for (const tenantId of ['../other', 'x'.repeat(81), {}, null]) assert.throws(() => discoveryInput({ origin, tenantId }), /tenant/);
  for (const value of ['../other', 'not-an-app-id', {}, null]) assert.throws(() => discoveryInput({ origin, tenantId: 'tenant1', appId: value }), /app/);
  assert.throws(() => discoveryInput({ origin, appId }), /tenant before/);
});

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
