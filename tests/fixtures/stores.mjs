import { board, observation, syntheticMcp, table } from './page.mjs';

// Illustrative custom-card metadata and records, not captured customer data.
export function storeFixture({ countryOnPages = false, truncated = false } = {}) {
  const definition = structuredClone(board);
  definition.contextOptions = [{ dimensionId: '501', dimensionName: 'Country', defaultValue: '601' }, { dimensionId: '502', dimensionName: 'Versions', defaultValue: '603' }];
  const query = { regions: { SINGLE: { moduleId: '101' } }, filters: { existingLineItemId: '201', value: true } };
  definition.widgets = {
    stores: { clientGuid: 'stores', type: 'TABLE', defaultTitle: 'Existing Stores', widgetDataSources: [{ dataSourceId: 'view:stores', dataSourceType: 'MULTI_AXIS_DESCRIPTION', axisDescriptionQuery: JSON.stringify(query) }] },
    text: { type: 'TEXT', dataSourceId: '-1' },
    action: { type: 'ACTION', widgetDataSources: [{ dataSourceId: 'action:create', dataSourceType: 'CLASSIC' }] },
  };
  const observed = { ...structuredClone(observation), selections: [{ dimensionId: '501', label: 'Canada', cardId: '', scope: '' }, { dimensionId: '502', label: 'Actual', cardId: '', scope: '' }] };
  const rows = [
    { id: 's1', Country: 'Canada', Existing: true, Size: 'Medium', leaf: true },
    { id: 's2', Country: 'Canada', Existing: true, Size: 'Medium', leaf: true },
    { id: 's2', Country: 'Canada', Existing: true, Size: 'Medium', leaf: true },
    { id: 'placeholder', Country: 'Canada', Existing: false, Size: 'Medium', leaf: true },
    { id: 'usa', Country: 'USA', Existing: true, Size: 'Medium', leaf: true },
    { id: 'large', Country: 'Canada', Existing: true, Size: 'Large', leaf: true },
    { id: 'summary', Country: 'Canada', Existing: true, Size: 'Medium', leaf: false },
  ];
  const mcp = syntheticMcp(), originalRead = mcp.read;
  mcp.items['501'] = [{ ID: '601', Name: 'Canada' }, { ID: '602', Name: 'USA' }];
  mcp.lines['101'] = [{ ID: '201', Name: 'Existing', Formula: "'Mapping'.Scale > 0" }, { ID: '202', Name: 'Size', Formula: '' }, { ID: '203', Name: 'Country', Formula: '' }];
  mcp.read = async (tool, args, model, signal) => {
    let text;
    if (tool === 'show_modules') text = table([{ ID: '101', Name: 'Store attributes' }, { ID: '102', Name: 'Drivers' }, { ID: '103', Name: 'Mapping' }, { ID: '104', Name: 'Unrelated' }]);
    else if (tool === 'show_viewdetails') text = `**View:** Stores\n**View ID:** ${args.viewId}\n**Rows:**\n  - Stores (700)\n**Columns:**\n  - Line Items (20000000012)\n**Pages:**\n  - Versions (502)${countryOnPages ? '\n  - Country (501)' : ''}`;
    else if (tool === 'read_cells') {
      const filtered = rows.filter(row => !countryOnPages || row.Country === (args.pages.find(page => page.dimensionId === '501')?.itemId === '602' ? 'USA' : 'Canada'));
      text = JSON.stringify(truncated ? { _truncated: true, _message: 'Response too large.' } : { rows: filtered.slice(0, args.maxRows), totalRows: filtered.length });
    } else return originalRead(tool, args, model, signal);
    mcp.calls.push({ tool, args: structuredClone(args) });
    return { text, arguments: { ...args, workspaceId: model.workspaceId, modelId: model.modelId } };
  };
  return { definition, observed, mcp, query, rows };
}
