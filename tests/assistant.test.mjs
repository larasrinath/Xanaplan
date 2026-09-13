import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.mjs';
import { scopeArguments, parseChoices, authorizationError, READ_TOOLS } from '../server/mcp.mjs';
import { trustedRequest } from '../server/http.mjs';
import { answerQuestion } from '../server/chat.mjs';

const model = { workspaceId: 'workspace1', modelId: 'model1', name: 'Sample sales', workspaceName: 'Test workspace', context: 'Synthetic test context. Currency USD; calendar year; Actual and Budget.', revision: 0 };
const schema = { type: 'object', properties: { workspaceId: { type: 'string' }, modelId: { type: 'string' }, moduleId: { type: 'string' }, viewId: { type: 'string' }, maxRows: { type: 'number' } }, required: ['workspaceId', 'modelId', 'moduleId', 'viewId'] };
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'xanaplan-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir); const saved = store.save(model);
  return { dir, store, saved };
}
test('local model context survives restart and stale edits cannot overwrite it', t => {
  const { dir, store, saved } = fixture(t);
  assert.equal(new Store(dir).get(saved.key).context, model.context);
  assert.equal(statSync(join(dir, 'settings.json')).mode & 0o777, 0o600);
  assert.throws(() => store.save(model), /changed in another window/);
  const updated = store.save({ ...saved, context: 'Updated business context' });
  assert.equal(updated.revision, 2);
  assert.throws(() => store.remove(saved.key, 1), /changed/);
  store.remove(saved.key, 2); assert.equal(store.list().length, 0);
});
test('read-only gate rejects write/export tools, cross-model access and unknown arguments', () => {
  for (const name of ['write_cells', 'run_export', 'run_process', 'add_list_items', 'set_currentperiod', 'show_workspaces']) {
    assert.equal(READ_TOOLS.has(name), false);
    assert.throws(() => scopeArguments(name, {}, model, schema), /read-only/);
  }
  assert.throws(() => scopeArguments('read_cells', { modelId: 'other' }, model, schema), /selected model/);
  assert.throws(() => scopeArguments('read_cells', { workspaceId: 'other' }, model, schema), /selected model/);
  assert.throws(() => scopeArguments('read_cells', { command: 'anything' }, model, schema), /Unexpected argument/);
  assert.throws(() => scopeArguments('read_cells', {}, model, { properties: {} }), /safely scoped/);
  assert.deepEqual(scopeArguments('read_cells', { moduleId: 'm', viewId: 'v', maxRows: 500000 }, model, schema), { workspaceId: 'workspace1', modelId: 'model1', moduleId: 'm', viewId: 'v', maxRows: 1000 });
});
test('MCP discovery parses both actual table shapes and rejects broken delimiters', () => {
  assert.deepEqual(parseChoices('| Name | Finance |\n| ID | 123 |\n| Active | true |'), [{ id: '123', name: 'Finance' }]);
  assert.deepEqual(parseChoices('| # | Name | State | ID |\n| --- | --- | --- | --- |\n| 1 | Finance | UNLOCKED | 123 |\n| 2 | Sales | PRODUCTION | 456 |\n2 models.'), [{ id: '123', name: 'Finance' }, { id: '456', name: 'Sales' }]);
  assert.deepEqual(parseChoices('No workspaces found.'), []);
  assert.throws(() => parseChoices('| # | Name | ID |\n| --- | --- | --- |\n| 1 | bad | name | 123 |'), /delimiter/);
});
test('authorization links are restricted to HTTPS on Anaplan domains', () => {
  assert.equal(authorizationError('Anaplan authorization required.\nClick to authorize: https://us1a.app.anaplan.com/oauth/activate?user_code=TEST').details.url, 'https://us1a.app.anaplan.com/oauth/activate?user_code=TEST');
  for (const url of ['https://anaplan.com.evil.test/a', 'http://anaplan.com/a', 'https://evil.test/a']) {
    assert.equal(authorizationError(`Anaplan authorization required.\nClick to authorize: ${url}`).details.url, undefined);
  }
  assert.equal(authorizationError('Other error'), null);
});
test('helper rejects unpaired requests, hostile origins and DNS rebinding hosts', () => {
  const headers = { host: '127.0.0.1:8766', origin: 'chrome-extension://' + 'a'.repeat(32), authorization: 'Bearer local-test-token' };
  assert.equal(trustedRequest({ headers }, 'local-test-token', 8766), true);
  for (const change of [{ authorization: '' }, { origin: 'https://evil.test' }, { host: 'evil.test:8766' }, { origin: 'null' }]) assert.equal(trustedRequest({ headers: { ...headers, ...change } }, 'local-test-token', 8766), false);
});
test('business answer receives fresh context, scoped evidence and traceable sources', async t => {
  const { store, saved } = fixture(t);
  let calls = 0;
  const mcp = {
    tools: async () => [{ name: 'read_cells', inputSchema: schema }],
    read: async (name, args, selected) => { assert.equal(selected.key, saved.key); return { text: '{"Revenue":120,"Budget":100}', arguments: scopeArguments(name, args, selected, schema) }; },
  };
  const provider = { decide: async payload => {
    assert.equal(payload.model.context, model.context);
    assert.equal(payload.tools[0].inputSchema.properties.modelId, undefined);
    if (calls++ === 0) return { kind: 'read', tool: 'read_cells', arguments: '{"moduleId":"m","viewId":"v"}' };
    assert.match(payload.evidence[0].text, /Revenue/);
    return { kind: 'answer', answer: 'Synthetic test: revenue is 20 above budget.', sourceIds: [1, 999] };
  } };
  const result = await answerQuestion({ store, mcp, provider, input: { modelKey: saved.key, revision: 1, question: 'Revenue vs budget?' } });
  assert.equal(result.sources.length, 1); assert.equal(result.sources[0].id, 1); assert.equal(result.revision, 1);
});
test('questions fail when context is stale, removed, or changes during inference', async t => {
  const { store, saved } = fixture(t);
  const mcp = { tools: async () => [] };
  const input = { modelKey: saved.key, revision: 1, question: 'Explain costs.' };
  await assert.rejects(answerQuestion({ store, mcp, provider: {}, input: { ...input, revision: 0 } }), /updated/);
  const provider = { decide: async () => { store.save({ ...saved, context: 'Changed' }); return { kind: 'answer', answer: 'Stale answer', sourceIds: [] }; } };
  await assert.rejects(answerQuestion({ store, mcp, provider, input }), /Context changed/);
  store.remove(saved.key, 2);
  await assert.rejects(answerQuestion({ store, mcp, provider, input }), /not enabled/);
});
test('truncation is explicit to the model and source metadata', async t => {
  const { store, saved } = fixture(t); let calls = 0;
  const mcp = { tools: async () => [{ name: 'read_cells', inputSchema: schema }], read: async () => ({ text: 'x'.repeat(50000), arguments: { maxRows: 500 } }) };
  const provider = { decide: async payload => {
    if (calls++ === 0) return { kind: 'read', tool: 'read_cells', arguments: '{}' };
    assert.equal(payload.evidence[0].partial, true); assert.match(payload.evidence[0].warning, /truncated/);
    return { kind: 'answer', answer: 'Insufficient evidence.', sourceIds: [1] };
  } };
  const result = await answerQuestion({ store, mcp, provider, input: { modelKey: saved.key, revision: 1, question: 'Total?' } });
  assert.equal(result.sources[0].partial, true); assert.equal(result.sources[0].rowLimit, 500);
});
test('cancelled questions do not invoke the AI provider', async t => {
  const { store, saved } = fixture(t);
  await assert.rejects(answerQuestion({ store, mcp: { tools: async () => [] }, provider: { decide: () => assert.fail('should not run') }, signal: AbortSignal.abort(), input: { modelKey: saved.key, revision: 1, question: 'Question' } }), /cancelled/);
});
