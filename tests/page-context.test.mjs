import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPageContext } from '../server/page-context.mjs';
import { createPageScope, formulaReferences } from '../server/page-scope.mjs';
import { metadataTable } from '../server/page-metadata.mjs';
import { pageDefinition } from '../extension/page-api.mjs';
import { app, pageId, board, observation, model, syntheticMcp } from './fixtures/page.mjs';

export async function contextFixture(options = {}) {
  const mcp = syntheticMcp();
  const definition = pageDefinition(board, { id: pageId, type: 'boards' }, app);
  const input = { revision: app.revision, definition, observation: structuredClone(observation), ...options };
  const context = await verifyPageContext({ app, input, mcp });
  return { mcp, context, definition, input };
}
test('MCP verifies page modules, saved-view membership and independently observed card filters', async () => {
  const { context } = await contextFixture();
  assert.equal(context.model.key, model.key);
  assert.deepEqual(context.sources.map(source => source.moduleId), ['101', '101']);
  assert.equal(context.sources[0].filters.find(filter => filter.dimensionId === '502').label, 'Actual');
  assert.equal(context.sources[1].filters.find(filter => filter.dimensionId === '502').label, 'Budget');
  assert.deepEqual(context.sources[0].missing, []);
});
test('manual pages label same-model inherited selectors and independent defaults accurately', async () => {
  const { context } = await contextFixture({ mode: 'manual', observation: { ...observation, inheritedModelKey: model.key } });
  assert.equal(context.sources[0].filters[0].origin, 'inherited from tab');
  assert.equal(context.sources[1].filters.find(filter => filter.dimensionId === '502').origin, 'page default');
  const other = await contextFixture({ mode: 'manual', observation: { ...observation, inheritedModelKey: 'another-model' } });
  assert.equal(other.context.sources[0].filters[0].origin, 'page default');
});
test('ambiguous alternative models never silently select the published default', async () => {
  const { definition, mcp } = await contextFixture();
  definition.models.push({ workspaceId: model.workspaceId, modelId: 'C'.repeat(32) });
  await assert.rejects(verifyPageContext({ app, input: { revision: 1, definition, observation: {} }, mcp }), /uniquely/);
});
test('unknown, duplicate, scoped and hidden selectors cannot silently broaden a cell read', async () => {
  for (const selections of [[], [...observation.selections, observation.selections[0]], observation.selections.map(item => ({ ...item, scope: 'SINGLE' }))]) {
    const { context, mcp } = await contextFixture({ observation: { ...observation, selections } });
    const gate = createPageScope(context, { mcp, model, question: 'Revenue?' });
    await assert.rejects(gate.execute('read_cells', { sourceId: 'revenue:0', moduleId: '101', viewId: '101' }), /unknown|missing|associated|context/i);
    assert.equal(mcp.calls.some(call => call.tool === 'read_cells'), false);
  }
});
test('explicit query overrides resolve IDs and preserve all other selectors', async () => {
  const { context, mcp } = await contextFixture();
  const gate = createPageScope(context, { mcp, model, question: 'Show Feb 26 revenue using Budget.' });
  const result = await gate.execute('read_cells', { sourceId: 'revenue:0', moduleId: '101', viewId: '101', contextOverrides: [{ dimensionId: '501', itemName: 'Feb 26', questionQuote: 'Feb 26' }] });
  assert.deepEqual(result.arguments.pages, [{ dimensionId: '501', itemId: '602' }, { dimensionId: '502', itemId: '603' }]);
  assert.equal(result.effectiveFilters[0].origin, 'question override');
  assert.equal(context.sources[0].filters[0].itemId, '601');
  await assert.rejects(gate.execute('read_cells', { sourceId: 'revenue:0', moduleId: '101', viewId: '101', contextOverrides: [{ dimensionId: '502', itemName: 'Actual', questionQuote: 'Actual' }] }), /explicit/);
  await assert.rejects(gate.execute('read_cells', { sourceId: 'revenue:0', moduleId: '101', viewId: '101', pages: [] }), /helper/);
});
test('page reads cannot substitute default views or access unrelated modules', async () => {
  const { context, mcp } = await contextFixture();
  const gate = createPageScope(context, { mcp, model, question: 'Revenue?' });
  await assert.rejects(gate.execute('read_cells', { sourceId: 'budget:0', moduleId: '101', viewId: '101' }), /substitute/);
  await assert.rejects(gate.execute('show_lineitems', { moduleId: '104' }), /outside/);
  await assert.rejects(gate.execute('show_viewdetails', { moduleId: '101', viewId: '999' }), /outside/);
  const catalog = await gate.execute('show_modules', {}); assert.doesNotMatch(catalog.text, /Unrelated/);
});
test('formula dependencies expand lazily, include mapping references and handle cycles', async () => {
  const { context, mcp } = await contextFixture();
  const gate = createPageScope(context, { mcp, model, question: 'What drives revenue?' });
  const first = await gate.execute('follow_formula', { moduleId: '101', lineItemId: '201' });
  assert.deepEqual(JSON.parse(first.text).dependencies.map(item => item.moduleId), ['102', '103']);
  const second = await gate.execute('follow_formula', { moduleId: '102', lineItemId: '203' });
  assert.equal(JSON.parse(second.text).dependencies.length, 2);
  const cells = await gate.execute('read_cells', { sourceId: 'revenue:0', moduleId: '102', viewId: '102' });
  assert.ok(cells.dependencyPaths.length >= 3);
  await assert.rejects(gate.execute('follow_formula', { moduleId: '102', lineItemId: '999' }), /referenced/);
  await assert.rejects(gate.execute('show_lineitems', { moduleId: '104' }), /outside/);
});
test('formula parsing handles quoted names, SUM/LOOKUP mappings and ignores text literals', () => {
  const modules = [{ ID: '1', Name: 'Sales Plan' }, { ID: '2', Name: 'Mapping' }];
  const refs = formulaReferences(`'Sales Plan'.'Gross Revenue'[SUM: Mapping.Region] + "Mapping.Secret"`, modules, []);
  assert.deepEqual(refs, [{ moduleId: '1', lineName: 'Gross Revenue' }, { moduleId: '2', lineName: 'Region' }]);
  assert.deepEqual(formulaReferences('IF Flag THEN Mapping.Region ELSE 0', modules, []), [{ moduleId: '2', lineName: 'Region' }]);
});
test('metadata parser rejects truncation and correctly preserves escaped formula pipes', () => {
  assert.throws(() => metadataTable('100 more not shown'), /incomplete/);
  assert.equal(metadataTable('| Name | Text |\n| ID | 123 |\n| Formula | "A\\|B" |')[0].Formula, '"A|B"');
});
