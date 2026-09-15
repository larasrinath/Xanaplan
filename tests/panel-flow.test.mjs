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
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { Store } from '../server/store.mjs';
import { ConversationStore } from '../server/conversations.mjs';
import { createApp } from '../server/app.mjs';
import { streamRequest } from './http-client.mjs';
import { pageDefinition } from '../extension/page-api.mjs';
import { capturePageSelections } from '../extension/page-observer.mjs';
import { app, model, board, catalog, pageId, secondPageId, observation, syntheticMcp } from './fixtures/page.mjs';

const until = async condition => {
  for (let count = 0; count < 100; count++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('DOM flow did not reach the expected state.');
};

test('selector observer reads only labeled page/card controls from synthetic DOM', () => {
  const dom = new JSDOM(`<h2 data-test-id="inline-page-title__title">Performance</h2><span data-test-id="model-select-name">Synthetic planning</span><ul><li data-test-id="page-level-context-selector"><button data-test-id="board-context-filter-501-button" data-selected-label="Jan 26">Jan 26</button></li></ul><article id="widget-wrapper-budget"><button data-test-id="card-context-filter-502-button" data-selected-label="Budget">Budget</button></article><input value="Do not collect me"><div>Do not collect business values</div>`, { url: observation.url, runScripts: 'outside-only' });
  dom.window.Element.prototype.getClientRects = () => [{ width: 10 }];
  const result = dom.window.eval(`(${capturePageSelections.toString()})()`);
  assert.equal(result.selections.length, 2); assert.equal(result.selections[0].cardId, ''); assert.equal(result.selections[1].cardId, 'budget');
  assert.equal(result.selections[0].dimensionId, '501'); assert.equal(result.modelName, model.name);
  assert.doesNotMatch(JSON.stringify(result), /Do not collect/); dom.window.close();
});

test('DOM end-to-end: navigate during an answer, retain its context, resume either page, and stop explicitly', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'xanaplan-dom-'));
  const otherAppId = '00000000-0000-0000-0000-000000000004';
  const otherApp = { ...app, appId: otherAppId, key: app.key.replace(app.appId, otherAppId), name: 'Assortment Planning' };
  const store = new Store(directory); store.saveApp({ ...otherApp, revision: 0 }); store.saveApp({ ...app, revision: 0 });
  const mcp = syntheticMcp(); mcp.clientId = () => 'synthetic'; mcp.available = () => true;
  let pendingResolve, delayAnswer = false, failAnswer = false, failSave = false, failRestore = false, tab = structuredClone(observation), navigationCalls = 0;
  const tabUpdates = new Set(), chatRequests = [];
  const providerStatus = { installed: true, loggedIn: true, method: 'SYNTHETIC' };
  const providers = {
    status: async () => ({ llm: store.getLlm(), provider: { ...providerStatus, id: 'claude' }, connections: { claude: providerStatus, openai: providerStatus } }),
    select: () => ({ settings: store.getLlm(), check() {}, decide: async payload => {
      if (delayAnswer) await new Promise(resolve => { pendingResolve = resolve; });
      if (failAnswer) throw Object.assign(new Error('Synthetic answer unavailable.'), { status: 503 });
      if (!payload.evidence.length) return { kind: 'read', tool: 'read_cells', arguments: JSON.stringify({ modelKey: model.key, moduleId: '101', viewId: '101', sourceId: 'revenue:0' }) };
      return { kind: 'answer', answer: 'Synthetic revenue: 120, Jan 26 Actual.', sourceIds: [1] };
    } }),
  };
  const conversations = new ConversationStore(join(directory, 'conversations'));
  const saveTurn = conversations.saveTurn.bind(conversations);
  conversations.saveTurn = (...args) => { if (failSave) throw new Error('Synthetic disk unavailable.'); return saveTurn(...args); };
  const helper = createApp({ store, mcp, providers, conversations });
  const dom = new JSDOM(readFileSync(new URL('../extension/panel.html', import.meta.url), 'utf8'), { url: 'https://synthetic.invalid/panel.html', pretendToBeVisual: true });
  dom.window.Element.prototype.scrollIntoView = () => {};
  const originals = new Map();
  const install = (name, value) => { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, writable: true, configurable: true }); };
  install('document', dom.window.document); install('window', dom.window); install('Option', dom.window.Option); install('localStorage', dom.window.localStorage);
  install('addEventListener', dom.window.addEventListener.bind(dom.window)); install('removeEventListener', dom.window.removeEventListener.bind(dom.window));
  install('fetch', async (url, options = {}) => {
    assert.ok(url.startsWith('http://synthetic.local/'), 'Never contact real services from a DOM test');
    if (url.endsWith('/chat')) chatRequests.push({ body: JSON.parse(options.body), signal: options.signal });
    if (failRestore && url.endsWith('/page-context') && JSON.parse(options.body).savedConversationId) return Response.json({ error: 'Saved page is unavailable. Continue on the current page instead.' }, { status: 422 });
    return streamRequest(helper, store, options.method || 'GET', new URL(url).pathname, options.body ? JSON.parse(options.body) : undefined, { signal: options.signal });
  });
  install('chrome', { tabs: { query: async () => [{ id: 1, url: tab.url }], update: () => { navigationCalls++; }, create: () => { navigationCalls++; }, onUpdated: { addListener: listener => tabUpdates.add(listener), removeListener: listener => tabUpdates.delete(listener) } }, runtime: { sendMessage: async message => {
    assert.equal(message.target, 'page-background');
    if (message.action === 'cancel') return { ok: true };
    if (message.action === 'observe') return { ok: true, result: structuredClone(tab) };
    const selected = message.input.pageId || pageId;
    const selectedApp = message.input.appId === otherApp.appId ? otherApp : app;
    const result = pageDefinition({ ...board, appGuid: selectedApp.appId }, { id: pageId, type: 'boards' }, selectedApp);
    result.page = { id: selected, name: selected === pageId ? 'Performance' : 'Costs', type: 'boards' };
    return { ok: true, result: { ...result, pages: catalog.pages.map(page => ({ id: page.identifier, name: page.name, type: 'boards' })) } };
  } } });
  t.after(() => {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    for (const [name, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    dom.window.close(); rmSync(directory, { recursive: true, force: true });
  });
  let source = readFileSync(new URL('../extension/panel.js', import.meta.url), 'utf8');
  source = source.replace("'./local-config.js'", JSON.stringify('data:text/javascript,' + encodeURIComponent("export const connection={baseUrl:'http://synthetic.local',token:'synthetic'};")));
  source = source.replace(/from (['"])(\.\/[^'"]+)\1/g, (_, quote, path) => `from ${JSON.stringify(new URL(path, new URL('../extension/panel.js', import.meta.url)).href)}`);
  await import('data:text/javascript,' + encodeURIComponent(source));
  const $ = id => dom.window.document.getElementById(id);
  const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
  await until(() => !$('send').disabled);
  assert.equal($('chat-app').value, app.key, 'Follow mode matches the browser instead of keeping the first saved app');
  assert.equal($('context-controls').open, false);
  assert.equal($('current-page-label').textContent, 'Performance');
  assert.match($('welcome-greeting').textContent, /^Good (morning|afternoon|evening)\./);
  assert.equal($('starter-questions').children.length, 3);
  const suggestion = $('starter-questions').firstElementChild;
  assert.match(suggestion.dataset.question, /Revenue.*Jan 26/);
  suggestion.click();
  assert.equal($('question').value, suggestion.dataset.question);
  assert.equal($('messages').children.length, 0, 'Choosing a starter only drafts the question');
  $('context-controls').open = true;
  await until(() => $('context-controls').querySelector('summary').getAttribute('aria-label') === 'Close page menu: Performance');
  assert.equal($('current-page-label').textContent, 'Performance');
  assert.equal($('context-controls').textContent.includes('App & page'), false);
  assert.match($('chat-page').selectedOptions[0].textContent, /Performance/);
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal($('context-controls').open, false);
  assert.equal(dom.window.document.activeElement, $('context-controls').querySelector('summary'));
  await until(() => $('current-page-label').textContent === 'Performance');
  $('navigation-menu').open = true; $('admin-tab').click();
  assert.equal($('navigation-menu').open, false); assert.equal($('admin-view').hidden, false);
  $('new-chat').click(); assert.equal($('admin-view').hidden, true); assert.equal($('assistant-view').hidden, false);
  $('navigation-menu').open = true;
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal($('navigation-menu').open, false); assert.equal(dom.window.document.activeElement, $('navigation-toggle'));
  assert.equal($('page-status').hidden, true);
  assert.equal($('page-selections').textContent, 'Page selections: Jan 26 · Actual');
  assert.equal($('page-selections').hidden, false);
  assert.doesNotMatch($('live-context').textContent, /Budget|Context details|Context v|Managed in Admin|modules|Selection 501/);
  assert.equal($('question').placeholder, 'What would you like to understand?');
  assert.equal($('question-form').contains($('question-status')), false);
  assert.equal($('question-form').querySelectorAll('button').length, 1);
  assert.equal($('send').dataset.action, 'send'); assert.equal($('send').type, 'submit');
  assert.equal($('send').getAttribute('aria-label'), 'Send message');
  $('question').value = 'Revenue? Why?'; $('question').setSelectionRange(8, 9);
  $('question').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', altKey: true, cancelable: true }));
  assert.equal($('question').value, 'Revenue?\nWhy?'); assert.equal($('messages').children.length, 0);
  assert.equal($('question').selectionStart, 9);
  $('question').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, cancelable: true }));
  assert.equal($('messages').children.length, 0, 'IME confirmation must not submit a question');
  $('question').value = 'Revenue?'; $('question').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  await until(() => $('messages').querySelectorAll('.assistant').length === 1);
  assert.match($('messages').textContent, /Synthetic revenue/); assert.match($('messages').textContent, /Time: Jan 26/);
  assert.equal($('chat-save-status').textContent, 'Saved locally');
  assert.equal($('question-activity').hidden, true);
  assert.equal($('send').dataset.action, 'send'); assert.equal($('send').disabled, false);
  assert.match($('activity-log').textContent, /Pulling the latest numbers.*Read 1 received.*Preparing the answer/s);
  assert.equal($('page-details'), null); assert.equal($('page-status').hidden, true);
  assert.match($('chat-page').selectedOptions[0].textContent, /Performance/);
  $('new-chat').click(); assert.equal($('messages').children.length, 0);
  $('history-toggle').click(); await until(() => $('history-list').querySelectorAll('.history-item').length === 1 && !$('history-refresh').disabled);
  assert.equal($('live-context').hidden, true);
  $('history-search').value = 'not a real question'; $('history-search').dispatchEvent(new dom.window.Event('input'));
  assert.match($('history-list').textContent, /No matching chats/);
  $('history-search').value = ''; $('history-search').dispatchEvent(new dom.window.Event('input'));
  $('history-list').querySelector('.history-item').click(); await until(() => $('chat-history').hidden && $('messages').querySelectorAll('.assistant').length === 1);
  change('chat-page', secondPageId); await until(() => $('current-page-label').textContent === 'Costs' && !$('send').disabled);
  assert.equal($('page-selections').textContent, 'From current tab: Jan 26 · Actual');
  assert.equal(navigationCalls, 0); assert.equal($('messages').children.length, 0);
  $('history-toggle').click(); await until(() => !$('history-refresh').disabled);
  $('history-list').querySelector('.history-item').click(); await until(() => !$('saved-chat-heading').hidden);
  assert.equal($('question-form').hidden, true); assert.equal($('live-context').hidden, true);
  assert.match($('messages').textContent, /Synthetic revenue/); assert.equal(navigationCalls, 0);
  $('history-back').click(); assert.equal($('messages').children.length, 0); assert.equal($('live-context').hidden, false);
  change('chat-page', ''); await until(() => $('current-page-label').textContent === 'Performance' && !$('send').disabled);
  assert.equal($('messages').querySelectorAll('.assistant').length, 1);
  delayAnswer = true; $('question').value = 'Another question'; $('question-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await until(() => pendingResolve);
  await until(() => $('activity-status').textContent.includes('Interpreting your question'));
  assert.equal($('question-activity').hidden, false);
  assert.equal($('send').dataset.action, 'stop'); assert.equal($('send').disabled, false);
  assert.equal($('send').type, 'button'); assert.equal($('send').getAttribute('aria-label'), 'Stop answer');
  assert.equal($('question-status').hidden, true);
  const runningRequest = chatRequests.at(-1);
  tab = { ...structuredClone(observation), url: observation.url.replace(pageId, secondPageId), pageName: 'Costs', selections: observation.selections.map(item => item.dimensionId === '501' ? { ...item, label: 'Feb 26' } : item) };
  for (const listener of tabUpdates) listener(1, { url: tab.url });
  await until(() => $('current-page-label').textContent === 'Costs' && $('page-selections').textContent.includes('Feb 26'));
  assert.equal(runningRequest.signal.aborted, false, 'Browser navigation must not cancel an answer');
  assert.equal($('messages').querySelectorAll('.user').length, 2, 'Keep the running conversation visible');
  assert.equal($('activity-page').textContent, 'Answering for Performance'); assert.equal($('activity-page').hidden, false);
  change('chat-page', secondPageId); await until(() => $('context-mode-label').textContent === 'Chosen');
  assert.equal(runningRequest.signal.aborted, false, 'Changing the chat page must not cancel an answer either');
  delayAnswer = false; pendingResolve();
  await until(() => $('send').dataset.action === 'send');
  assert.equal($('question-activity').hidden, true);
  assert.equal($('messages').querySelectorAll('.assistant').length, 2); assert.equal($('question').value, ''); assert.equal(navigationCalls, 0);
  assert.match($('messages').lastElementChild.textContent, /Performance.*Jan 26/s);
  assert.equal($('saved-chat-heading').hidden, false); assert.equal($('history-continue').disabled, false); assert.equal($('history-use-saved').disabled, false);
  const completedRecord = (await streamRequest(helper, store, 'GET', `/conversations/${runningRequest.body.conversationId}`)).json();
  const saved = (await completedRecord).conversation;
  assert.equal(saved.page.id, pageId);
  assert.equal(saved.messages.at(-1).pageContext.sources[0].filters.find(filter => filter.dimensionId === '501').itemId, '601', 'Save the original January selections, not the new page’s February selection');
  $('history-back').click();
  tab = structuredClone(observation);
  change('chat-page', ''); await until(() => $('current-page-label').textContent === 'Performance' && !$('send').disabled);
  change('chat-page', secondPageId); await until(() => $('current-page-label').textContent === 'Costs' && !$('send').disabled);
  assert.equal($('messages').children.length, 0);
  pendingResolve = null; delayAnswer = true;
  $('question').value = 'Stop this question'; $('question-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await until(() => pendingResolve);
  assert.equal($('question').value, '', 'Stop works after the submitted draft has been cleared');
  $('send').click();
  assert.equal($('send').disabled, true); assert.equal($('send').getAttribute('aria-label'), 'Stopping answer');
  delayAnswer = false; pendingResolve();
  await until(() => $('question-activity').hidden && !$('send').disabled);
  assert.equal($('send').dataset.action, 'send'); assert.equal($('send').type, 'submit');
  assert.equal($('send').getAttribute('aria-label'), 'Send message'); assert.equal($('send').title, 'Send message (Enter)');
  assert.equal($('question').value, 'Stop this question'); assert.equal($('messages').children.length, 0);
  failAnswer = true; $('send').click();
  await until(() => $('notice').textContent.includes('Synthetic answer unavailable'));
  assert.equal($('question-activity').hidden, true); assert.equal($('send').disabled, false);
  assert.equal($('send').dataset.action, 'send'); assert.equal($('send').type, 'submit');
  assert.equal($('send').getAttribute('aria-label'), 'Send message');
  assert.equal($('question').value, 'Stop this question'); assert.equal($('messages').children.length, 0);
  failAnswer = false;
  $('history-toggle').click(); await until(() => !$('history-refresh').disabled);
  $('history-list').querySelector('.history-item').click(); await until(() => !$('saved-chat-heading').hidden);
  assert.match($('saved-chat-reason').textContent, /Continue using Costs/);
  failRestore = true; $('history-use-saved').click();
  await until(() => !$('history-use-saved').disabled && $('notice').textContent.includes('Saved page is unavailable'));
  assert.equal($('saved-chat-heading').hidden, false); assert.equal($('history-continue').disabled, false);
  assert.equal($('current-page-label').textContent, 'Costs'); assert.equal($('page-status').hidden, true);
  assert.doesNotMatch($('page-status').textContent, /Saved page is unavailable/);
  failRestore = false;
  $('history-continue').click(); await until(() => !$('question-form').hidden && !$('send').disabled);
  assert.equal($('messages').querySelectorAll('.assistant').length, 2);
  $('question').value = 'Follow up on Costs'; $('question-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await until(() => $('messages').querySelectorAll('.assistant').length === 3);
  assert.match($('messages').querySelector('.context-change').textContent, /Costs/);
  assert.equal($('chat-save-status').textContent, 'Saved locally'); assert.equal(navigationCalls, 0);
  change('chat-page', ''); await until(() => $('current-page-label').textContent === 'Performance' && !$('send').disabled);
  tab = { ...observation, selections: observation.selections.map(item => item.dimensionId === '501' ? { ...item, label: 'Feb 26' } : item) };
  $('refresh-page').click(); await until(() => $('page-selections').textContent.includes('Feb 26') && !$('send').disabled);
  assert.match($('starter-questions').textContent, /Feb 26/); assert.doesNotMatch($('starter-questions').textContent, /Jan 26/);
  $('history-toggle').click(); await until(() => !$('history-refresh').disabled);
  $('history-list').querySelector('.history-item').click(); await until(() => !$('saved-chat-heading').hidden);
  assert.equal($('history-use-saved').disabled, false);
  $('history-use-saved').click(); await until(() => !$('question-form').hidden && !$('send').disabled);
  assert.equal($('current-page-label').textContent, 'Costs'); assert.equal($('context-mode-label').textContent, 'Saved');
  assert.match($('page-selections').textContent, /Saved selections: Jan 26/);
  assert.doesNotMatch($('page-selections').textContent, /Feb 26/);
  $('question').value = 'Follow up with saved selections'; $('question-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await until(() => $('messages').querySelectorAll('.assistant').length === 4);
  assert.match($('messages').lastElementChild.textContent, /Saved chat context/);
  const read = mcp.calls.findLast(call => call.tool === 'read_cells');
  assert.equal(read.args.pages.find(item => item.dimensionId === '501').itemId, '601');
  $('refresh-page').click(); await until(() => !$('send').disabled);
  assert.equal($('messages').querySelectorAll('.assistant').length, 4, 'Renewing saved-page verification keeps the same thread');
  assert.equal(navigationCalls, 0);
  tab = { ...observation, url: 'https://example.com' };
  change('chat-page', ''); await until(() => $('page-status').dataset.error === 'true');
  assert.equal($('context-controls').open, false); assert.equal($('current-page-label').textContent, 'Choose a page');
  tab = structuredClone(observation); $('refresh-page').click();
  await until(() => !$('send').disabled);
  assert.equal($('context-controls').open, false); assert.equal($('current-page-label').textContent, 'Performance');

  // Even a disk failure after cross-app navigation must leave the answer visible.
  $('new-chat').click(); pendingResolve = null; delayAnswer = true; failSave = true;
  $('question').value = 'Keep this answer visible'; $('send').click();
  await until(() => pendingResolve);
  const originalRequest = chatRequests.at(-1);
  tab = { ...observation, url: observation.url.replace(app.appId, otherAppId) };
  for (const listener of tabUpdates) listener(1, { url: tab.url });
  await until(() => $('chat-app').value === otherApp.key && $('context-mode-label').textContent === 'Live');
  assert.equal(originalRequest.signal.aborted, false);
  assert.equal($('send').dataset.action, 'stop');
  delayAnswer = false; pendingResolve();
  await until(() => !$('saved-chat-heading').hidden && $('send').dataset.action === 'send');
  assert.match($('messages').textContent, /Synthetic revenue/);
  assert.equal($('messages').querySelectorAll('.copy-answer').length, 1);
  assert.match($('saved-chat-context').textContent, /Planning/);
  assert.match($('saved-chat-reason').textContent, /could not be saved/);
  assert.equal($('chat-save-status').textContent, 'Not saved');
  assert.equal($('history-continue').disabled, true); assert.equal($('history-use-saved').disabled, true);
  assert.throws(() => conversations.get(originalRequest.body.conversationId), /not found/);
  failSave = false; $('history-back').click();

  // Manual app selection remains pinned until the user explicitly follows the tab.
  $('context-controls').open = true; change('chat-app', app.key);
  await until(() => $('page-status').textContent === 'Choose a page for this chat.');
  assert.equal($('chat-app').value, app.key); assert.equal($('context-controls').open, true);
  change('chat-page', secondPageId);
  await until(() => $('current-page-label').textContent === 'Costs' && $('context-mode-label').textContent === 'Chosen');
  assert.equal($('chat-app').value, app.key); assert.equal($('context-controls').open, false);
  $('context-controls').open = true; $('follow-tab').click();
  await until(() => $('chat-app').value === otherApp.key && $('follow-tab').getAttribute('aria-pressed') === 'true' && !$('context-controls').open);
  $('context-controls').open = true; $('welcome-greeting').click();
  assert.equal($('context-controls').open, false);
});
