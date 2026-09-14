import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalApi } from '../extension/local-api.mjs';

const pairing = { baseUrl: 'http://127.0.0.1:8766', token: 'synthetic-pairing' };

test('the panel API waits for pairing and reads the current connection for each request', async () => {
  let connection = null;
  const calls = [];
  const api = createLocalApi(() => connection, { fetchImpl: async (...args) => {
    calls.push(args);
    return Response.json({ apps: [] });
  } });
  await assert.rejects(api('/apps'), /Start the local helper/);
  assert.equal(calls.length, 0);
  connection = pairing;
  assert.deepEqual(await api('/apps'), { apps: [] });
  assert.equal(calls[0][0], pairing.baseUrl + '/apps');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer synthetic-pairing');
  assert.equal(calls[0][1].headers['Content-Type'], undefined);
  assert.ok(calls[0][1].signal instanceof AbortSignal);
  connection = { ...pairing, token: 'replacement-pairing' };
  const controller = new AbortController();
  await api('/apps', { method: 'POST', body: { context: 'Context €' }, signal: controller.signal });
  assert.equal(calls[1][1].headers.Authorization, 'Bearer replacement-pairing');
  assert.equal(calls[1][1].headers['Content-Type'], 'application/json');
  assert.equal(calls[1][1].body, JSON.stringify({ context: 'Context €' }));
  assert.equal(calls[1][1].signal, controller.signal);
});

test('the panel API preserves structured sign-in errors for the access flow', async () => {
  const detail = { error: 'Sign in to Anaplan.', code: 'ANAPLAN_LOGIN', url: 'https://us1a.app.anaplan.com/oauth/activate', userCode: 'SYNTHETIC' };
  const api = createLocalApi(() => pairing, { fetchImpl: async () => Response.json(detail, { status: 401 }) });
  await assert.rejects(api('/workspaces'), error => {
    assert.equal(error.message, detail.error);
    for (const key of ['code', 'url', 'userCode']) assert.equal(error[key], detail[key]);
    return true;
  });
});

test('the panel API distinguishes cancellation from an unreachable helper', async () => {
  const api = createLocalApi(() => pairing, { fetchImpl: async () => { throw new Error('Private network diagnostic'); } });
  await assert.rejects(api('/status'), { message: 'Cannot reach the local helper. Run npm start in the Xanaplan folder, then select Check.' });
  await assert.rejects(api('/chat', { signal: AbortSignal.abort() }), { name: 'AbortError', message: 'Cancelled' });
});

test('an old helper missing page context gives restart instructions without hiding missing apps', async () => {
  let detail = { error: 'Not found.' };
  const api = createLocalApi(() => pairing, { fetchImpl: async () => Response.json(detail, { status: 404 }) });
  await assert.rejects(api('/page-context', { method: 'POST', body: {} }), error => {
    assert.equal(error.code, 'HELPER_UPDATE_REQUIRED'); assert.equal(error.status, 404);
    assert.match(error.message, /Ctrl\+C.*npm start.*refresh page context/);
    return true;
  });
  await assert.rejects(api('/another-endpoint'), { message: 'Not found.', status: 404 });
  detail = { error: 'This app is not enabled. Add it in Admin first.' };
  await assert.rejects(api('/page-context', { method: 'POST', body: {} }), { message: detail.error, status: 404 });
});
