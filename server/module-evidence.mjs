import { AppError, requiredText } from './validation.mjs';
import { metadataTable, viewDimensions } from './page-metadata.mjs';
import { resolveContextItem } from './page-selections.mjs';

const objectId = value => /^\d{1,20}$/.test(String(value));
const fatal = error => [401, 403, 409, 499, 503].includes(error.status);

// Keep selections even when they are not axes of the module default. For example,
// Country may constrain Stores through a line item instead of a Country axis.
export async function moduleSelections({ context, source, dimensions, viewId, moduleId = source.moduleId, read, overrides = [], question = '' }) {
  const view = moduleId ? { moduleId, viewId: viewId || moduleId, ...(dimensions ? { dimensions } : {}) } : undefined;
  dimensions ||= { rows: [], columns: [], pages: [] };
  const { mode, rendered, inheritedModelKey, selections, options } = context.selectionContext;
  const ownOptions = source.options || [];
  const observed = selections.filter(item => item.cardId === '' || item.cardId === source.cardId);
  const axes = Object.values(dimensions).flat();
  const savedFilters = mode === 'saved' ? context.selectionContext.savedSources?.find(item => item.id === source.id)?.filters || [] : [];
  const ids = new Set([...axes.map(item => item.id), ...options.map(item => item.dimensionId), ...ownOptions.map(item => item.dimensionId), ...observed.map(item => item.dimensionId), ...savedFilters.map(item => item.dimensionId)]);
  const requirements = [];
  for (const dimensionId of ids) {
    if (!objectId(dimensionId)) continue;
    const own = ownOptions.find(item => item.dimensionId === dimensionId), page = options.find(item => item.dimensionId === dimensionId);
    const card = observed.filter(item => item.dimensionId === dimensionId && item.cardId === source.cardId);
    const shared = observed.filter(item => item.dimensionId === dimensionId && item.cardId === '');
    const active = card.length ? card : own?.synced === false ? [] : shared;
    const dimensionName = axes.find(item => item.id === dimensionId)?.name || own?.dimensionName || page?.dimensionName || `Selection ${dimensionId}`;
    const requirement = { dimensionId, dimensionName };
    let selection;
    if (mode === 'saved') {
      const saved = savedFilters.filter(item => item.dimensionId === dimensionId);
      if (saved.length === 1) selection = { itemId: saved[0].itemId, origin: 'saved selection' };
    } else if (mode === 'follow' && rendered && active.length === 1 && !active[0].scope && !active[0].unresolved) selection = { label: active[0].label, origin: card.length ? 'card selection' : 'page selection' };
    else if (mode === 'manual') {
      if (inheritedModelKey === context.model.key && own?.synced !== false && shared.length === 1 && !shared[0].scope && !shared[0].unresolved) selection = { label: shared[0].label, origin: 'inherited from tab' };
      else {
        const option = own?.synced === false ? own : page || own;
        if (option?.itemId && !option.unsupported) selection = { itemId: option.itemId, origin: 'page default' };
      }
    }
    const fixedLineItem = dimensionId === '20000000012' && own?.scope === moduleId && own?.synced === false && own?.visible === false && own?.advanced === false && objectId(own.itemId) && !active.length && (mode !== 'saved' || savedFilters.some(item => item.dimensionId === dimensionId && item.itemId === own.itemId));
    if (fixedLineItem) selection = { itemId: own.itemId, origin: 'card default' };
    if (dimensionId === '20000000012' && source.lineItemId && moduleId === source.moduleId) selection = { itemId: source.lineItemId, origin: 'card source' };
    if (!selection && !own && !page && !active.length && !dimensions.pages.some(item => item.id === dimensionId)) continue;
    if (selection) {
      try {
        let item;
        if (fixedLineItem) {
          const lines = metadataTable(await read('show_lineitems', { moduleId, includeAll: true, limit: 1000 }));
          const matches = lines.filter(line => line.ID === selection.itemId);
          if (matches.length !== 1 || !matches[0].Name) throw new AppError('The fixed card line item is unavailable in its module.', 422);
          item = { itemId: matches[0].ID, label: matches[0].Name, resolvedBy: 'module line items' };
        } else item = await resolveContextItem({ read, dimensionId, ...selection, view });
        Object.assign(requirement, item, { origin: selection.origin });
      } catch (error) {
        if (fatal(error)) throw error;
        Object.assign(requirement, { label: selection.label, issue: error.message });
      }
    } else requirement.issue = 'Current selection is unknown.';
    if ((own?.unsupported && !fixedLineItem) || (own?.synced !== false && page?.unsupported) || active.some(item => item.scope)) requirement.issue = 'Advanced or scoped selection requires verification.';
    requirements.push(requirement);
  }
  if (!Array.isArray(overrides) || overrides.length > 10) throw new AppError('Invalid question context overrides.', 422);
  const used = new Set();
  for (const override of overrides) {
    const name = requiredText(override.itemName, 'Requested filter item', 500), quote = requiredText(override.questionQuote, 'Question phrase', 1000);
    if (!ids.has(override.dimensionId) || used.has(override.dimensionId) || !question.toLocaleLowerCase().includes(quote.toLocaleLowerCase()) || !quote.toLocaleLowerCase().includes(name.toLocaleLowerCase())) throw new AppError('A context override must match an explicit item in this question.', 422);
    used.add(override.dimensionId);
    const item = await resolveContextItem({ read, dimensionId: override.dimensionId, label: name, view });
    const index = requirements.findIndex(item => item.dimensionId === override.dimensionId);
    const replacement = { dimensionId: override.dimensionId, dimensionName: requirements[index]?.dimensionName || axes.find(item => item.id === override.dimensionId)?.name || `Selection ${override.dimensionId}`, ...item, origin: 'question override' };
    if (index < 0) requirements.push(replacement); else requirements[index] = replacement;
  }
  return requirements;
}

