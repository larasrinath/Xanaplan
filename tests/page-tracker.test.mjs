import test from 'node:test';
import assert from 'node:assert/strict';
import { PageTracker } from '../extension/page-tracker.mjs';
import { pageDefinition } from '../extension/page-api.mjs';
import { app, pageId, secondPageId, board, catalog, observation } from './fixtures/page.mjs';

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
  assert.equal(f.tracker.state.ticket, ''); assert.match(f.tracker.state.error, /Open a page/);
});
test('new selections create a fresh thread identity and invalidate previous context immediately', async () => {
  const f = fixture(); await f.tracker.setApp(app);
  const previous = f.tracker.state.context.fingerprint;
  f.setTab({ ...observation, selections: [{ ...observation.selections[0], label: 'Feb 26' }] });
  await f.tracker.observe();
  assert.notEqual(f.tracker.state.context.fingerprint, previous);
  assert.ok(f.notifications.some(state => !state.ticket && !state.context));
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
