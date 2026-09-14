import test from 'node:test';
import assert from 'node:assert/strict';
import { pageDefinition } from '../extension/page-api.mjs';
import { verifyPageContext } from '../server/page-context.mjs';
import { createPageScope } from '../server/page-scope.mjs';
import { app, model, pageId } from './fixtures/page.mjs';
import { storeFixture } from './fixtures/stores.mjs';

export async function customContext(options = {}) {
  const fixture = storeFixture(options);
  const definition = pageDefinition(fixture.definition, { id: pageId, type: 'boards' }, app);
  const input = { revision: app.revision, definition, observation: fixture.observed, ...options.input };
  const context = await verifyPageContext({ app, input, mcp: fixture.mcp });
  const gate = createPageScope(context, { mcp: fixture.mcp, model, question: options.question || 'How many existing stores in store size medium?' });
  return { ...fixture, definition, input, context, gate };
}
const readArgs = { sourceId: 'stores:0', moduleId: '101' };

test('custom cards retain verified modules, query metadata and context; decorative identifiers are excluded', async () => {
  const { context, query } = await customContext();
  assert.equal(context.sources.length, 1);
  const source = context.sources[0];
  assert.equal(source.moduleEvidence, true);
  assert.equal(source.moduleName, 'Store attributes');
  assert.deepEqual(source.query, query);
  assert.equal(source.filters.find(item => item.dimensionId === '501').label, 'Canada');
  assert.doesNotMatch(source.warning, /cannot|not supported|invalid/i);
});
test('custom module reads retain off-axis country requirements instead of silently broadening the answer', async () => {
  const { context, gate, mcp } = await customContext();
  const evidence = await gate.execute('read_module_cells', readArgs);
  assert.equal(evidence.coverage.exactCard, false);
  assert.deepEqual(evidence.arguments.pages, [{ dimensionId: '502', itemId: '603' }]);
  assert.equal(evidence.pendingFilters[0].dimensionName, 'Country');
  assert.equal(evidence.pendingFilters[0].label, 'Canada');
  assert.deepEqual(evidence.coverage.unresolvedContext, []);
  assert.ok(JSON.parse(evidence.text).rows.some(row => row.Country === 'USA'));
  await assert.rejects(gate.execute('read_cells', { ...readArgs, viewId: '101' }), /substitute|reproduced|filters/);
  assert.equal(mcp.calls.filter(item => item.tool === 'read_cells').length, 1);
  assert.equal(context.sources[0].filters[0].label, 'Canada');
});
test('module page-axis filters are applied, explicit overrides retain other selections and never mutate tab context', async () => {
  const { context, gate } = await customContext({ countryOnPages: true, question: 'How many existing medium stores in USA?' });
  const result = await gate.execute('read_module_cells', { ...readArgs, contextOverrides: [{ dimensionId: '501', itemName: 'USA', questionQuote: 'in USA' }] });
  assert.equal(result.arguments.pages.find(item => item.dimensionId === '501').itemId, '602');
  assert.equal(result.arguments.pages.find(item => item.dimensionId === '502').itemId, '603');
  assert.deepEqual(result.pendingFilters, []);
  assert.ok(JSON.parse(result.text).rows.every(row => row.Country === 'USA'));
  assert.equal(context.sources[0].filters[0].label, 'Canada');
  await assert.rejects(gate.execute('read_module_cells', { ...readArgs, contextOverrides: [{ dimensionId: '501', itemName: 'Canada', questionQuote: 'Canada' }] }), /explicit/);
});
test('missing page dimensions block arbitrary defaults; off-axis ambiguity remains visible for investigation', async () => {
  const empty = await customContext({ input: { observation: { rendered: true, modelName: model.name, selections: [] } } });
  await assert.rejects(empty.gate.execute('read_module_cells', readArgs), /Specify Versions/);
  assert.equal(empty.mcp.calls.some(item => item.tool === 'read_cells'), false);
  const ambiguous = await customContext({ input: { observation: { rendered: true, modelName: model.name, selections: [{ dimensionId: '502', cardId: '', label: 'Actual', scope: '' }] } } });
  const result = await ambiguous.gate.execute('read_module_cells', readArgs);
  assert.ok(result.coverage.unresolvedContext.some(item => item.includes('Country')));
  assert.ok(result.pendingFilters.some(item => item.dimensionId === '501' && item.issue));
});
test('module evidence preserves access and view ownership gates while allowing verified formula dependencies', async () => {
  const { gate, mcp } = await customContext();
  await assert.rejects(gate.execute('read_module_cells', { ...readArgs, moduleId: '104' }), /outside/);
  await assert.rejects(gate.execute('read_module_cells', { ...readArgs, viewId: '999' }), /outside/);
  await assert.rejects(gate.execute('read_module_cells', { ...readArgs, pages: [] }), /helper/);
  assert.equal(mcp.calls.some(item => item.tool === 'read_cells'), false);
  await gate.execute('follow_formula', { moduleId: '101', lineItemId: '201' });
  const result = await gate.execute('read_module_cells', { ...readArgs, moduleId: '103' });
  assert.equal(result.dependencyPaths[0].moduleId, '103');
});
test('manual custom pages inherit only same-model context and retain independent card defaults', async () => {
  const fixture = storeFixture();
  fixture.definition.widgets.stores.contextOptions = [{ dimensionId: '501', defaultValue: '602', syncedToPage: false }];
  const definition = pageDefinition(fixture.definition, { id: pageId, type: 'boards' }, app);
  const context = await verifyPageContext({ app, mcp: fixture.mcp, input: { revision: 1, definition, mode: 'manual', observation: { ...fixture.observed, inheritedModelKey: model.key } } });
  assert.equal(context.sources[0].filters.find(item => item.dimensionId === '501').label, 'USA');
  assert.equal(context.sources[0].filters.find(item => item.dimensionId === '501').origin, 'page default');
  assert.equal(context.sources[0].filters.find(item => item.dimensionId === '502').origin, 'inherited from tab');
});
test('truncation and row limits are explicitly marked partial for module evidence', async () => {
  const truncated = await customContext({ truncated: true });
  assert.equal((await truncated.gate.execute('read_module_cells', readArgs)).partial, true);
  const limited = await customContext();
  const result = await limited.gate.execute('read_module_cells', { ...readArgs, maxRows: 2 });
  assert.equal(result.partial, true);
  assert.equal(result.coverage.partial, true);
  assert.equal(result.arguments.maxRows, 2);
});
