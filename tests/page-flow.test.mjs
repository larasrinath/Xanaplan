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
import { createApp } from '../server/app.mjs';
import { readPageDefinition } from '../extension/page-api.mjs';
import { request } from './http-client.mjs';
import { app, pageId, board, catalog, model, observation, syntheticMcp } from './fixtures/page.mjs';
import { storeFixture } from './fixtures/stores.mjs';

test('local end-to-end: discover app → enable → identify page → verify filters → answer with formula and cell sources', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'xanaplan-page-flow-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir), mcp = syntheticMcp();
  mcp.discover = async tool => ({ items: tool === 'show_workspaces' ? [{ id: model.workspaceId, name: model.workspaceName }] : [{ id: model.modelId, name: model.name }], incomplete: false });
  mcp.clientId = () => 'synthetic'; mcp.reset = async () => {};
  const decisions = [
    { kind: 'read', tool: 'show_lineitems', arguments: JSON.stringify({ modelKey: model.key, moduleId: '101' }) },
    { kind: 'read', tool: 'follow_formula', arguments: JSON.stringify({ modelKey: model.key, moduleId: '101', lineItemId: '201' }) },
    { kind: 'read', tool: 'read_cells', arguments: JSON.stringify({ modelKey: model.key, sourceId: 'revenue:0', moduleId: '101', viewId: '101', contextOverrides: [{ dimensionId: '501', itemName: 'Feb 26', questionQuote: 'Feb 26' }] }) },
    { kind: 'answer', answer: 'Synthetic revenue for Feb 26, Actual is 120.', sourceIds: [2, 3] },
  ];
  const providers = { select: () => ({ settings: store.getLlm(), check() {}, decide: async payload => {
    assert.equal(payload.pageContext.page.id, pageId); assert.deepEqual(payload.app.models.map(item => item.key), [model.key]);
    return decisions.shift();
  } }) };
  const server = createApp({ store, mcp, providers });
  const discovery = await request(server, store, 'POST', '/app-discovery', { ...app, models: [{ id: model.modelId, name: model.name, workspaceName: model.workspaceName }] });
  assert.equal(discovery.status, 200);
  const enabled = await request(server, store, 'POST', '/apps', { ticket: discovery.body.ticket, revision: 0, modelKeys: [model.key], context: 'Synthetic business context' });
  assert.equal(enabled.status, 200);
  const saved = enabled.body.app;
  const fetchImpl = async url => new Response(JSON.stringify(url.includes('/boards/') ? board : catalog), { headers: { 'content-type': 'application/json' } });
  const definition = await readPageDefinition({ ...app, pageId }, { fetchImpl });
  const verified = await request(server, store, 'POST', '/page-context', { appKey: saved.key, revision: saved.revision, definition, observation });
  assert.equal(verified.status, 200);
  const body = { appKey: saved.key, revision: saved.revision, llmRevision: 1, question: 'Explain revenue for Feb 26.', pageTicket: verified.body.ticket };
  const answer = await request(server, store, 'POST', '/chat', body);
  assert.equal(answer.status, 200); assert.equal(answer.body.sources.length, 2);
  assert.equal(answer.body.sources[1].effectiveFilters[0].label, 'Feb 26');
  assert.equal(answer.body.pageContext.sources[0].filters[0].label, 'Jan 26');
  assert.equal(answer.body.sources[1].effectiveFilters[1].label, 'Actual');
  assert.ok(answer.body.sources[0].dependencyPaths.length);
  assert.equal((await request(server, store, 'POST', '/chat', { ...body, pageTicket: 'missing' })).status, 409);
  await request(server, store, 'POST', '/connection', { clientId: 'synthetic-other' });
  assert.equal((await request(server, store, 'POST', '/chat', body)).status, 409);
});

