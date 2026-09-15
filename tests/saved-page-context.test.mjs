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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.mjs';
import { ConversationStore } from '../server/conversations.mjs';
import { createApp } from '../server/app.mjs';
import { verifyPageContext } from '../server/page-context.mjs';
import { createPageScope } from '../server/page-scope.mjs';
import { readChatStream } from '../extension/chat-stream.mjs';
import { pageDefinition } from '../extension/page-api.mjs';
import { request, streamRequest } from './http-client.mjs';
import { app, model, pageId, board, observation, syntheticMcp } from './fixtures/page.mjs';
import { storeFixture } from './fixtures/stores.mjs';

async function fixture(t, { pageObservation = observation } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'xanaplan-saved-page-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory); store.saveApp({ ...app, revision: 0 });
  const conversations = new ConversationStore(join(directory, 'conversations')), mcp = syntheticMcp();
  const providers = { select: () => ({ settings: store.getLlm(), check() {}, decide: async () => ({ kind: 'answer', answer: 'Saved example', sourceIds: [] }) }) };
  const server = createApp({ store, mcp, conversations, providers });
  const input = { appKey: app.key, revision: 1, definition: pageDefinition(board, { id: pageId, type: 'boards' }, app), observation: pageObservation };
  const verified = await request(server, store, 'POST', '/page-context', input);
  const answered = await request(server, store, 'POST', '/chat', { appKey: app.key, revision: 1, question: 'First?', pageTicket: verified.body.ticket });
  assert.equal(answered.status, 200);
  const saved = conversations.get(answered.body.conversation.id);
  return { server, store, mcp, conversations, saved, input: { ...input, savedConversationId: saved.id, savedConversationRevision: saved.revision } };
}

test('restoration streams verification and uses authoritative saved filters despite changed tab or supplied filters', async t => {
  const { server, store, conversations, saved, input } = await fixture(t);
  const before = conversations.get(saved.id);
  assert.equal(before.messages[1].pageContext.selectionContext, undefined);
  const response = await streamRequest(server, store, 'POST', '/page-context', { ...input, stream: true, modelKey: 'untrusted',
    observation: { ...observation, selections: [] }, savedContext: { sources: [] } });
  const events = [], restored = await readChatStream(response, { onProgress: event => events.push(event) });
  assert.ok(events.some(event => event.stage === 'verification')); assert.ok(restored.ticket);
  assert.equal(restored.context.mode, 'saved');
  assert.equal(restored.context.sources[0].filters.find(filter => filter.dimensionId === '501').itemId, '601');
  assert.equal(restored.context.sources[1].filters.find(filter => filter.dimensionId === '502').itemId, '604');
  assert.deepEqual(conversations.get(saved.id), before, 'Restoring alone never changes saved history');
});

test('restoration rejects stale conversations, changed cards and unavailable saved selections', async t => {
  const f = await fixture(t), before = f.conversations.get(f.saved.id);
  const restore = input => request(f.server, f.store, 'POST', '/page-context', input);
  assert.equal((await restore({ ...f.input, savedConversationRevision: 0 })).status, 409);
  const changed = structuredClone(f.input); changed.definition.definitionRevision = 'new-publication';
  assert.equal((await restore(changed)).status, 422);
  const removedCard = structuredClone(f.input); removedCard.definition.sources.pop();
  assert.equal((await restore(removedCard)).status, 422);
  f.mcp.items['501'] = [{ ID: '602', Name: 'Feb 26' }];
  const missing = await restore(f.input);
  assert.equal(missing.status, 422); assert.match(missing.body.error, /saved cards or selections/);
  assert.deepEqual(f.conversations.get(f.saved.id), before);
});

test('saved custom-card restoration retains off-axis filters and module-evidence limitations', async () => {
  const f = storeFixture();
  const definition = pageDefinition(f.definition, { id: pageId, type: 'boards' }, app);
  const context = await verifyPageContext({ app, mcp: f.mcp, input: { revision: 1, definition, observation: f.observed } });
  delete context.selectionContext;
  const restored = await verifyPageContext({ app, mcp: f.mcp, savedContext: context, input: { revision: 1, definition, modelKey: model.key, observation: {} } });
  const gate = createPageScope(restored, { mcp: f.mcp, model, question: 'How many stores?' });
  const evidence = await gate.execute('read_module_cells', { sourceId: 'stores:0', moduleId: '101' });
  assert.equal(evidence.coverage.exactCard, false);
  assert.equal(evidence.pendingFilters[0].label, 'Canada');
  assert.equal(evidence.pendingFilters[0].origin, 'saved selection');
  assert.equal(evidence.arguments.pages[0].itemId, '603');
  await assert.rejects(gate.execute('read_cells', { sourceId: 'stores:0', moduleId: '101', viewId: '101' }), /reproduced|filters|substitute/);
});

