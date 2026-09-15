import { discoveryInput, appOrigin } from './discovery-input.mjs';
import { requestJson } from './discovery-api.mjs';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const ID = /^\d{1,20}$/;
const ROOT = '/a/springboard-definition-service';
const fail = message => { throw new Error(message); };
const list = (value, limit = 500) => Array.isArray(value) && value.length <= limit ? value : fail('Unrecognized or oversized page definition. Refresh page context.');
const name = value => typeof value === 'string' && value.trim() && value.length <= 2000 ? value.trim() : fail('Page metadata is missing a name.');
const guid = value => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : fail('Page metadata has an invalid identifier.');
const unpack = value => typeof value === 'string' ? JSON.parse(value || '{}') : value;
const nonempty = value => value != null && value !== false && value !== '' && (typeof value !== 'object' || Object.keys(value).length > 0);

export function pageFromUrl(value) {
  try {
    const origin = appOrigin(value), url = new URL(value);
    const match = url.pathname.match(/^\/a\/apps\/app\/([^/]+)\/(boards|worksheets|reports)\/([^/]+)(\/edit)?\/?$/);
    if (!match || !UUID.test(match[1]) || !UUID.test(match[3])) return null;
    return { origin, appId: match[1].toLowerCase(), pageId: match[3].toLowerCase(), type: match[2], editing: Boolean(match[4]) };
  } catch { return null; }
}

export function pageCatalog(data, app) {
  if (data.customerId !== app.tenantId || guid(data.guid) !== app.appId) fail('This app belongs to a different tenant. Refresh apps in Admin.');
  const pages = list(data.pages, 2000);
  if (data.hasMore || data.next || (data.totalCount && data.totalCount > pages.length)) fail('The page list is incomplete. Refresh page context.');
  const seen = new Set();
  return pages.filter(page => page.hasPublishedVersion !== false).map(page => {
    const id = guid(page.identifier);
    if (seen.has(id) || (page.appGuid && guid(page.appGuid) !== app.appId)) fail('Anaplan returned conflicting page membership.');
    seen.add(id);
    const type = typeof page.pageType === 'string' ? page.pageType.trim().toUpperCase() : '';
    return { id, name: name(page.name), type: ({ BOARD: 'boards', 'GRID-PAGE': 'worksheets', GRID: 'worksheets', WORKSHEET: 'worksheets', REPORT: 'reports' })[type] || 'unsupported' };
  });
}

function contextOptions(value) {
  return list(value || [], 100).map(option => {
    const advanced = Boolean(nonempty(option.filter) || nonempty(option.selections) || nonempty(option.selectedItems) || option.contextFilterType === 'BRANCH_SYNC');
    return {
      dimensionId: String(option.dimensionId), scope: option.scope == null ? '' : String(option.scope),
      dimensionName: String(option.dimensionName || ''),
      itemId: option.defaultValue == null ? '' : String(option.defaultValue),
      synced: option.syncedToPage !== false, visible: option.visible !== false,
      advanced, unsupported: Boolean(option.scope || advanced),
    };
  });
}

