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
import { PageTracker } from '../extension/page-tracker.mjs';
import { pageDefinition } from '../extension/page-api.mjs';
import { app, model, pageId, secondPageId, board, catalog, observation } from './fixtures/page.mjs';

function fixture() {
  let tab = structuredClone(observation), delay;
  const requests = [], notifications = [];
  const read = async (action, input) => {
    if (action === 'observe') return structuredClone(tab);
    requests.push(input);
    if (delay) await delay(input);
    return { ...pageDefinition(board, { id: pageId, type: 'boards' }, app), page: { id: input.pageId, name: input.pageId === pageId ? 'Performance' : 'Costs', type: 'boards' }, pages: catalog.pages.map(page => ({ id: page.identifier, name: page.name, type: 'boards' })) };
  };
  const api = async (_, { body }) => ({ ticket: `ticket-${body.definition.page.id}`, expires: Date.now() + 60000,
    context: { fingerprint: JSON.stringify([body.definition.page.id, body.observation?.selections, body.mode]), page: body.definition.page, model: app.models[0] },
  });
  const tracker = new PageTracker({ read, api, changed: state => notifications.push(structuredClone(state)) });
  return { tracker, requests, notifications, setTab: value => { tab = value; }, setDelay: value => { delay = value; } };
}
test('follow mode tracks tab pages; manual pins survive navigation and resume explicitly', async () => {
  const f = fixture(); await f.tracker.setApp(app);
  assert.equal(f.tracker.state.context.page.id, pageId);
  await f.tracker.choose(secondPageId);
  f.setTab({ ...observation, url: 'https://example.com' }); await f.tracker.observe();
  assert.equal(f.tracker.state.context.page.id, secondPageId);
  assert.equal(f.tracker.state.mode, 'manual');
  await f.tracker.choose('');
  assert.equal(f.tracker.state.ticket, ''); assert.match(f.tracker.state.error, /Open an Anaplan page/);
});

test('following the tab matches its enabled app at startup and on navigation, while manual and saved choices stay pinned', async () => {
  const otherAppId = '00000000-0000-0000-0000-000000000004';
  const other = { ...app, appId: otherAppId, key: app.key.replace(app.appId, otherAppId), name: 'Other planning' };
  const enabled = [app, other], verified = [];
  let tab = structuredClone(observation);
  const tracker = new PageTracker({
    resolveApp: page => enabled.find(item => item.appId === page.appId && item.origin === page.origin),
    read: async (action, input) => action === 'observe' ? structuredClone(tab) : {
      page: { id: input.pageId, name: input.appId === app.appId ? 'Performance' : 'Other page', type: 'boards' },
      pages: [{ id: pageId, name: 'Performance', type: 'boards' }, { id: secondPageId, name: 'Other page', type: 'boards' }], models: [model],
    },
    api: async (_, { body }) => {
      verified.push(body);
      return { ticket: `ticket-${body.appKey}`, expires: Date.now() + 60000, context: { fingerprint: `${body.appKey}:${body.definition.page.id}:${body.mode}`, page: body.definition.page, model } };
    },
  });
  await tracker.setApp(other);
  assert.equal(tracker.app.key, app.key, 'Startup matches the actual tab before verifying a page');
  assert.equal(verified.length, 1); assert.equal(verified[0].appKey, app.key);
  tab = { ...observation, url: observation.url.replace(app.appId, otherAppId).replace(pageId, secondPageId) };
  await tracker.observe();
  assert.equal(tracker.app.key, other.key); assert.equal(tracker.state.context.page.id, secondPageId);
  assert.equal(verified.at(-1).appKey, other.key);
  await tracker.setApp(app, { manual: true });
  assert.equal(tracker.app.key, app.key); assert.equal(tracker.state.mode, 'manual');
  assert.match(tracker.state.error, /Choose a page/);
  await tracker.choose(pageId); await tracker.observe();
  assert.equal(tracker.app.key, app.key); assert.equal(tracker.state.context.page.id, pageId);
  await tracker.restoreSaved(app, { id: 'saved', revision: 1, page: { id: pageId }, messages: [] });
  await tracker.observe(); assert.equal(tracker.app.key, app.key); assert.equal(tracker.state.mode, 'saved');
  await tracker.choose('');
  assert.equal(tracker.app.key, other.key); assert.equal(tracker.state.mode, 'follow');
  const count = verified.length;
  tab = { ...observation, url: observation.url.replace(app.appId, '00000000-0000-0000-0000-000000000099') };
  await tracker.observe();
  assert.equal(tracker.app.key, other.key); assert.equal(tracker.state.ticket, '');
  assert.match(tracker.state.error, /not enabled or could not be matched/); assert.equal(verified.length, count);
});
test('new selections create a fresh thread identity and invalidate previous context immediately', async () => {
  const f = fixture(); await f.tracker.setApp(app);
  const previous = f.tracker.state.context.fingerprint;
  f.setTab({ ...observation, selections: [{ ...observation.selections[0], label: 'Feb 26' }] });
  await f.tracker.observe();
  assert.notEqual(f.tracker.state.context.fingerprint, previous);
  assert.ok(f.notifications.some(state => !state.ticket && !state.context));
  assert.equal(f.requests.length, 1, 'Selector changes reuse the page definition while still re-verifying selectors');
  await f.tracker.refresh(); assert.equal(f.requests.length, 2, 'Explicit refresh fetches a fresh definition');
});

