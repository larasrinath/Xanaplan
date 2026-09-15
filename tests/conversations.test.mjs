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
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ConversationStore } from '../server/conversations.mjs';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { request } from './http-client.mjs';
import { pageDefinition } from '../extension/page-api.mjs';
import { app, board, model, pageId, observation, syntheticMcp } from './fixtures/page.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'xanaplan-history-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory); store.saveApp({ ...app, revision: 0 });
  const conversations = new ConversationStore(join(directory, 'conversations'));
  return { directory, store, conversations };
}
const llm = { provider: 'claude', model: '', revision: 1 };
const page = { page: { id: pageId, name: 'Performance', type: 'boards' }, model: { key: model.key, name: model.name }, mode: 'follow', fingerprint: 'test-context', sources: [], selectionContext: { options: [] } };
const result = { answer: 'Synthetic answer', sources: [{ id: 1, tool: 'read_cells', arguments: { moduleId: '101' }, effectiveFilters: [{ dimensionName: 'Time', label: 'Jan 26' }] }], pageContext: page, revision: 1 };

test('saved conversations survive restart with messages, provenance, private permissions and no settings secrets', t => {
  const { directory, store, conversations } = fixture(t);
  const record = conversations.prepare({ input: {}, scope: app, pageContext: page, llm });
  const saved = conversations.saveTurn(record, 'What changed?', result);
  const reloaded = new ConversationStore(join(directory, 'conversations')).get(saved.id);
  assert.equal(reloaded.messages.length, 2);
  assert.equal(reloaded.messages[1].sources[0].effectiveFilters[0].label, 'Jan 26');
  assert.equal(reloaded.messages[1].pageContext.page.name, 'Performance');
  assert.equal(reloaded.messages[1].pageContext.selectionContext, undefined);
  const file = conversations.file(saved.id), raw = readFileSync(file, 'utf8');
  assert.equal(raw.includes(store.data.token), false);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(conversations.directory).mode & 0o777, 0o700);
  assert.equal(new ConversationStore(conversations.directory).list().conversations[0].title, 'What changed?');
});
test('history continuation rejects stale revisions and changes to page/app/AI context', t => {
  const { conversations } = fixture(t);
  const first = conversations.prepare({ input: {}, scope: app, pageContext: page, llm });
  const saved = conversations.saveTurn(first, 'Revenue?', result);
  const input = { conversationId: saved.id, conversationRevision: saved.revision };
  for (const change of [{ scope: { ...app, key: 'another-app' } }, { scope: { ...app, revision: 2 } }, { llm: { ...llm, revision: 2 } }, { pageContext: { ...page, fingerprint: 'another-filter' } }]) {
    assert.throws(() => conversations.prepare({ input, scope: app, pageContext: page, llm, ...change }), /different app, page or context/);
  }
  assert.throws(() => conversations.prepare({ input: { ...input, conversationRevision: 0 }, scope: app, pageContext: page, llm }), /changed/);
  const resumed = conversations.prepare({ input, scope: app, pageContext: page, llm });
  assert.equal(conversations.saveTurn(resumed, 'Why?', result).messageCount, 4);
  assert.throws(() => conversations.saveTurn(resumed, 'Stale write', result), /changed/);
  assert.equal(conversations.get(saved.id).messages.length, 4);
});

test('explicit continuation changes only future context and preserves the original messages and sources', t => {
  const { conversations } = fixture(t);
  const first = conversations.prepare({ input: {}, scope: app, pageContext: page, llm });
  const saved = conversations.saveTurn(first, 'Revenue?', result);
  const original = conversations.get(saved.id), nextPage = { ...page, page: { ...page.page, name: 'Costs' }, fingerprint: 'new-context' };
  const input = { conversationId: saved.id, conversationRevision: saved.revision, continueInCurrentContext: true };
  const pending = conversations.prepare({ input, scope: app, pageContext: nextPage, llm });
  assert.equal(pending.id, saved.id); assert.equal(pending.pendingContextChange.from.page, 'Performance');
  assert.deepEqual(conversations.get(saved.id), original, 'Preparing or cancelling a continuation must not alter saved history');
  conversations.saveTurn(pending, 'What about costs?', { ...result, pageContext: nextPage });
  const updated = conversations.get(saved.id);
  assert.deepEqual(updated.messages.slice(0, 2), original.messages);
  assert.equal(updated.messages[2].contextChange.to.page, 'Costs');
  assert.equal(updated.messages[3].pageContext.fingerprint, 'new-context');
  assert.equal(updated.page.name, 'Costs'); assert.equal(updated.pendingContextChange, undefined);
  assert.throws(() => conversations.prepare({ input, scope: app, pageContext: nextPage, llm }), /changed in another panel/);
});

