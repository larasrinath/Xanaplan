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
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { JSDOM } from 'jsdom';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { createChatStream } from '../server/chat-progress.mjs';
import { createLocalApi } from '../extension/local-api.mjs';
import { readChatStream } from '../extension/chat-stream.mjs';
import { createQuestionProgress } from '../extension/question-progress.mjs';
import { request, streamRequest } from './http-client.mjs';

function fixture(t, decide) {
  const directory = mkdtempSync(join(tmpdir(), 'xanaplan-progress-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  const model = store.save({ workspaceId: 'workspace1', modelId: 'model1', name: 'Synthetic sales', workspaceName: 'Synthetic', context: 'Private business context', revision: 0 });
  const schema = { type: 'object', properties: { modelId: { type: 'string' }, moduleId: { type: 'string' }, viewId: { type: 'string' } }, required: ['modelId'] };
  const mcp = { tools: async () => [{ name: 'read_cells', inputSchema: schema }], read: async () => ({ text: 'Private source values', arguments: { moduleId: '101' } }) };
  const providers = { select: () => ({ settings: store.getLlm(), check() {}, decide }) };
  const server = createApp({ store, mcp, providers });
  const input = { modelKey: model.key, revision: 1, llmRevision: 1, question: 'Private question', stream: true };
  return { server, store, input };
}

test('paired chat streams real operations before completion and saves the final answer once', async t => {
  const waiting = Promise.withResolvers(), release = Promise.withResolvers(), updates = [];
  const { server, store, input } = fixture(t, async payload => {
    if (!payload.evidence.length) { waiting.resolve(); await release.promise; return { kind: 'read', tool: 'read_cells', arguments: '{"moduleId":"101"}' }; }
    return { kind: 'answer', answer: 'Synthetic answer', sourceIds: [1] };
  });
  t.after(() => release.resolve());
  const response = await streamRequest(server, store, 'POST', '/chat', input);
  assert.match(response.headers.get('content-type'), /x-ndjson/);
  const firstUpdate = Promise.withResolvers();
  const result = readChatStream(response, { onProgress: event => { updates.push(event); if (event.stage === 'ai') firstUpdate.resolve(); } });
  await waiting.promise; await firstUpdate.promise;
  assert.deepEqual(updates.map(event => event.stage), ['connection', 'ai']);
  assert.equal((await request(server, store, 'GET', '/conversations')).body.conversations.length, 0);
  release.resolve();
  const answer = await result;
  assert.equal(answer.answer, 'Synthetic answer'); assert.equal(answer.sources.length, 1);
  assert.deepEqual(updates.map(event => event.stage), ['connection', 'ai', 'read', 'read-complete', 'ai', 'answer', 'saving']);
  assert.doesNotMatch(JSON.stringify(updates), /Private|moduleId|sourceIds|arguments|reasoning/);
  assert.equal((await request(server, store, 'GET', '/conversations')).body.conversations.length, 1);
  for (const headers of [{ authorization: '' }, { origin: 'https://evil.test' }, { host: 'localhost:8766' }]) {
    const denied = await streamRequest(server, store, 'POST', '/chat', input, { headers });
    assert.equal(denied.status, 403); assert.match(denied.headers.get('content-type'), /application\/json/);
  }
});

test('streamed failures stay structured and release the question lock', async t => {
  let privateFailure = false;
  const { server, store, input } = fixture(t, async () => {
    if (privateFailure) throw new Error('PRIVATE-STACK');
    throw Object.assign(new Error('Sign in to the provider.'), { status: 401, details: { code: 'OPENAI_LOGIN' } });
  });
  for (const unknown of [false, true]) {
    privateFailure = unknown;
    const response = await streamRequest(server, store, 'POST', '/chat', input);
    await assert.rejects(readChatStream(response, { onProgress() {} }), error => {
      assert.equal(error.status, unknown ? 500 : 401); assert.doesNotMatch(error.message, /PRIVATE/);
      if (!unknown) assert.equal(error.code, 'OPENAI_LOGIN');
      return true;
    });
  }
  assert.equal((await request(server, store, 'GET', '/conversations')).body.conversations.length, 0);
  assert.equal((await request(server, store, 'POST', '/llm', { provider: 'openai', model: '', revision: 1 })).status, 200);
});

test('disconnecting a stream cancels provider work, saves nothing, and permits retry', async t => {
  const started = Promise.withResolvers(), cancelled = Promise.withResolvers();
  let waiting = true;
  const { server, store, input } = fixture(t, async (_, signal) => {
    if (waiting) await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { cancelled.resolve(); reject(Object.assign(new Error('Cancelled'), { status: 499 })); }, { once: true });
      started.resolve();
    });
    return { kind: 'answer', answer: 'Retry answer', sourceIds: [] };
  });
  const controller = new AbortController();
  const response = await streamRequest(server, store, 'POST', '/chat', input, { signal: controller.signal });
  const result = readChatStream(response, { signal: controller.signal, onProgress() {} });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await started.promise; controller.abort(); await cancelled.promise; await rejected;
  assert.equal((await request(server, store, 'GET', '/conversations')).body.conversations.length, 0);
  waiting = false;
  const retry = await streamRequest(server, store, 'POST', '/chat', input);
  assert.equal((await readChatStream(retry, { onProgress() {} })).answer, 'Retry answer');
});

