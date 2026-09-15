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
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.mjs';
import { ProviderManager } from '../server/providers.mjs';
import { validateLlmChoice } from '../server/llm-settings.mjs';
import { codexArguments, CODEX_DISABLED_FEATURES } from '../server/openai.mjs';
import { ClaudeProvider } from '../server/claude.mjs';
import { runCli } from '../server/cli.mjs';

const decision = { kind: 'answer', tool: '', arguments: '{}', answer: 'Synthetic answer', sourceIds: [] };
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'xanaplan-providers-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir), calls = [];
  const implementation = id => ({
    status: async () => ({ installed: true, loggedIn: id === 'claude', method: 'synthetic' }),
    decide: async (payload, signal, options) => { calls.push({ id, payload, signal, options }); return decision; },
  });
  const manager = new ProviderManager({ store, claude: implementation('claude'), openai: implementation('openai') });
  return { dir, store, manager, calls };
}
test('existing installs retain Claude and admin settings survive restart for both providers', t => {
  const { dir, store } = fixture(t);
  assert.equal(store.getLlm().provider, 'claude');
  const first = store.saveLlm({ provider: 'openai', model: 'test-openai-model', revision: 1 });
  assert.equal(first.revision, 2);
  const reopened = new Store(dir);
  assert.equal(reopened.getLlm().model, 'test-openai-model');
  reopened.saveLlm({ provider: 'claude', model: 'test-claude-model', revision: 2 });
  assert.deepEqual(reopened.getLlm().models, { openai: 'test-openai-model', claude: 'test-claude-model' });
  assert.throws(() => reopened.saveLlm({ provider: 'openai', model: '', revision: 2 }), /another window/);
});
test('only the two supported providers and plain model names are accepted', () => {
  for (const provider of ['other', '__proto__', 'constructor', null]) assert.throws(() => validateLlmChoice({ provider, model: '' }), /OpenAI or Claude/);
  for (const model of ['--dangerously-bypass', 'bad\nmodel', 'x;anything', {}, 'x'.repeat(121)]) assert.throws(() => validateLlmChoice({ provider: 'openai', model }), /valid model/);
  assert.deepEqual(validateLlmChoice({ provider: 'claude', model: '  ' }), { provider: 'claude', model: '' });
});
test('chat always uses the saved provider and model and rejects request-level overrides', async t => {
  const { store, manager, calls } = fixture(t);
  store.saveLlm({ provider: 'openai', model: 'test-openai-model', revision: 1 });
  const provider = manager.select({ llmRevision: 2 });
  await provider.decide({ question: 'Synthetic question' });
  assert.equal(calls.length, 1); assert.equal(calls[0].id, 'openai'); assert.deepEqual(calls[0].options, { model: 'test-openai-model' });
  assert.throws(() => manager.select({ llmRevision: 1 }), /AI settings changed/);
  for (const field of ['provider', 'llmModel', 'llmProvider']) assert.throws(() => manager.select({ llmRevision: 2, [field]: 'override' }), /managed in Admin/);
});
test('a selected provider snapshot rejects changed configuration before and after inference', async t => {
  const { store, manager, calls } = fixture(t);
  const provider = manager.select({ llmRevision: 1 });
  store.saveLlm({ provider: 'openai', model: '', revision: 1 });
  await assert.rejects(provider.decide({}), /changed during/); assert.equal(calls.length, 0);
  manager.providers.openai.decide = async () => { store.saveLlm({ provider: 'claude', model: '', revision: 2 }); return decision; };
  await assert.rejects(manager.select({ llmRevision: 2 }).decide({}), /changed during/);
});
test('connection tests use synthetic data and never change the saved provider', async t => {
  const { store, manager, calls } = fixture(t);
  const before = store.getLlm();
  const result = await manager.test({ provider: 'openai', model: 'draft-model' });
  assert.equal(result.success, true); assert.deepEqual(store.getLlm(), before);
  assert.equal(calls[0].id, 'openai'); assert.equal(calls[0].options.model, 'draft-model');
  assert.deepEqual(calls[0].payload.tools, []); assert.deepEqual(calls[0].payload.evidence, []);
  assert.match(calls[0].payload.model.context, /No Anaplan/);
});
test('provider failures are surfaced without a fallback to the other provider', async t => {
  const { manager, calls } = fixture(t);
  manager.providers.claude.decide = async () => { throw new Error('Synthetic usage limit'); };
  await assert.rejects(manager.select({ llmRevision: 1 }).decide({}), /usage limit/);
  assert.equal(calls.length, 0);
  const status = await manager.status(); assert.equal(status.provider.id, 'claude'); assert.equal(status.connections.openai.loggedIn, false);
});
test('Codex invocation isolates the runtime and honors the admin model argument', () => {
  const args = codexArguments('/tmp/schema.json', 'test-openai-model');
  for (const flag of ['--ignore-user-config', '--ephemeral', '--sandbox', 'read-only', '--output-schema']) assert.ok(args.includes(flag));
  assert.ok(args.includes('approval_policy="never"')); assert.ok(args.includes('web_search="disabled"')); assert.ok(args.includes('mcp_servers={}'));
  for (const feature of CODEX_DISABLED_FEATURES) assert.ok(args.some((arg, i) => arg === '--disable' && args[i + 1] === feature));
  assert.equal(args[args.indexOf('--model') + 1], 'test-openai-model');
  assert.equal(args.some(arg => arg.includes('dangerously')), false);
});
test('Claude invocation uses the same admin model choice and refuses malformed decisions', async () => {
  const provider = new ClaudeProvider({ command: 'unused-test', cwd: tmpdir() });
  let captured;
  provider.run = async args => { captured = args; return { code: 0, stdout: JSON.stringify({ structured_output: decision }) }; };
  await provider.decide({}, undefined, { model: 'test-claude-model' });
  assert.equal(captured[captured.indexOf('--model') + 1], 'test-claude-model');
  assert.equal(captured[captured.indexOf('--tools') + 1], ''); assert.ok(captured.includes('--safe-mode'));
  provider.run = async () => ({ code: 0, stdout: JSON.stringify({ structured_output: { ...decision, sourceIds: ['bad'] } }) });
  await assert.rejects(provider.decide({}), /incomplete response/);
});
test('shared CLI runner preserves split unicode and supports cancellation', async () => {
  const lines = [];
  await runCli(process.execPath, ['-e', "const b=Buffer.from('€\\n');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),15)"], { label: 'Test', cwd: tmpdir(), onLine: line => lines.push(line) });
  assert.deepEqual(lines, ['€']);
  const controller = new AbortController();
  const pending = runCli(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { label: 'Test', cwd: tmpdir(), signal: controller.signal });
  controller.abort(); await assert.rejects(pending, /cancelled/);
});