// Explicit adapters for the published Springboard board / worksheet contracts.
// Custom queries are identified, never silently replaced by a module's default view.
export function pageDefinition(data, page, app) {
  if (guid(data.pageGuid) !== page.id || guid(data.appGuid) !== app.appId || data.customerId !== app.tenantId) fail('The page no longer belongs to this app and tenant. Refresh pages.');
  const modelInfos = list(data.modelInfos?.length ? data.modelInfos : [{ modelId: data.modelId, workspaceId: data.workspaceId }], 100);
  const models = modelInfos.map(model => {
    if (!/^[a-f0-9]{32}$/i.test(model.modelId || '') || !/^[a-f0-9]{32}$/i.test(model.workspaceId || '')) fail('Page model membership is unrecognized.');
    return { modelId: model.modelId.toUpperCase(), workspaceId: model.workspaceId.toUpperCase(), name: model.modelName || '' };
  });
  let widgets;
  if (page.type === 'boards') {
    if (!data.widgets || typeof data.widgets !== 'object' || Array.isArray(data.widgets)) fail('Unrecognized board cards.');
    widgets = Object.entries(data.widgets).map(([id, widget]) => ({ ...widget, clientGuid: widget.clientGuid || id }));
  } else if (page.type === 'worksheets') {
    widgets = list(data.widgets).map(widget => widget.widgetDefinition || fail('Unrecognized worksheet card.'));
    // The main worksheet grid is a separate source, outside its insight cards.
    if (data.dataSourceId || data.widgetDataSources?.length) widgets.unshift({ ...data, type: 'TABLE', clientGuid: `mainGrid:${page.id}`, defaultTitle: page.name });
  } else fail(page.type === 'reports' ? 'Xanaplan cannot read report pages yet. Choose a board or worksheet for chat.' : 'Xanaplan does not recognize this page type. Choose a supported page for chat.');
  list(widgets);
  const sources = [], warnings = [];
  let queryBudget = 40000;
  for (const widget of widgets) {
    const cardId = String(widget.clientGuid || widget.widgetGuid || '');
    if (!cardId || cardId.length > 100) fail('A card is missing its identifier.');
    let definitions = widget.widgetDataSources;
    if (!definitions?.length && widget.dataSourceId && (ID.test(String(widget.dataSourceId)) || String(widget.dataSourceId).startsWith('view:'))) definitions = [{ dataSourceId: widget.dataSourceId, dataSourceType: String(widget.dataSourceId).startsWith('view:') ? 'CUSTOM_VIEW' : 'CLASSIC', axisDescriptionQuery: widget.axisDescriptionQuery }];
    if (!definitions?.length && widget.fields?.length) definitions = widget.fields.map(field => ({ dataSourceId: field.moduleId, subEntityId: field.lineItemId, dataSourceType: 'LINE_ITEM' }));
    if (!definitions?.length && widget.dataConfig) definitions = list(unpack(widget.dataConfig).columns).filter(column => column.type === 'DATA').map(column => ({ dataSourceId: column.moduleId, dataSourceType: 'VIEW_DESCRIPTION' }));
    if (!definitions?.length) {
      if (!['TEXT', 'IMAGE', 'ACTION', 'SHAPE'].includes(widget.type)) warnings.push(`${widget.defaultTitle || widget.type}: card source is unavailable.`);
      continue;
    }
    for (const [index, source] of list(definitions, 30).entries()) {
      const rawId = String(source.dataSourceId || ''), kind = source.dataSourceType;
      const query = unpack(source.axisDescriptionQuery);
      const moduleIds = [...new Set([...(ID.test(rawId) && kind !== 'CLASSIC' ? [rawId] : []), ...Object.values(query?.regions || {}).map(region => String(region.moduleId || '')), ...(query?.moduleId ? [String(query.moduleId)] : [])])].filter(id => ID.test(id));
      if (['TEXT', 'IMAGE', 'ACTION', 'SHAPE'].includes(widget.type) && !ID.test(rawId) && !rawId.startsWith('view:') && !moduleIds.length) continue;
      const queryText = query && typeof query === 'object' ? JSON.stringify(query) : '';
      const keepQuery = queryText.length > 0 && queryText.length <= Math.min(16000, queryBudget);
      if (keepQuery) queryBudget -= queryText.length;
      const unsupported = !['CLASSIC', 'LINE_ITEM'].includes(kind) || !ID.test(rawId);
      const runtimeCustomizable = Boolean(widget.allowFiltering || widget.pivotEnabled || widget.branchSync && widget.branchSync !== '[]');
      sources.push({ id: `${cardId}:${index}`, cardId, name: String(widget.defaultTitle || widget.type || 'Card').slice(0, 2000), kind,
        sourceId: rawId, moduleIds, lineItemId: source.subEntityId == null ? '' : String(source.subEntityId),
        query: keepQuery ? query : null, queryOmitted: !keepQuery,
        options: contextOptions(widget.contextOptions), unsupported,
        warning: unsupported ? 'Module data can be investigated; custom card filters need verification.' : runtimeCustomizable ? 'This card allows runtime filters or pivots that cannot yet be verified.' : '',
        runtimeCustomizable,
      });
    }
  }
  if (!sources.length) fail('No readable module sources were identified on this page.');
  if (new Set(sources.map(source => source.id)).size !== sources.length) fail('Duplicate card identifiers in page definition.');
  return { page: { id: page.id, name: name(data.name), type: page.type }, models, sources, options: contextOptions(data.contextOptions), warnings, definitionRevision: String(data.currentPublishedVersionGuid || ''), discoveredAt: new Date().toISOString() };
}

export async function readPageDefinition(input, options = {}) {
  const app = discoveryInput(input);
  if (!app.appId || !app.tenantId) fail('Select an enabled app first.');
  const get = async (path, resource, apiVersion) => {
    try { return await requestJson(app.origin, ROOT + path, resource, { ...options, apiVersion }); }
    catch (error) {
      if (error.code === 'ANAPLAN_BROWSER_LOGIN') error.message = 'Sign in to Anaplan in this browser, then refresh the page.';
      throw error;
    }
  };
  const details = `/apps/${app.appId}?includeUnpublished=false&includeReportPages=true`;
  const pages = pageCatalog(await get(details, 'published pages', '2'), app);
  if (!input.pageId) return { pages };
  const page = pages.find(page => page.id === guid(input.pageId));
  if (!page) fail('This published page is not available in the selected app.');
  const route = { boards: 'boards', worksheets: 'grid-pages' }[page.type];
  if (!route) return { pages, unavailableReason: page.type === 'reports'
    ? 'Xanaplan cannot read report pages yet. Choose a board or worksheet for chat.'
    : 'Xanaplan does not recognize this page type. Choose a supported page for chat.' };
  const result = pageDefinition(await get(`/${route}/${page.id}`, 'page definition'), page, app);
  const after = pageCatalog(await get(details, 'published pages', '2'), app);
  if (!after.some(item => item.id === page.id && item.type === page.type)) fail('The page changed during discovery. Refresh page context.');
  return { pages: after, ...result };
}