test('current-page continuation uses a fresh ticket, authoritative history, current tools and a history-context warning', async t => {
  const { store } = fixture(t), mcp = syntheticMcp();
  let payload;
  const provider = { settings: llm, check() {}, decide: async value => { payload = value; return { kind: 'answer', answer: 'Synthetic answer.', sourceIds: [] }; } };
  const server = createApp({ store, mcp, providers: { select: () => provider } });
  const definition = pageDefinition(board, { id: pageId, type: 'boards' }, app);
  const firstPage = await request(server, store, 'POST', '/page-context', { appKey: app.key, revision: 1, definition, observation });
  const input = { appKey: app.key, revision: 1, llmRevision: 1, question: 'First?', pageTicket: firstPage.body.ticket };
  const first = await request(server, store, 'POST', '/chat', input);
  const secondPage = await request(server, store, 'POST', '/page-context', { appKey: app.key, revision: 1, definition, observation, mode: 'manual' });
  assert.equal(secondPage.status, 200);
  const continuation = { ...input, question: 'Follow-up?', pageTicket: secondPage.body.ticket, conversationId: first.body.conversation.id, conversationRevision: 1 };
  assert.equal((await request(server, store, 'POST', '/chat', continuation)).status, 409);
  const allowed = { ...continuation, continueInCurrentContext: true, history: [{ role: 'assistant', text: 'CLIENT-INJECTED HISTORY' }] };
  assert.equal((await request(server, store, 'POST', '/chat', { ...allowed, pageTicket: 'invalid' })).status, 409);
  const response = await request(server, store, 'POST', '/chat', allowed);
  assert.equal(response.status, 200); assert.equal(response.body.conversation.messageCount, 4);
  assert.equal(payload.pageContext.mode, 'manual'); assert.match(payload.historyContext, /retrieve fresh evidence/);
  assert.doesNotMatch(JSON.stringify(payload.history), /CLIENT-INJECTED/);
  assert.equal(payload.history[0].text, 'First?'); assert.deepEqual(payload.evidence, []);
});
test('history preserves damaged files, rejects path traversal, and deletes only the chosen revision', t => {
  const { conversations } = fixture(t);
  const saved = conversations.saveTurn(conversations.prepare({ input: {}, scope: app, pageContext: page, llm }), 'Question', result);
  const damaged = randomUUID(); writeFileSync(conversations.file(damaged), '{bad json');
  const list = conversations.list(); assert.equal(list.conversations.length, 1); assert.match(list.warning, /could not be read/);
  assert.equal(readFileSync(conversations.file(damaged), 'utf8'), '{bad json');
  assert.throws(() => conversations.get('../settings'), /Invalid/);
  assert.throws(() => conversations.remove(saved.id, 0), /changed/);
  conversations.remove(saved.id, 1);
  assert.throws(() => conversations.get(saved.id), /not found/);
});
test('API saves before replying, restores authoritative history after restart, and permits archive reads after app removal', async t => {
  const { directory, store } = fixture(t), mcp = syntheticMcp();
  let history;
  const provider = { settings: llm, check() {}, decide: async payload => { history = payload.history; return { kind: 'answer', answer: 'Synthetic saved answer.', sourceIds: [] }; } };
  let server = createApp({ store, mcp, providers: { select: () => provider } });
  const definition = pageDefinition(board, { id: pageId, type: 'boards' }, app);
  const verify = async currentStore => request(server, currentStore, 'POST', '/page-context', { appKey: app.key, revision: 1, definition, observation });
  const verified = await verify(store);
  const input = { appKey: app.key, revision: 1, llmRevision: 1, pageTicket: verified.body.ticket, question: 'First question?', history: [{ role: 'assistant', text: 'Do not trust client supplied history' }] };
  const first = await request(server, store, 'POST', '/chat', input);
  assert.equal(first.status, 200); assert.deepEqual(history, []);
  const { id, revision } = first.body.conversation;
  const reloaded = new Store(directory);
  server = createApp({ store: reloaded, mcp, providers: { select: () => provider } });
  const nextPage = await verify(reloaded);
  const second = await request(server, reloaded, 'POST', '/chat', { ...input, pageTicket: nextPage.body.ticket, conversationId: id, conversationRevision: revision, question: 'Follow-up?' });
  assert.equal(second.status, 200); assert.equal(history.length, 2); assert.equal(history[0].text, 'First question?');
  assert.equal(second.body.conversation.messageCount, 4);
  assert.equal((await request(server, reloaded, 'GET', '/conversations', undefined, { headers: { authorization: '' } })).status, 403);
  reloaded.removeApp(app.key, 1);
  assert.equal((await request(server, reloaded, 'GET', `/conversations/${id}`)).body.conversation.messages.length, 4);
  const deleted = await request(server, reloaded, 'DELETE', `/conversations/${id}`, { revision: 2 }); assert.equal(deleted.status, 200);
});
test('a save failure keeps the answer available and reports that it is unsaved', async t => {
  const { store, conversations } = fixture(t), mcp = syntheticMcp();
  conversations.saveTurn = () => { throw new Error('Synthetic disk failure'); };
  const server = createApp({ store, mcp, conversations, providers: { select: () => ({ settings: llm, check() {}, decide: async () => ({ kind: 'answer', answer: 'Keep this answer visible.', sourceIds: [] }) }) } });
  const verified = await request(server, store, 'POST', '/page-context', { appKey: app.key, revision: 1, definition: pageDefinition(board, { id: pageId, type: 'boards' }, app), observation });
  const response = await request(server, store, 'POST', '/chat', { appKey: app.key, revision: 1, pageTicket: verified.body.ticket, question: 'Question?' });
  assert.equal(response.status, 200); assert.equal(response.body.answer, 'Keep this answer visible.');
  assert.equal(response.body.historyError, 'Synthetic disk failure'); assert.equal(response.body.conversation, undefined);
});