test('page verification sends progress before a slow metadata read and cancels on disconnect', async t => {
  const f = await fixture(t), read = f.mcp.read;
  const waiting = Promise.withResolvers(), stopped = Promise.withResolvers(); let slow = true;
  f.mcp.read = async (tool, args, selected, signal) => {
    if (slow && tool === 'show_modules') await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { stopped.resolve(); reject(Object.assign(new Error('Cancelled'), { status: 499 })); }, { once: true });
      waiting.resolve();
    });
    return read(tool, args, selected, signal);
  };
  const controller = new AbortController(), updated = Promise.withResolvers();
  const response = await streamRequest(f.server, f.store, 'POST', '/page-context', { ...f.input, stream: true }, { signal: controller.signal });
  const result = readChatStream(response, { signal: controller.signal, onProgress: () => updated.resolve() });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await waiting.promise; await updated.promise; controller.abort(); await stopped.promise; await rejected;
  slow = false;
  assert.equal((await request(f.server, f.store, 'POST', '/page-context', f.input)).status, 200);
});

test('a saved chat with unknown selections reopens while exact reads still require clarification', async t => {
  const f = await fixture(t, { pageObservation: { ...observation, selections: observation.selections.filter(item => item.dimensionId === '501') } });
  const restored = await request(f.server, f.store, 'POST', '/page-context', f.input);
  assert.equal(restored.status, 200); assert.ok(restored.body.ticket);
  const context = restored.body.context;
  assert.ok(context.sources[0].missing.some(message => message.includes('Versions')));
  assert.equal(context.sources[0].filters.find(item => item.dimensionId === '502'), undefined);
  const gate = createPageScope(context, { mcp: f.mcp, model, question: 'Show revenue using Actual' });
  assert.match((await gate.execute('show_modules', {})).text, /Revenue/);
  await assert.rejects(gate.execute('read_cells', { sourceId: 'revenue:0', moduleId: '101', viewId: '101' }), /missing page context|Specify/);
  assert.equal(f.mcp.calls.some(call => call.tool === 'read_cells'), false);
  const result = await gate.execute('read_cells', { sourceId: 'revenue:0', moduleId: '101', viewId: '101', contextOverrides: [{ dimensionId: '502', itemName: 'Actual', questionQuote: 'using Actual' }] });
  assert.equal(result.arguments.pages.find(item => item.dimensionId === '502').itemId, '603');
  const renewed = await verifyPageContext({ app, mcp: f.mcp, savedContext: context, input: { revision: 1, definition: f.input.definition, modelKey: model.key, observation: {} } });
  assert.equal(renewed.fingerprint, context.fingerprint);
});

test('restored custom cards retain unknown off-axis context until an explicit override resolves it', async () => {
  const f = storeFixture(), definition = pageDefinition(f.definition, { id: pageId, type: 'boards' }, app);
  const observed = { ...f.observed, selections: f.observed.selections.filter(item => item.dimensionId !== '501') };
  const savedContext = await verifyPageContext({ app, mcp: f.mcp, input: { revision: 1, definition, observation: observed } });
  delete savedContext.selectionContext;
  const context = await verifyPageContext({ app, mcp: f.mcp, savedContext, input: { revision: 1, definition, modelKey: model.key, observation: {} } });
  const gate = createPageScope(context, { mcp: f.mcp, model, question: 'Show stores in Canada' });
  const args = { sourceId: 'stores:0', moduleId: '101' };
  const evidence = await gate.execute('read_module_cells', args);
  assert.ok(evidence.coverage.unresolvedContext.some(message => message.includes('Country')));
  assert.ok(evidence.pendingFilters.some(item => item.dimensionId === '501' && item.issue));
  const selected = await gate.execute('read_module_cells', { ...args, contextOverrides: [{ dimensionId: '501', itemName: 'Canada', questionQuote: 'in Canada' }] });
  assert.deepEqual(selected.coverage.unresolvedContext, []);
  assert.equal(selected.pendingFilters[0].itemId, '601');
});

test('restoring an unresolved hidden line-item selector never silently applies its published default', async () => {
  const f = storeFixture();
  f.definition.widgets.stores.contextOptions = [{ dimensionId: '20000000012', scope: '101', defaultValue: '201', syncedToPage: false, visible: false }];
  f.observed.selections.push(...['Existing', 'Size'].map(label => ({ dimensionId: '20000000012', cardId: 'stores', label, scope: '' })));
  const definition = pageDefinition(f.definition, { id: pageId, type: 'boards' }, app);
  const savedContext = await verifyPageContext({ app, mcp: f.mcp, input: { revision: 1, definition, observation: f.observed } });
  delete savedContext.selectionContext;
  assert.equal(savedContext.sources[0].filters.some(item => item.dimensionId === '20000000012'), false);
  const restored = await verifyPageContext({ app, mcp: f.mcp, savedContext, input: { revision: 1, definition, modelKey: model.key, observation: {} } });
  assert.equal(restored.sources[0].filters.some(item => item.dimensionId === '20000000012'), false);
  assert.ok(restored.sources[0].missing.some(message => message.includes('20000000012')));
});
