import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatHistory } from '../extension/chat-history.mjs';

const record = { id: 'saved-id', scopeKey: 'page-a', revision: 1, messages: [{ role: 'user', text: 'Question' }, { role: 'assistant', text: 'Saved answer', sources: [] }], title: 'Question', app: { name: 'App' } };
const tick = () => new Promise(resolve => setImmediate(resolve));
const api = async path => path === '/conversations' ? { conversations: [{ ...record, messages: undefined }] } : { conversation: structuredClone(record) };

test('a new panel restores the latest matching chat and keeps New chat separate', async () => {
  const first = new ChatHistory({ api }); await first.refresh();
  first.current('page-a'); await tick();
  assert.equal(first.current('page-a').messages[1].text, 'Saved answer');
  first.newChat('page-a'); assert.deepEqual(first.current('page-a').messages, []);
  assert.equal(first.records.length, 1);
  const reopened = new ChatHistory({ api }); await reopened.refresh(); reopened.current('page-a'); await tick();
  assert.equal(reopened.current('page-a').id, record.id);
});
test('opening an archive cannot change current scope; matching chats can be resumed', async () => {
  const history = new ChatHistory({ api }); await history.refresh();
  await history.open(record.id, () => 'page-b');
  assert.equal(history.viewed.id, record.id); assert.deepEqual(history.current('page-b').messages, []);
  history.back(); assert.equal(history.viewed, null);
  await history.open(record.id, () => 'page-a');
  assert.equal(history.viewed, null); assert.equal(history.current('page-a').revision, 1);
});
test('late archive loads cannot replace a newer selection or a new chat', async () => {
  let resolve;
  const history = new ChatHistory({ api: () => new Promise(done => { resolve = done; }) });
  const opening = history.open(record.id, () => 'page-b');
  history.back(); resolve({ conversation: record }); await opening;
  assert.equal(history.viewed, null);
  const another = history.open(record.id, () => 'page-a');
  history.newChat('page-a'); resolve({ conversation: record }); await another;
  assert.equal(history.current('page-a').messages.length, 0);
  assert.equal(history.loading, false);
});
