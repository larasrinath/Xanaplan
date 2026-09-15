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
import { resolveContextItem } from '../server/page-selections.mjs';
import { verifyPageContext } from '../server/page-context.mjs';
import { createPageScope } from '../server/page-scope.mjs';
import { pageDefinition } from '../extension/page-api.mjs';
import { AppError } from '../server/validation.mjs';
import { createApp } from '../server/app.mjs';
import { Store } from '../server/store.mjs';
import { request } from './http-client.mjs';
import { app, pageId, model, table, board, observation, syntheticMcp } from './fixtures/page.mjs';
import { promotionFixture } from './fixtures/promotion.mjs';

const view = { moduleId: '101', viewId: '101', dimensions: { rows: [], columns: [], pages: [{ id: '501', name: 'Customer' }] } };
test('visible selection falls back to a unique matching view member, never the first child account', async () => {
  for (const lookupUnavailable of [false, true]) {
    const calls = [];
    const item = await resolveContextItem({ dimensionId: '501', label: 'ExampleMart', view, read: async (tool, args) => {
      calls.push(tool);
      if (tool === 'lookup_dimensionitems') { if (lookupUnavailable) throw new AppError('Lookup unavailable', 502); return 'No items found.'; }
      assert.equal(tool, 'show_viewdimensionitems'); assert.equal(args.viewId, '101');
      return table([{ ID: '702', Name: 'ExampleMart East' }, { ID: '701', Name: 'ExampleMart' }]);
    } });
    assert.equal(item.itemId, '701'); assert.equal(item.resolvedBy, 'view members');
    assert.deepEqual(calls, ['lookup_dimensionitems', 'show_viewdimensionitems']);
  }
});

test('selection fallback rejects duplicate names, truncated members and unverified matches', async () => {
  for (const text of [table([{ ID: '701', Name: 'ExampleMart' }, { ID: '703', Name: 'ExampleMart' }]), table([{ ID: '701', Name: 'ExampleMart' }]) + '\n20 more not shown', table([{ ID: 'not-an-id', Name: 'ExampleMart' }])]) {
    await assert.rejects(resolveContextItem({ dimensionId: '501', label: 'ExampleMart', view, read: async tool => {
      if (tool === 'lookup_dimensionitems') return 'No items found.';
      assert.equal(tool, 'show_viewdimensionitems'); return text;
    } }), /more than one|incomplete/);
  }
});

test('selection fallback never bypasses access, cancellation or read limits', async () => {
  for (const status of [401, 403, 409, 422, 499, 503]) {
    let reads = 0;
    await assert.rejects(resolveContextItem({ dimensionId: '501', label: 'ExampleMart', view, read: async () => { reads++; throw new AppError('Stop', status); } }), error => error.status === status);
    assert.equal(reads, 1);
  }
});

test('off-axis selections use dimension members without querying an unrelated view dimension', async () => {
  const calls = [];
  const item = await resolveContextItem({ dimensionId: '502', label: 'Actual', view, read: async tool => {
    calls.push(tool);
    return tool === 'lookup_dimensionitems' ? 'No items found.' : table([{ ID: '603', Name: 'Actual' }]);
  } });
  assert.equal(item.itemId, '603');
  assert.deepEqual(calls, ['lookup_dimensionitems', 'show_dimensionitems']);
});

test('saved-view page selections and explicit overrides use the same member fallback', async () => {
  const mcp = syntheticMcp(), original = mcp.read;
  mcp.read = async (tool, args, selected, signal) => {
    if (tool === 'lookup_dimensionitems') return { text: 'No items found.', arguments: args };
    if (tool === 'show_viewdimensionitems') return { text: table(mcp.items[args.dimensionId].filter(item => item.Name.includes(args.search))), arguments: args };
    return original(tool, args, selected, signal);
  };
  const definition = pageDefinition(board, { id: pageId, type: 'boards' }, app);
  const context = await verifyPageContext({ app, mcp, input: { revision: app.revision, definition, observation } });
  const gate = createPageScope(context, { mcp, model, question: 'Revenue in Feb 26?' });
  const result = await gate.execute('read_cells', { sourceId: 'revenue:0', moduleId: '101', viewId: '101', contextOverrides: [{ dimensionId: '501', itemName: 'Feb 26', questionQuote: 'Feb 26' }] });
  assert.deepEqual(result.arguments.pages, [{ dimensionId: '501', itemId: '602' }, { dimensionId: '502', itemId: '603' }]);
  assert.equal(context.sources[1].filters.find(filter => filter.dimensionId === '502').label, 'Budget');
});

test('captured customer and fixed hidden line item supply omitted question context end to end', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'xanaplan-selection-flow-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory), fixture = promotionFixture();
  const saved = store.saveApp({ ...app, revision: 0 });
  const providers = { select: () => ({ settings: store.getLlm(), check() {}, decide: async payload => {
    assert.doesNotMatch(payload.question, /ExampleMart/);
    assert.equal(payload.pageContext.sources[0].filters.find(item => item.dimensionId === '501').label, 'ExampleMart');
    if (!payload.evidence.length) return { kind: 'read', tool: 'read_module_cells', arguments: JSON.stringify({ modelKey: model.key, sourceId: 'actuals:0', moduleId: '101' }) };
    const cells = payload.evidence[0];
    assert.deepEqual(cells.pendingFilters, []); assert.deepEqual(cells.coverage.unresolvedContext, []);
    assert.equal(cells.effectiveFilters.find(item => item.dimensionId === '501').origin, 'page selection');
    assert.equal(cells.effectiveFilters.find(item => item.dimensionId === '20000000012').origin, 'card default');
    const row = JSON.parse(cells.text).rows[0];
    return { kind: 'answer', answer: `${row['Sell-In Actuals']} units for ${row.Customer}, ${row.Product}, ${row.Time}.`, sourceIds: [cells.id] };
  } }) };
  const server = createApp({ store, mcp: fixture.mcp, providers });
  const definition = pageDefinition(fixture.definition, { id: pageId, type: 'boards' }, app);
  const verified = await request(server, store, 'POST', '/page-context', { appKey: saved.key, revision: saved.revision, definition, observation: fixture.observed });
  assert.equal(verified.status, 200);
  assert.deepEqual(verified.body.context.sources[0].missing, []);
  const response = await request(server, store, 'POST', '/chat', { appKey: saved.key, revision: saved.revision, llmRevision: 1, pageTicket: verified.body.ticket, question: 'What are sell-in actuals for Herbal shampoo L on 1 Jan 24?' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.answer, '48 units for ExampleMart, Herbal shampoo L, 1 Jan 24.');
  assert.equal(fixture.mcp.calls.filter(call => call.tool === 'read_cells').length, 1);
});

test('ambiguous customers and advanced or wrong-module fixed line items cannot silently select defaults', async () => {
  for (const options of [{ duplicate: true }, { advanced: true }, { wrongLineItem: true }]) {
    const fixture = promotionFixture(options);
    const definition = pageDefinition(fixture.definition, { id: pageId, type: 'boards' }, app);
    const context = await verifyPageContext({ app, mcp: fixture.mcp, input: { revision: app.revision, definition, observation: fixture.observed } });
    const gate = createPageScope(context, { mcp: fixture.mcp, model, question: 'Sell-in actuals?' });
    await assert.rejects(gate.execute('read_module_cells', { sourceId: 'actuals:0', moduleId: '101' }), /Specify Customer Account|Specify Line Items/);
    assert.equal(fixture.mcp.calls.some(call => call.tool === 'read_cells'), false);
  }
});
