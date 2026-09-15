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
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.mjs';
import { Store } from '../server/store.mjs';
import { request } from './http-client.mjs';

const origin = 'chrome-extension://' + 'a'.repeat(32);
function fixture(t, providers = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'xanaplan-http-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  const server = createApp({ store, providers, mcp: {} });
  return { store, call: (...args) => request(server, store, ...args) };
}

test('preflight and paired requests retain the same host, origin, and token boundary', async t => {
  const { call } = fixture(t);
  const preflight = await call('OPTIONS', '/llm', undefined, { headers: { origin, authorization: '' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.body, undefined);
  assert.equal(preflight.headers['access-control-allow-origin'], origin);
  assert.equal(preflight.headers['access-control-allow-private-network'], 'true');
  for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, { origin, host: 'evil.example:8766' }]) {
    const response = await call('OPTIONS', '/llm', undefined, { headers });
    assert.equal(response.status, 403);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  for (const headers of [{ authorization: '' }, { origin: 'https://evil.example' }, { host: 'localhost:8766' }]) {
    assert.equal((await call('GET', '/llm', undefined, { headers })).status, 403);
  }
  const response = await call('GET', '/llm', undefined, { headers: { origin } });
  assert.equal(response.status, 200);
  assert.equal(response.body.llm.provider, 'claude');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});

test('invalid JSON, oversized bodies, and unsupported content types never change settings', async t => {
  const { store, call } = fixture(t);
  const before = store.getLlm();
  for (const [status, options] of [
    [415, { headers: { 'content-type': 'text/plain' }, rawBody: '{}' }],
    [400, { rawBody: '{broken' }],
    [413, { rawBody: JSON.stringify({ model: 'x'.repeat(180000) }) }],
  ]) {
    assert.equal((await call('POST', '/llm', undefined, options)).status, status);
    assert.deepEqual(store.getLlm(), before);
  }
  assert.equal((await call('GET', '/unknown')).status, 404);
  assert.equal((await call('GET', '/llm')).status, 200);
});

test('unexpected route failures do not expose private diagnostics', async t => {
  const { call } = fixture(t, { status: async () => { throw new Error('PRIVATE-DIAGNOSTIC'); } });
  const response = await call('GET', '/status');
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'The local helper encountered an error. Restart it and retry.' });
});

test('an in-flight AI connection test blocks settings changes and releases the lock afterward', async t => {
  const started = Promise.withResolvers(), finished = Promise.withResolvers();
  const { store, call } = fixture(t, { test: async () => { started.resolve(); return finished.promise; } });
  const pending = call('POST', '/llm/test', { provider: 'openai', model: '' });
  await started.promise;
  try {
    assert.equal((await call('POST', '/llm', { provider: 'openai', model: '', revision: 1 })).status, 409);
    assert.equal((await call('POST', '/chat', {})).status, 409);
    assert.equal(store.getLlm().provider, 'claude');
  } finally { finished.resolve({ success: true }); }
  assert.equal((await pending).status, 200);
  assert.equal((await call('POST', '/llm', { provider: 'openai', model: '', revision: 1 })).status, 200);
  assert.equal(store.getLlm().provider, 'openai');
});