test('heartbeats show a live helper without inventing progress and stop after completion', async () => {
  const res = new EventEmitter(), events = [], heartbeat = Promise.withResolvers();
  res.setHeader = () => {}; res.writeHead = () => {};
  res.write = text => { const event = JSON.parse(text); events.push(event); if (event.type === 'heartbeat') heartbeat.resolve(); };
  res.end = () => { res.writableEnded = true; };
  const stream = createChatStream(res, { heartbeatMs: 5 });
  stream.progress({ stage: 'ai', message: 'Waiting for the AI provider' });
  const keepAlive = setTimeout(() => {}, 1000);
  try { await heartbeat.promise; } finally { clearTimeout(keepAlive); }
  assert.equal(events[1].type, 'heartbeat'); assert.equal(events[1].message, undefined);
  stream.finish('result', { result: { answer: 'Complete' } });
  const length = events.length;
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(events.length, length);
});

test('stream reader handles split UTF-8 frames and rejects incomplete, malformed, and stalled responses', async () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(JSON.stringify({ type: 'progress', stage: 'read', message: 'Reading € values' }) + '\n' + JSON.stringify({ type: 'result', result: { answer: '€120' } }));
  const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
  const events = [];
  assert.equal((await readChatStream(response, { onProgress: event => events.push(event) })).answer, '€120');
  assert.equal(events[0].message, 'Reading € values');
  await assert.rejects(readChatStream(new Response('{broken\n'), { onProgress() {} }), /unreadable/);
  await assert.rejects(readChatStream(new Response('{"type":"heartbeat"}\n'), { onProgress() {} }), /before an answer/);
  let cancelled = false;
  const stalled = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  await assert.rejects(readChatStream(stalled, { onProgress() {}, idleMs: 10 }), /stopped sending updates/);
  assert.equal(cancelled, true);
});

test('the local API consumes streaming activity and remains compatible with JSON helpers', async t => {
  const { server, store, input } = fixture(t, async () => ({ kind: 'answer', answer: 'Complete', sourceIds: [] }));
  const api = createLocalApi(() => ({ baseUrl: 'http://synthetic', token: 'synthetic' }), {
    fetchImpl: async (_, options) => streamRequest(server, store, 'POST', '/chat', JSON.parse(options.body), { signal: options.signal }),
  });
  const events = [];
  assert.equal((await api('/chat', { method: 'POST', body: input, onProgress: event => events.push(event) })).answer, 'Complete');
  assert.ok(events.length);
  const jsonApi = createLocalApi(() => ({ baseUrl: 'http://synthetic' }), { fetchImpl: async () => Response.json({ answer: 'Older helper' }) });
  assert.equal((await jsonApi('/chat', { onProgress() { assert.fail('Do not invent progress for older helpers'); } })).answer, 'Older helper');
});

test('activity UI tracks elapsed time, distinguishes waiting from disconnect, renders safely and clears on Stop', async t => {
  const dom = new JSDOM(readFileSync(new URL('../extension/panel.html', import.meta.url), 'utf8'));
  let time = 0;
  const progress = createQuestionProgress(dom.window.document, { now: () => time });
  const $ = id => dom.window.document.getElementById(id);
  t.after(() => { progress.stop(); dom.window.close(); });
  progress.start();
  assert.equal($('question-activity').hidden, false); assert.equal($('activity-elapsed').textContent, '0s');
  assert.equal($('activity-title').textContent, 'Understanding the ask');
  progress.update({ type: 'progress', stage: 'ai', message: 'Waiting for OpenAI' });
  time = 125000; progress.update({ type: 'heartbeat' });
  assert.equal($('activity-elapsed').textContent, '2m 05s');
  assert.match($('activity-connection').textContent, /AI provider has not returned/);
  assert.equal($('activity-log').children.length, 2);
  assert.equal($('activity-title').textContent, 'Understanding the ask', 'Elapsed time alone never invents a new phase');
  progress.update({ type: 'progress', stage: 'read', message: '<img src=x onerror=alert(1)>' });
  assert.equal($('activity-title').textContent, 'Finding the data');
  assert.equal($('activity-log').querySelector('img'), null);
  progress.update({ type: 'progress', stage: 'read-complete', message: 'Read received', readCount: 1 });
  assert.equal($('activity-title').textContent, 'Working through it');
  progress.update({ type: 'progress', stage: 'read', message: 'Another read', readCount: 2 });
  assert.equal($('activity-title').textContent, 'Finding the data', 'Further reads revisit the data stage');
  progress.update({ type: 'progress', stage: 'answer', message: 'Preparing your answer' });
  assert.equal($('activity-title').textContent, 'Wrapping up');
  assert.equal($('activity-phases').querySelectorAll('[aria-current="step"]').length, 1);
  progress.stop(); progress.update({ type: 'progress', message: 'Late event' });
  assert.equal($('question-activity').hidden, true); assert.doesNotMatch($('activity-log').textContent, /Late event/);
  progress.start(); assert.equal($('activity-log').children.length, 1);
  assert.equal($('activity-phases').querySelectorAll('[data-state="visited"]').length, 0);
});