test('page loading reports real stages, can stop, and ignores late verification results', async () => {
  const f = fixture(); await f.tracker.setApp(app);
  const api = f.tracker.api, pending = Promise.withResolvers(); let signal;
  f.tracker.api = async (path, options) => {
    signal = options.signal; options.onProgress({ message: 'Checking view membership' });
    await pending.promise; return api(path, options);
  };
  const loading = f.tracker.refresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.tracker.state.loading, true); assert.ok(f.tracker.state.startedAt > 0);
  assert.equal(f.tracker.state.progress, 'Checking view membership');
  f.tracker.stop(); assert.equal(signal.aborted, true);
  pending.resolve(); await loading;
  assert.equal(f.tracker.state.ticket, ''); assert.match(f.tracker.state.error, /stopped/);
  f.tracker.api = api; await f.tracker.refresh(); assert.ok(f.tracker.state.ticket);
});

test('saved page stays pinned across tab changes and renewal tracks the saved chat revision', async () => {
  const f = fixture(); await f.tracker.setApp(app);
  const record = { id: 'saved-chat', revision: 1, page: { id: secondPageId }, messages: [{ role: 'assistant', pageContext: { model } }] };
  let body; const api = f.tracker.api;
  f.tracker.api = (path, options) => { body = options.body; return api(path, options); };
  await f.tracker.restoreSaved(app, record);
  assert.equal(body.savedConversationId, record.id); assert.equal(body.savedConversationRevision, 1);
  f.setTab({ ...observation, url: 'https://example.com' }); await f.tracker.observe();
  assert.equal(f.tracker.state.mode, 'saved'); assert.equal(f.tracker.state.context.page.id, secondPageId);
  f.tracker.savedRevision({ id: record.id, revision: 2 }); await f.tracker.refresh();
  assert.equal(body.savedConversationRevision, 2);
  await f.tracker.choose(pageId); assert.equal(body.savedConversationId, undefined);
});
test('superseded discovery cannot overwrite a new page or app', async () => {
  const f = fixture(); await f.tracker.setApp(app);
  let release;
  f.setDelay(input => input.pageId === pageId ? new Promise(resolve => { release = resolve; }) : Promise.resolve());
  const old = f.tracker.refresh();
  await new Promise(resolve => setImmediate(resolve));
  await f.tracker.choose(secondPageId); release(); await old;
  assert.equal(f.tracker.state.context.page.id, secondPageId);
  await f.tracker.setApp(null); assert.equal(f.tracker.state.ticket, '');
});
test('question snapshot refreshes expired verification and waits for ongoing observation', async () => {
  const f = fixture(); await f.tracker.setApp(app);
  f.tracker.state.expires = 0;
  const count = f.requests.length; await f.tracker.snapshot(); assert.ok(f.requests.length > count);
  let release;
  const read = f.tracker.read;
  f.tracker.read = async (...args) => { if (args[0] === 'observe') await new Promise(resolve => { release = resolve; }); return read(...args); };
  const observing = f.tracker.observe();
  let complete = false; const snapshot = f.tracker.snapshot().then(() => { complete = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(complete, false);
  release(); await observing; await snapshot; assert.equal(complete, true);
});
test('a failed tab observer still loads the dropdown for manual page context', async () => {
  const f = fixture(), read = f.tracker.read;
  f.tracker.read = async (...args) => { if (args[0] === 'observe') throw new Error('Tab observation unavailable'); return read(...args); };
  await f.tracker.setApp(app);
  assert.equal(f.tracker.state.pages.length, 2); assert.match(f.tracker.state.error, /observation unavailable/);
  await f.tracker.choose(secondPageId);
  assert.equal(f.tracker.state.context.page.id, secondPageId);
});

test('browser sign-in loss discards cached pages and recovers only after a fresh browser read', async () => {
  const f = fixture(); await f.tracker.setApp(app);
  const read = f.tracker.read;
  let failure = Object.assign(new Error('Browser authorization required'), { code: 'ANAPLAN_BROWSER_LOGIN' });
  f.tracker.read = async (...args) => {
    if (args[0] === 'read' && failure) throw failure;
    return read(...args);
  };
  await f.tracker.refresh();
  assert.equal(f.tracker.state.browserSignInRequired, true);
  assert.equal(f.tracker.state.errorCode, 'ANAPLAN_BROWSER_LOGIN');
  assert.deepEqual(f.tracker.state.pages, []); assert.equal(f.tracker.state.ticket, '');
  assert.equal(f.tracker.definitionCache, null); assert.equal(f.tracker.definition, null);
  failure = new Error('Temporary network error');
  await f.tracker.setApp({ ...app, revision: app.revision + 1 });
  assert.equal(f.tracker.state.browserSignInRequired, true, 'A retry failure must not show page controls again');
  failure = null;
  await f.tracker.refresh({ useDefinitionCache: true });
  assert.equal(f.tracker.state.browserSignInRequired, false);
  assert.equal(f.tracker.state.errorCode, ''); assert.ok(f.tracker.state.ticket);
  assert.equal(f.requests.length, 2, 'Recovery must fetch a new definition');
});

test('a stale observer failure cannot invalidate a later successful refresh', async () => {
  const f = fixture(); await f.tracker.setApp(app);
  const pending = Promise.withResolvers(), read = f.tracker.read;
  f.tracker.read = (...args) => args[0] === 'observe' ? pending.promise : read(...args);
  const old = f.tracker.observe();
  await f.tracker.refresh({ observe: false });
  pending.reject(Object.assign(new Error('Old authorization failure'), { code: 'ANAPLAN_BROWSER_LOGIN' }));
  await old;
  assert.equal(f.tracker.state.context.page.id, pageId);
  assert.equal(f.tracker.state.browserSignInRequired, false);
});

test('model authorization retains its challenge through retries without treating browser access as expired', async () => {
  const f = fixture(), api = f.tracker.api;
  const challenge = { code: 'ANAPLAN_LOGIN', url: 'https://iam.anaplan.com/test-only', userCode: 'SYNTHETIC' };
  let failure = Object.assign(new Error('Model authorization required'), challenge);
  f.tracker.api = (...args) => { if (failure) throw failure; return api(...args); };
  await f.tracker.setApp(app);
  assert.equal(f.tracker.state.modelSignInRequired, true);
  assert.equal(f.tracker.state.browserSignInRequired, false);
  assert.equal(f.tracker.state.pages.length, 2); assert.ok(f.tracker.definition);
  assert.equal(f.tracker.state.ticket, ''); assert.equal(f.tracker.state.context, null);
  await assert.rejects(f.tracker.snapshot(), challenge);
  failure = new Error('Temporary model connection failure');
  await f.tracker.setApp({ ...app, revision: app.revision + 1 });
  assert.equal(f.tracker.state.modelSignInRequired, true);
  assert.deepEqual(f.tracker.state.modelSignIn, { url: challenge.url, userCode: challenge.userCode });
  failure = null; await f.tracker.refresh();
  assert.equal(f.tracker.state.modelSignInRequired, false); assert.equal(f.tracker.state.modelSignIn, null);
  assert.doesNotMatch(JSON.stringify(await f.tracker.snapshot()), /SYNTHETIC|test-only|modelSignIn/);
});

test('each Anaplan connection recovers independently and unsafe authorization URLs are discarded', async () => {
  const f = fixture(); await f.tracker.setApp(app);
  f.tracker.setError(Object.assign(new Error('Browser sign-in'), { code: 'ANAPLAN_BROWSER_LOGIN' }));
  f.tracker.requireModelSignIn(Object.assign(new Error('Model sign-in'), { code: 'ANAPLAN_LOGIN', url: 'javascript:alert(1)', userCode: 'X'.repeat(300) }));
  assert.equal(f.tracker.state.browserSignInRequired, true); assert.equal(f.tracker.state.modelSignInRequired, true);
  assert.equal(f.tracker.state.modelSignIn.url, null); assert.equal(f.tracker.state.modelSignIn.userCode.length, 200);
  f.tracker.modelAccessConnected();
  assert.equal(f.tracker.state.browserSignInRequired, true); assert.equal(f.tracker.state.modelSignInRequired, false);
  assert.equal(f.tracker.state.modelSignIn, null); assert.equal(f.tracker.state.ticket, '');
  await f.tracker.refresh(); assert.ok(f.tracker.state.ticket); assert.equal(f.tracker.state.browserSignInRequired, false);
});

test('model sign-in failure during a saved restore invalidates old access and forwards the challenge', async () => {
  const f = fixture(); await f.tracker.setApp(app);
  const challenge = { code: 'ANAPLAN_LOGIN', url: 'https://iam.anaplan.com/test-only', userCode: 'SAVED-TEST' };
  f.tracker.api = () => { throw Object.assign(new Error('Model sign-in required'), challenge); };
  await assert.rejects(f.tracker.restoreSaved(app, { id: 'saved', revision: 1, page: { id: secondPageId }, messages: [] }), challenge);
  assert.equal(f.tracker.state.ticket, ''); assert.equal(f.tracker.state.context, null);
  assert.equal(f.tracker.state.mode, 'follow'); assert.equal(f.tracker.state.loading, false);
  assert.equal(f.tracker.state.modelSignInRequired, true); assert.equal(f.tracker.state.modelSignIn.userCode, 'SAVED-TEST');
});

test('superseded model authorization failures cannot replace verified context', async () => {
  const f = fixture(); await f.tracker.setApp(app);
  const api = f.tracker.api, pending = Promise.withResolvers();
  f.tracker.api = () => pending.promise;
  const old = f.tracker.refresh(); await new Promise(resolve => setImmediate(resolve));
  f.tracker.api = api; await f.tracker.choose(secondPageId);
  pending.reject(Object.assign(new Error('Stale sign-in'), { code: 'ANAPLAN_LOGIN', userCode: 'OLD' }));
  await old;
  assert.equal(f.tracker.state.context.page.id, secondPageId);
  assert.equal(f.tracker.state.modelSignInRequired, false); assert.equal(f.tracker.state.modelSignIn, null);
});

test('browser sign-in failure while restoring a saved chat invalidates expired access', async () => {
  const f = fixture(); await f.tracker.setApp(app);
  const read = f.tracker.read;
  f.tracker.read = (...args) => {
    if (args[0] === 'read') throw Object.assign(new Error('Browser authorization required'), { code: 'ANAPLAN_BROWSER_LOGIN' });
    return read(...args);
  };
  await assert.rejects(f.tracker.restoreSaved(app, { id: 'saved', revision: 1, page: { id: secondPageId }, messages: [] }), { code: 'ANAPLAN_BROWSER_LOGIN' });
  assert.equal(f.tracker.state.browserSignInRequired, true); assert.equal(f.tracker.state.ticket, '');
  assert.equal(f.tracker.state.context, null); assert.equal(f.tracker.state.mode, 'follow');
  assert.equal(f.tracker.state.loading, false);
});
test('an unsupported current page retains alternatives and cannot request a verification ticket', async () => {
  const f = fixture(), read = f.tracker.read;
  let verifies = 0; const api = f.tracker.api;
  f.tracker.api = (...args) => { verifies++; return api(...args); };
  f.tracker.read = async (...args) => {
    if (args[0] === 'read' && args[1].pageId === pageId) return { pages: [{ id: pageId, name: 'Report', type: 'reports' }, { id: secondPageId, name: 'Costs', type: 'boards' }], unavailableReason: 'Xanaplan cannot read report pages yet.' };
    return read(...args);
  };
  await f.tracker.setApp(app);
  assert.equal(verifies, 0); assert.equal(f.tracker.state.pages.length, 2); assert.equal(f.tracker.state.ticket, '');
  assert.match(f.tracker.state.error, /report pages/);
  await f.tracker.choose(secondPageId); assert.equal(f.tracker.state.context.page.id, secondPageId);
});

test('failed saved-page restoration preserves the active app, page, ticket and manual selection behavior', async () => {
  const f = fixture(); await f.tracker.setApp(app);
  const before = structuredClone(f.tracker.state), api = f.tracker.api;
  f.tracker.api = (path, options) => { if (options.body.savedConversationId) throw new Error('Saved page is unavailable'); return api(path, options); };
  await assert.rejects(f.tracker.restoreSaved({ ...app, key: 'another-app' }, { id: 'saved-chat', revision: 1, page: { id: secondPageId }, messages: [] }), /unavailable/);
  assert.equal(f.tracker.app.key, app.key); assert.equal(f.tracker.state.mode, 'follow');
  assert.equal(f.tracker.state.ticket, before.ticket); assert.deepEqual(f.tracker.state.context, before.context);
  assert.equal(f.tracker.state.error, ''); assert.equal(f.tracker.saved, null);
  await f.tracker.choose(secondPageId); assert.equal(f.tracker.state.context.page.id, secondPageId);
});

test('stopping or superseding a saved-page restore cannot replace a newer page', async () => {
  const f = fixture(); await f.tracker.setApp(app);
  const before = structuredClone(f.tracker.state), api = f.tracker.api;
  for (const superseded of [false, true]) {
    const pending = Promise.withResolvers(), started = Promise.withResolvers();
    f.tracker.api = async (path, options) => { if (options.body.savedConversationId) { started.resolve(); await pending.promise; } return api(path, options); };
    const restoring = f.tracker.restoreSaved(app, { id: 'saved', revision: 1, page: { id: secondPageId }, messages: [] });
    const rejected = assert.rejects(restoring, { name: 'AbortError' });
    await started.promise;
    assert.equal(f.tracker.state.context.page.id, before.context.page.id, 'Current context remains available during restoration');
    if (superseded) await f.tracker.choose(secondPageId); else f.tracker.stop();
    pending.resolve(); await rejected;
    assert.equal(f.tracker.state.context.page.id, superseded ? secondPageId : before.context.page.id);
    assert.equal(f.tracker.state.error, ''); assert.equal(f.tracker.state.loading, false);
  }
});
