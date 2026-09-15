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
import { request } from './http-client.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'xanaplan-connection-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, store: new Store(dir) };
}
function client(store, fallback = '') {
  const server = createApp({
    store,
    mcp: { clientId: () => store.data.anaplanClientId || fallback, reset: async () => {} },
    providers: { status: async () => { throw new Error('AI status unavailable'); } },
  });
  return (method, body) => request(server, store, method, '/connection', body);
}

test('OAuth Save confirms persisted settings and restores the same ID after a restart without AI status', async t => {
  const { dir, store } = fixture(t);
  const response = await client(store)('POST', { clientId: '  synthetic-client  ' });
  assert.equal(response.status, 200);
  assert.equal(response.body.saved, true);
  assert.equal(response.body.connection.clientId, 'synthetic-client');
  assert.equal(response.body.connection.source, 'saved');
  assert.ok(Number.isFinite(Date.parse(response.body.connection.savedAt)));
  const reloaded = await client(new Store(dir))('GET');
  assert.deepEqual(reloaded.body.connection, response.body.connection);
  assert.deepEqual(Object.keys(reloaded.body.connection).sort(), ['clientId', 'savedAt', 'source']);
});

test('connection status distinguishes detected configuration, legacy saves and no configuration', async t => {
  const { store } = fixture(t);
  assert.equal((await client(store)('GET')).body.connection.source, null);
  assert.deepEqual((await client(store, 'detected-client')('GET')).body.connection, { clientId: 'detected-client', source: 'detected', savedAt: null });
  store.data.anaplanClientId = 'legacy-client';
  assert.deepEqual((await client(store, 'detected-client')('GET')).body.connection, { clientId: 'legacy-client', source: 'saved', savedAt: null });
});

test('invalid IDs and disk failures do not replace the last saved connection', async t => {
  const { dir, store } = fixture(t);
  store.saveConnection('saved-client');
  const request = client(store), before = (await request('GET')).body;
  assert.equal((await request('POST', { clientId: '   ' })).status, 400);
  store.flush = () => { throw new Error('Synthetic disk failure'); };
  const failed = await request('POST', { clientId: 'unsaved-client' });
  assert.equal(failed.status, 500);
  assert.equal(failed.body.saved, undefined);
  assert.deepEqual((await request('GET')).body, before);
  assert.deepEqual((await client(new Store(dir))('GET')).body, before);
});
