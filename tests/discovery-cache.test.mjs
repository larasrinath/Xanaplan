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
import { createDiscoveryCache } from '../extension/discovery-cache.mjs';
import { discoverApps } from '../extension/app-discovery.mjs';
const origin = 'https://us1a.app.anaplan.com';
const appId = '00000000-0000-0000-0000-000000000001';
const tenants = { kind: 'tenants', origin, selectedId: 't1', items: [{ id: 't1', name: 'Synthetic tenant', selected: true }] };
const catalog = (tenantId = 't1') => ({ kind: 'catalog', origin, tenantId, tenantName: 'Synthetic ' + tenantId, items: [{ id: appId, name: 'Synthetic app' }] });
function fixture() {
  const values = new Map(); let time = 1000;
  const storage = () => ({ getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
  const create = () => createDiscoveryCache({ storage, now: () => time });
  return { cache: create(), create, advance: ms => { time += ms; }, values };
}
const stash = (cache, input, result) => { const { generation } = cache.begin(input); cache.put(input, result, generation); };

test('lists survive panel reopening indefinitely and are separated by site and tenant', () => {
  const f = fixture();
  stash(f.cache, { origin }, { ...tenants, url: 'DO-NOT-STORE', token: 'DO-NOT-STORE' });
  stash(f.cache, { origin, tenantId: 't1' }, catalog());
  stash(f.cache, { origin, tenantId: 't2' }, catalog('t2'));
  const reopened = f.create();
  assert.equal(reopened.begin({ origin }).result.cache.hit, true);
  assert.equal(reopened.begin({ origin, tenantId: 't1' }).result.tenantId, 't1');
  assert.equal(reopened.begin({ origin, tenantId: 't2' }).result.tenantId, 't2');
  assert.equal(reopened.begin({ origin, tenantId: 'other' }).result, null);
  assert.equal(reopened.begin({ origin: 'https://eu1a.app.anaplan.com' }).result, null);
  assert.ok(![...f.values.values()].join('').includes('DO-NOT-STORE'));
  f.advance(100 * 365 * 24 * 60 * 60 * 1000);
  assert.equal(f.create().begin({ origin }).result.cache.hit, true);
  assert.equal(f.create().begin({ origin, tenantId: 't1' }).result.cache.hit, true);
  // Visiting more tenants must not silently evict the first saved catalogs.
  for (let i = 3; i < 40; i++) stash(f.cache, { origin, tenantId: 't' + i }, catalog('t' + i));
  assert.equal(f.create().begin({ origin, tenantId: 't1' }).result.cache.hit, true);
});

test('Refresh replaces only its own saved list after success and rejects superseded writes', () => {
  const { cache } = fixture();
  stash(cache, { origin }, tenants); stash(cache, { origin, tenantId: 't1' }, catalog()); stash(cache, { origin, tenantId: 't2' }, catalog('t2'));
  const pending = cache.begin({ origin, tenantId: 't1' });
  const refresh = cache.begin({ origin, tenantId: 't1' }, true);
  assert.equal(refresh.result, null); assert.equal(refresh.previous.items[0].name, 'Synthetic app');
  assert.ok(cache.begin({ origin, tenantId: 't2' }).result);
  cache.put({ origin, tenantId: 't1' }, { ...catalog(), items: [{ id: appId, name: 'Superseded' }] }, pending.generation);
  assert.equal(cache.begin({ origin, tenantId: 't1' }).result.items[0].name, 'Synthetic app');
  cache.put({ origin, tenantId: 't1' }, { ...catalog(), items: [{ id: appId, name: 'Refreshed' }] }, refresh.generation);
  assert.equal(cache.begin({ origin, tenantId: 't1' }).result.items[0].name, 'Refreshed');
  cache.begin({ origin }, true);
  assert.equal(cache.begin({ origin, tenantId: 't2' }).result.cache.hit, true);
  stash(cache, { origin }, tenants); const old = cache.begin({ origin }); cache.clear();
  cache.put({ origin }, tenants, old.generation); assert.equal(cache.begin({ origin }).result, null);
});

test('failed refreshes show the last saved list without changing its date or retrying silently', async () => {
  const f = fixture(), { cache } = f; stash(cache, { origin, tenantId: 't1' }, catalog());
  const before = cache.begin({ origin, tenantId: 't1' }).result.cache.cachedAt;
  f.advance(365 * 24 * 60 * 60 * 1000); let calls = 0;
  const chromeApi = { runtime: { sendMessage: async () => { calls++; return { ok: false, error: 'Temporarily unavailable' }; } } };
  const input = { origin, tenantId: 't1', cache, chromeApi };
  const fallback = await discoverApps({ ...input, refresh: true });
  assert.equal(fallback.cache.refreshFailed, true); assert.equal(fallback.cache.cachedAt, before);
  assert.deepEqual(fallback.items, catalog().items);
  const next = await discoverApps(input);
  assert.equal(next.cache.refreshFailed, undefined); assert.equal(next.cache.cachedAt, before); assert.equal(calls, 1);
});

test('cancelling a refresh preserves the saved list without turning cancellation into success', async () => {
  const { cache } = fixture(); stash(cache, { origin, tenantId: 't1' }, catalog());
  const controller = new AbortController();
  const chromeApi = { runtime: { sendMessage: async ({ action }) => { if (action === 'start') controller.abort(); return { ok: false, error: 'Cancelled' }; } } };
  await assert.rejects(discoverApps({ origin, tenantId: 't1', refresh: true, cache, chromeApi, signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(cache.begin({ origin, tenantId: 't1' }).result.cache.hit, true);
});

test('a failed refresh cannot resurrect lists cleared by a connection reset', async () => {
  const { cache } = fixture(); stash(cache, { origin, tenantId: 't1' }, catalog());
  const chromeApi = { runtime: { sendMessage: async () => { cache.clear(); return { ok: false, error: 'Unavailable' }; } } };
  await assert.rejects(discoverApps({ origin, tenantId: 't1', refresh: true, cache, chromeApi }), /Unavailable/);
  assert.equal(cache.begin({ origin, tenantId: 't1' }).result, null);
});

test('storage failures report a non-persisted result without evicting saved lists', () => {
  const values = new Map(); let full = false;
  const cache = createDiscoveryCache({ storage: () => ({ getItem: key => values.get(key), setItem: (key, value) => { if (full) throw new Error('Quota exceeded'); values.set(key, value); } }) });
  stash(cache, { origin, tenantId: 't1' }, catalog()); full = true;
  const input = { origin, tenantId: 't2' }, { generation } = cache.begin(input);
  assert.equal(cache.put(input, catalog('t2'), generation).stored, false);
  assert.equal(cache.begin(input).result, null);
  assert.equal(cache.begin({ origin, tenantId: 't1' }).result.cache.hit, true);
});

test('cached lists never start background discovery; Refresh and model reads always do', async () => {
  const { cache } = fixture(); let calls = 0;
  const chromeApi = { runtime: { sendMessage: async message => {
    assert.equal(message.action, 'start'); calls++;
    const result = message.input.appId ? { kind: 'models', models: [{ id: 'live-model' }] } : message.input.tenantId ? catalog(message.input.tenantId) : tenants;
    return { ok: true, result };
  } } };
  const run = input => discoverApps({ origin, cache, chromeApi, ...input });
  await run({}); await run({ tenantId: 't1' }); assert.equal(calls, 2);
  assert.equal((await run({})).cache.hit, true);
  assert.equal((await run({ tenantId: 't1' })).cache.hit, true); assert.equal(calls, 2);
  await run({ tenantId: 't1', refresh: true }); assert.equal(calls, 3);
  await run({ tenantId: 't1', appId }); await run({ tenantId: 't1', appId }); assert.equal(calls, 5);
});

test('failed and cancelled requests do not populate the cache', async () => {
  const { cache } = fixture(), controller = new AbortController();
  const failed = { runtime: { sendMessage: async () => ({ ok: false, error: 'Background unavailable' }) } };
  await assert.rejects(discoverApps({ origin, cache, chromeApi: failed }), /unavailable/);
  assert.equal(cache.begin({ origin }).result, null);
  const cancelled = { runtime: { sendMessage: async ({ action }) => { if (action === 'start') controller.abort(); return { ok: true, result: tenants }; } } };
  await assert.rejects(discoverApps({ origin, cache, chromeApi: cancelled, signal: controller.signal }), /cancelled/);
  assert.equal(cache.begin({ origin }).result, null);
});

test('corrupt or unavailable storage and wrong-tenant results cannot break live discovery', () => {
  const f = fixture(); stash(f.cache, { origin }, tenants);
  for (const key of f.values.keys()) f.values.set(key, '{bad json');
  assert.equal(f.cache.begin({ origin }).result, null);
  stash(f.cache, { origin, tenantId: 't2' }, catalog('t1'));
  assert.equal(f.cache.begin({ origin, tenantId: 't2' }).result, null);
  const unavailable = createDiscoveryCache({ storage: () => { throw new Error('Unavailable'); } });
  stash(unavailable, { origin }, tenants); assert.equal(unavailable.begin({ origin }).result, null); unavailable.clear();
});

test('a tenant list without an active marker and an empty app catalog can be cached', () => {
  const { cache } = fixture();
  stash(cache, { origin }, { ...tenants, selectedId: '', items: [{ id: 't1', name: 'Synthetic', selected: false }] });
  assert.equal(cache.begin({ origin }).result.selectedId, '');
  stash(cache, { origin, tenantId: 't1' }, { ...catalog(), items: [] });
  assert.deepEqual(cache.begin({ origin, tenantId: 't1' }).result.items, []);
});

test('browser authentication failures clear cached dropdowns and invalidate in-flight saves', async () => {
  for (const [code, action] of ['ANAPLAN_BROWSER_LOGIN', 'ANAPLAN_BROWSER_FORBIDDEN'].flatMap(code => [[code, { appId }], [code, { refresh: true }]])) {
    const { cache } = fixture(); stash(cache, { origin }, tenants); stash(cache, { origin, tenantId: 't1' }, catalog());
    const pending = cache.begin({ origin, tenantId: 't2' });
    const chromeApi = { runtime: { sendMessage: async () => ({ ok: false, error: 'Access unavailable', code }) } };
    await assert.rejects(discoverApps({ origin, tenantId: 't1', ...action, cache, chromeApi }), error => error.code === code);
    assert.equal(cache.begin({ origin }).result, null); assert.equal(cache.begin({ origin, tenantId: 't1' }).result, null);
    cache.put({ origin, tenantId: 't2' }, catalog('t2'), pending.generation);
    assert.equal(cache.begin({ origin, tenantId: 't2' }).result, null);
  }
});
