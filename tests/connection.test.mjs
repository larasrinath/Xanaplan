import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';

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
  // Exercise the HTTP handler without opening a network listener or using real services.
  return (method, body) => new Promise(resolve => {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    Object.assign(req, { method, url: '/connection', headers: { host: '127.0.0.1:8766', authorization: `Bearer ${store.data.token}`, 'content-type': 'application/json' } });
    const res = new EventEmitter();
    res.setHeader = () => {};
    res.writeHead = status => { res.status = status; };
    res.end = text => resolve({ status: res.status, body: JSON.parse(text) });
    server.emit('request', req, res);
  });
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