test('custom-card chat: discover and verify → inspect metadata/formula → read module → return a scoped count with evidence', async t => {
  for (const truncated of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), 'xanaplan-custom-flow-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const store = new Store(dir), fixture = storeFixture({ truncated }), { mcp } = fixture;
    mcp.discover = async tool => ({ items: tool === 'show_workspaces' ? [{ id: model.workspaceId, name: model.workspaceName }] : [{ id: model.modelId, name: model.name }], incomplete: false });
    mcp.clientId = () => 'synthetic'; mcp.reset = async () => {};
    let step = 0;
    // Scripted provider verifies the real tool contract/evidence plumbing; this is
    // not an assertion about a live AI provider's reasoning accuracy.
    const providers = { select: () => ({ settings: store.getLlm(), check() {}, decide: async payload => {
      assert.ok(payload.tools.some(tool => tool.name === 'read_module_cells'));
      assert.equal(payload.pageContext.sources[0].moduleEvidence, true);
      assert.equal(payload.pageContext.sources[0].query.filters.existingLineItemId, '201');
      if (step++ === 0) return { kind: 'read', tool: 'show_lineitems', arguments: JSON.stringify({ modelKey: model.key, moduleId: '101' }) };
      if (step === 2) return { kind: 'read', tool: 'follow_formula', arguments: JSON.stringify({ modelKey: model.key, moduleId: '101', lineItemId: '201' }) };
      if (step === 3) return { kind: 'read', tool: 'read_module_cells', arguments: JSON.stringify({ modelKey: model.key, sourceId: 'stores:0', moduleId: '101' }) };
      const cells = payload.evidence.find(item => item.tool === 'read_module_cells');
      assert.equal(cells.coverage.exactCard, false);
      assert.equal(cells.effectiveFilters[0].label, 'Actual');
      assert.equal(cells.pendingFilters[0].label, 'Canada');
      if (truncated) {
        assert.equal(cells.partial, true);
        return { kind: 'answer', answer: 'The store data is incomplete, so I cannot verify the total.', sourceIds: [cells.id] };
      }
      const data = JSON.parse(cells.text);
      assert.equal(data.rows.length, data.totalRows);
      const country = cells.pendingFilters[0].label;
      const count = new Set(data.rows.filter(row => row.Country === country && row.Existing && row.Size === 'Medium' && row.leaf).map(row => row.id)).size;
      assert.equal(count, 2);
      return { kind: 'answer', answer: `${count} existing stores have size Medium in Canada (Actual), based on verified store attributes.`, sourceIds: [cells.id] };
    } }) };
    const server = createApp({ store, mcp, providers });
    const discovery = await request(server, store, 'POST', '/app-discovery', { ...app, models: [{ id: model.modelId, name: model.name, workspaceName: model.workspaceName }] });
    const enabled = await request(server, store, 'POST', '/apps', { ticket: discovery.body.ticket, revision: 0, modelKeys: [model.key], context: 'Synthetic store planning' });
    const saved = enabled.body.app;
    const fetchImpl = async url => new Response(JSON.stringify(url.includes('/boards/') ? fixture.definition : catalog), { headers: { 'content-type': 'application/json' } });
    const definition = await readPageDefinition({ ...app, pageId }, { fetchImpl });
    const verified = await request(server, store, 'POST', '/page-context', { appKey: saved.key, revision: saved.revision, definition, observation: fixture.observed });
    assert.equal(verified.status, 200);
    const response = await request(server, store, 'POST', '/chat', { appKey: saved.key, revision: saved.revision, llmRevision: 1, pageTicket: verified.body.ticket, question: 'How many existing stores in store size medium?' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.match(response.body.answer, truncated ? /incomplete/ : /^2 existing stores/);
    assert.equal(response.body.sources[0].tool, 'read_module_cells');
    assert.equal(response.body.sources[0].coverage.exactCard, false);
    assert.equal(response.body.sources[0].pendingFilters[0].label, 'Canada');
    assert.ok(mcp.calls.some(call => call.tool === 'read_cells'));
  }
});
