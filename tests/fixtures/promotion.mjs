import assert from 'node:assert/strict';
import { app, model, board, observation, table, syntheticMcp } from './page.mjs';
import { AppError } from '../../server/validation.mjs';

// Synthetic hierarchy: the visible parent is present in view members but absent
// from direct name lookup. No customer definitions or business values are used.
export function promotionFixture({ duplicate = false, advanced = false, wrongLineItem = false } = {}) {
  const definition = { ...structuredClone(board), name: 'Sell-In Actuals', contextOptions: [{ dimensionId: '501', defaultValue: '701' }],
    widgets: { actuals: { clientGuid: 'actuals', type: 'TABLE', defaultTitle: 'Sell-In Actuals', allowFiltering: true,
      contextOptions: [{ dimensionId: '20000000012', scope: '101', defaultValue: wrongLineItem ? '999' : '201', syncedToPage: false, visible: false, ...(advanced ? { selectedItems: ['201', '202'] } : {}) }],
      widgetDataSources: [{ dataSourceId: 'view:synthetic-sell-in', dataSourceType: 'CUSTOM_VIEW', axisDescriptionQuery: {
        regions: { SINGLE: { moduleId: '101', rows: { dimensions: [{ id: '503' }] }, columns: { dimensions: [{ id: '20000000003' }] } } },
      } }],
    } },
  };
  const observed = { ...observation, pageName: definition.name, cardIds: ['actuals'], selections: [{ dimensionId: '501', label: 'ExampleMart', cardId: '', scope: '' }] };
  const mcp = syntheticMcp();
  mcp.clientId = () => 'synthetic'; mcp.reset = async () => {};
  mcp.discover = async tool => ({ items: tool === 'show_workspaces' ? [{ id: model.workspaceId, name: model.workspaceName }] : [{ id: model.modelId, name: model.name }], incomplete: false });
  mcp.read = async (tool, args, selected, signal) => {
    if (signal?.aborted) throw new AppError('Cancelled', 499);
    assert.equal(selected.key, model.key);
    mcp.calls.push({ tool, args: structuredClone(args) });
    let text;
    const dimensions = `**View:** Synthetic sell-in\n**View ID:** ${args.viewId || args.moduleId}\n\n**Rows:**\n  - Product (503)\n**Columns:**\n  - Time (20000000003)\n**Pages:**\n  - Customer Account (501)\n  - Line Items (20000000012)`;
    const lines = [{ ID: '201', Name: 'Sell-In Actuals', Formula: '', Format: 'NUMBER', Units: 'units', Summary: 'SUM' }];
    const otherItems = { '503': [{ ID: '801', Name: 'Herbal shampoo L' }], '20000000003': [{ ID: '901', Name: '1 Jan 24' }] };
    if (tool === 'show_modules') text = table([{ ID: '101', Name: 'Synthetic Sell-In Actuals' }]);
    else if (tool === 'show_lineitems') text = table(lines);
    else if (tool === 'show_moduledetails' || tool === 'show_viewdetails') text = dimensions;
    else if (tool === 'show_savedviews') text = 'No items found.';
    else if (tool === 'lookup_dimensionitems') text = table((otherItems[args.dimensionId] || []).filter(item => args.names?.includes(item.Name)));
    else if (tool === 'show_dimensionitems') text = table(args.dimensionId === '501' ? [{ ID: '702', Name: 'ExampleMart East' }] : otherItems[args.dimensionId] || []);
    else if (tool === 'show_viewdimensionitems') {
      const items = args.dimensionId === '501' ? [{ ID: '701', Name: 'ExampleMart' }, { ID: '702', Name: 'ExampleMart East' }, ...(duplicate ? [{ ID: '703', Name: 'ExampleMart' }] : [])] : args.dimensionId === '20000000012' ? lines : otherItems[args.dimensionId] || [];
      text = table(items.filter(item => !args.search || item.Name.toLowerCase().includes(args.search.toLowerCase()) || item.ID === args.search));
    } else if (tool === 'read_cells') {
      assert.deepEqual(args.pages, [{ dimensionId: '501', itemId: '701' }, { dimensionId: '20000000012', itemId: '201' }]);
      text = JSON.stringify({ rows: [{ Product: 'Herbal shampoo L', Time: '1 Jan 24', Customer: 'ExampleMart', 'Sell-In Actuals': 48, Units: 'units' }], totalRows: 1, hasMore: false, synthetic: true });
    } else throw new AppError(`Unexpected synthetic tool ${tool}`, 502);
    return { text, arguments: { ...args, workspaceId: selected.workspaceId, modelId: selected.modelId } };
  };
  return { app, model, definition, observed, mcp };
}