export async function readModuleEvidence({ context, source, args, read, mcp, model, signal, question, dependencyPaths }) {
  if (['pages', 'exportType', 'exportModuleId'].some(key => key in args)) throw new AppError('Cell filters are applied by the helper from verified page context.', 403);
  const viewId = args.viewId || args.moduleId;
  if (viewId !== args.moduleId) {
    const views = metadataTable(await read('show_savedviews', { moduleId: args.moduleId, limit: 1000 }));
    if (!views.some(view => view.ID === viewId)) throw new AppError('This view is outside the verified module.', 403);
  }
  const dimensions = viewDimensions(await read('show_viewdetails', { moduleId: args.moduleId, viewId }), viewId);
  const requirements = await moduleSelections({ context, source, dimensions, moduleId: args.moduleId, viewId, read, overrides: args.contextOverrides, question });
  if (args.lineItemId) {
    const lines = metadataTable(await read('show_lineitems', { moduleId: args.moduleId, includeAll: true, limit: 1000 }));
    const line = lines.find(item => item.ID === args.lineItemId);
    if (!line || !dimensions.pages.some(item => item.id === '20000000012')) throw new AppError('This line item cannot be selected on the view’s page axis.', 422);
    const index = requirements.findIndex(item => item.dimensionId === '20000000012');
    const selection = { dimensionId: '20000000012', dimensionName: 'Line Items', itemId: line.ID, label: line.Name, origin: 'requested line item' };
    if (index < 0) requirements.push(selection); else requirements[index] = selection;
  }
  const pageIds = new Set(dimensions.pages.map(item => item.id));
  const effectiveFilters = requirements.filter(item => pageIds.has(item.dimensionId) && item.itemId && !item.issue);
  const missing = dimensions.pages.filter(item => !effectiveFilters.some(filter => filter.dimensionId === item.id));
  if (missing.length) throw new AppError(`Specify ${missing.map(item => item.name).join(', ')} for this module view before reading cells.`, 422);
  const pendingFilters = requirements.filter(item => !pageIds.has(item.dimensionId));
  const savedMissing = (source.savedMissing || []).filter(message => !requirements.some(item => {
    if (item.origin !== 'question override' || item.issue) return false;
    const names = [item.dimensionName, `Selection ${item.dimensionId}`, ...Object.values(dimensions).flat().filter(dimension => dimension.id === item.dimensionId).map(dimension => dimension.name)];
    return names.some(name => name && message.startsWith(`${name}:`));
  }));
  const maxRows = Math.min(1000, Math.max(1, Math.floor(Number(args.maxRows) || 1000)));
  const result = await mcp.read('read_cells', { moduleId: args.moduleId, viewId, maxRows, pages: effectiveFilters.map(({ dimensionId, itemId }) => ({ dimensionId, itemId })) }, model, signal);
  let partial = /_truncated|more not shown/i.test(result.text);
  try {
    const data = JSON.parse(result.text);
    const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.data) ? data.data : null;
    partial ||= data.hasMore === true || data.truncated === true || Boolean(rows && (rows.length >= maxRows || Number(data.totalRows) > rows.length));
  } catch { /* Unknown response shapes still require coverage verification. */ }
  return { ...result, partial, page: context.page, card: source.name, effectiveFilters, pendingFilters, dependencyPaths, contextFingerprint: context.fingerprint,
    coverage: { kind: 'module evidence', exactCard: false,
      partial,
      note: 'The helper applied only effectiveFilters. Verify card membership and all pendingFilters against query metadata, line items, formulas and returned data before answering about this card. Module rows are not automatically card rows. Verify complete coverage and distinct leaf records before counting; a row cap or truncated response cannot establish a total.',
      unresolvedContext: [...new Set([...requirements.filter(item => item.issue).map(item => `${item.dimensionName}: ${item.issue}`), ...savedMissing, ...(context.selectionContext.mode === 'follow' && !context.selectionContext.rendered ? ['Live page selections could not be observed.'] : []), ...(context.selectionContext.selections.some(item => item.cardId === '?') ? ['A live selector could not be associated with its card.'] : [])])],
    },
  };
}
