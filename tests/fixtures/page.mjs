export const appId = '00000000-0000-0000-0000-000000000001';
export const pageId = '00000000-0000-0000-0000-000000000002';
export const secondPageId = '00000000-0000-0000-0000-000000000003';
export const model = { key: `${'A'.repeat(32)}:${'B'.repeat(32)}`, workspaceId: 'A'.repeat(32), modelId: 'B'.repeat(32), name: 'Synthetic planning', workspaceName: 'Synthetic workspace' };
export const app = { key: `https://us1a.app.anaplan.com|testtenant|${appId}`, appId, origin: 'https://us1a.app.anaplan.com', tenantId: 'testtenant', tenantName: 'Test tenant', name: 'Planning', models: [model], context: 'Synthetic test data', revision: 1 };
export const catalog = { guid: appId, customerId: app.tenantId, pages: [{ identifier: pageId, name: 'Performance', pageType: 'BOARD', appGuid: appId, hasPublishedVersion: true }, { identifier: secondPageId, name: 'Costs', pageType: 'GRID', hasPublishedVersion: true }] };
export const board = { pageGuid: pageId, appGuid: appId, customerId: app.tenantId, name: 'Performance', currentPublishedVersionGuid: 'published-v1',
  modelId: model.modelId, workspaceId: model.workspaceId, modelInfos: [{ ...model, modelName: model.name }],
  contextOptions: [{ dimensionId: '501', defaultValue: '601' }, { dimensionId: '502', defaultValue: '603' }],
  widgets: {
    revenue: { clientGuid: 'revenue', type: 'CARD', defaultTitle: 'Revenue', dataSourceId: '101', contextOptions: [] },
    budget: { clientGuid: 'budget', type: 'TABLE', defaultTitle: 'Budget', dataSourceId: '901', contextOptions: [{ dimensionId: '502', defaultValue: '604', syncedToPage: false }] },
  },
};
export const observation = { url: `${app.origin}/a/apps/app/${appId}/boards/${pageId}`, rendered: true, pageName: 'Performance', modelName: model.name, cardIds: ['revenue', 'budget'], selections: [
  { dimensionId: '501', label: 'Jan 26', cardId: '', scope: '' }, { dimensionId: '502', label: 'Actual', cardId: '', scope: '' }, { dimensionId: '502', label: 'Budget', cardId: 'budget', scope: '' },
] };
export function table(rows) {
  if (!rows.length) return 'No items found.';
  if (rows.length === 1) return Object.entries(rows[0]).map(([key, value]) => `| ${key} | ${value} |`).join('\n');
  const keys = Object.keys(rows[0]);
  return `| # | ${keys.join(' | ')} |\n| --- | ${keys.map(() => '---').join(' | ')} |\n${rows.map((row, index) => `| ${index + 1} | ${keys.map(key => row[key]).join(' | ')} |`).join('\n')}`;
}
export const dimensions = viewId => `**View:** Synthetic view\n**View ID:** ${viewId}\n\n**Rows:**\n  - Line Items (500)\n**Columns:** (none)\n**Pages:**\n  - Time (501)\n  - Versions (502)`;
export function syntheticMcp() {
  const calls = [];
  const lines = {
    '101': [{ ID: '201', Name: 'Revenue', Formula: "'Drivers'.Amount * 'Mapping'.Scale" }, { ID: '202', Name: 'Variance', Formula: 'Revenue - Budget' }],
    '102': [{ ID: '203', Name: 'Amount', Formula: "'Mapping'.Scale + 'Revenue'.Revenue" }],
    '103': [{ ID: '204', Name: 'Scale', Formula: '1' }],
    '104': [{ ID: '205', Name: 'Secret', Formula: '' }],
  };
  const items = { '501': [{ Name: 'Jan 26', ID: '601' }, { Name: 'Feb 26', ID: '602' }], '502': [{ Name: 'Actual', ID: '603' }, { Name: 'Budget', ID: '604' }] };
  return {
    calls, lines, items,
    tools: async () => ['show_modules', 'show_moduledetails', 'show_lineitems', 'show_savedviews', 'show_viewdetails', 'read_cells'].map(name => ({ name, inputSchema: { type: 'object', properties: Object.fromEntries(['workspaceId', 'modelId', 'moduleId', 'viewId', 'maxRows', 'pages', 'includeAll', 'limit', 'search'].map(key => [key, { type: 'string' }])) } })),
    read: async (tool, args, selected, signal) => {
      if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { status: 499 });
      if (selected.key !== model.key) throw new Error('Unexpected model');
      calls.push({ tool, args: structuredClone(args) });
      let text;
      if (tool === 'show_modules') text = table([{ ID: '101', Name: 'Revenue' }, { ID: '102', Name: 'Drivers' }, { ID: '103', Name: 'Mapping' }, { ID: '104', Name: 'Unrelated' }]);
      else if (tool === 'show_savedviews') text = table(args.moduleId === '101' ? [{ ID: '901', Name: 'Budget', Module: '101' }] : []);
      else if (tool === 'show_viewdetails') text = dimensions(args.viewId);
      else if (tool === 'show_lineitems') text = table(lines[args.moduleId] || []);
      else if (tool === 'lookup_dimensionitems' || tool === 'show_dimensionitems') text = table((items[args.dimensionId] || []).filter(item => args.names ? args.names.includes(item.Name) : !args.search || item.ID === args.search));
      else if (tool === 'read_cells') text = JSON.stringify({ data: [{ Revenue: args.pages.find(item => item.dimensionId === '502')?.itemId === '604' ? 100 : 120 }], synthetic: true });
      else throw new Error(`Unexpected synthetic tool ${tool}`);
      return { text, arguments: { ...args, workspaceId: selected.workspaceId, modelId: selected.modelId } };
    },
  };
}
