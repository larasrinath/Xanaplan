import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { request } from './http-client.mjs';
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

test('DOM end-to-end: initialize Assistant, answer, change chat page, resume tab, cancel stale answer', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'xanaplan-dom-'));
  const store = new Store(directory); store.saveApp({ ...app, revision: 0 });
  const mcp = syntheticMcp(); mcp.clientId = () => 'synthetic'; mcp.available = () => true;
  let pendingResolve, delayAnswer = false, tab = structuredClone(observation), navigationCalls = 0;
  const providerStatus = { installed: true, loggedIn: true, method: 'SYNTHETIC' };
  const providers = {
    status: async () => ({ llm: store.getLlm(), provider: { ...providerStatus, id: 'claude' }, connections: { claude: providerStatus, openai: providerStatus } }),
    select: () => ({ settings: store.getLlm(), check() {}, decide: async payload => {
      if (delayAnswer) await new Promise(resolve => { pendingResolve = resolve; });
      if (!payload.evidence.length) return { kind: 'read', tool: 'read_cells', arguments: JSON.stringify({ modelKey: model.key, moduleId: '101', viewId: '101', sourceId: 'revenue:0' }) };
      return { kind: 'answer', answer: 'Synthetic revenue: 120, Jan 26 Actual.', sourceIds: [1] };
    } }),
  };
  const helper = createApp({ store, mcp, providers });
  const dom = new JSDOM(readFileSync(new URL('../extension/panel.html', import.meta.url), 'utf8'), { url: 'https://synthetic.invalid/panel.html' });
  dom.window.Element.prototype.scrollIntoView = () => {};
  const originals = new Map();
  const install = (name, value) => { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, writable: true, configurable: true }); };
  install('document', dom.window.document); install('window', dom.window); install('Option', dom.window.Option); install('localStorage', dom.window.localStorage);
  install('addEventListener', dom.window.addEventListener.bind(dom.window)); install('removeEventListener', dom.window.removeEventListener.bind(dom.window));
  install('fetch', async (url, options = {}) => {
    assert.ok(url.startsWith('http://synthetic.local/'), 'Never contact real services from a DOM test');
    const result = await request(helper, store, options.method || 'GET', new URL(url).pathname, options.body ? JSON.parse(options.body) : undefined);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
  });
  install('chrome', { tabs: { query: async () => [{ id: 1, url: tab.url }], update: () => { navigationCalls++; }, create: () => { navigationCalls++; } }, runtime: { sendMessage: async message => {
    assert.equal(message.target, 'page-background');
    if (message.action === 'cancel') return { ok: true };
    if (message.action === 'observe') return { ok: true, result: structuredClone(tab) };
    const selected = message.input.pageId || pageId;
    const result = pageDefinition(board, { id: pageId, type: 'boards' }, app);
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
  assert.match($('page-status').textContent, /Performance/);
  assert.equal($('page-selections').textContent, 'Page selections: Jan 26 · Actual');
  assert.equal($('page-selections').hidden, false);
  assert.doesNotMatch($('live-context').textContent, /Budget|Context details|Context v|Managed in Admin|modules|Selection 501/);
  $('question').value = 'Revenue?'; $('question-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await until(() => $('messages').querySelectorAll('.assistant').length === 1);
  assert.match($('messages').textContent, /Synthetic revenue/); assert.match($('messages').textContent, /Time: Jan 26/);
  assert.equal($('chat-save-status').textContent, 'Saved locally');
  assert.equal($('page-details'), null); assert.equal($('page-status').hidden, true);
  assert.match($('chat-page').selectedOptions[0].textContent, /Performance/);
  $('new-chat').click(); assert.equal($('messages').children.length, 0);
  $('history-toggle').click(); await until(() => $('history-list').querySelectorAll('.history-item').length === 1 && !$('history-refresh').disabled);
  assert.equal($('live-context').hidden, true);
  $('history-search').value = 'not a real question'; $('history-search').dispatchEvent(new dom.window.Event('input'));
  assert.match($('history-list').textContent, /No matching chats/);
  $('history-search').value = ''; $('history-search').dispatchEvent(new dom.window.Event('input'));
  $('history-list').querySelector('.history-item').click(); await until(() => $('chat-history').hidden && $('messages').querySelectorAll('.assistant').length === 1);
  change('chat-page', secondPageId); await until(() => $('page-status').textContent.includes('Costs') && !$('send').disabled);
  assert.equal($('page-selections').textContent, 'From current tab: Jan 26 · Actual');
  assert.equal(navigationCalls, 0); assert.equal($('messages').children.length, 0);
  $('history-toggle').click(); await until(() => !$('history-refresh').disabled);
  $('history-list').querySelector('.history-item').click(); await until(() => !$('saved-chat-heading').hidden);
  assert.equal($('question-form').hidden, true); assert.equal($('live-context').hidden, true);
  assert.match($('messages').textContent, /Synthetic revenue/); assert.equal(navigationCalls, 0);
  $('history-back').click(); assert.equal($('messages').children.length, 0); assert.equal($('live-context').hidden, false);
  change('chat-page', ''); await until(() => $('page-status').textContent.includes('Performance') && !$('send').disabled);
  assert.equal($('messages').querySelectorAll('.assistant').length, 1);
  delayAnswer = true; $('question').value = 'Another question'; $('question-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await until(() => pendingResolve);
  change('chat-page', secondPageId); await until(() => $('page-status').textContent.includes('Costs'));
  delayAnswer = false; pendingResolve();
  await until(() => $('cancel-question').hidden);
  assert.equal($('messages').children.length, 0); assert.equal($('question').value, 'Another question'); assert.equal(navigationCalls, 0);
});
