import { createHash } from 'node:crypto';
import { AppError, requiredText } from './validation.mjs';
import { metadataReader, metadataTable, viewDimensions } from './page-metadata.mjs';
import { moduleSelections } from './module-evidence.mjs';
import { resolveContextItem } from './page-selections.mjs';
import { checkRestoredContext } from './saved-page-context.mjs';

const bad = message => { throw new AppError(message, 422); };
const array = (value, max) => Array.isArray(value) && value.length <= max ? value : bad('Page context has an invalid collection.');
const id = value => /^\d{1,20}$/.test(String(value)) ? String(value) : bad('Page context has an invalid model object ID.');
const fatal = error => [401, 403, 409, 499, 503].includes(error.status);

export async function verifyPageContext({ app, input, mcp, signal, onProgress = () => {}, savedContext }) {
  if (input.revision !== app.revision) throw new AppError('App context changed. Refresh page context.', 409);
  const definition = input.definition;
  if (!definition || !/^[a-f\d-]{36}$/i.test(definition.page?.id || '')) bad('Select a published page before asking.');
  const page = { id: definition.page.id, name: requiredText(definition.page.name, 'Page name', 2000), type: definition.page.type };
  const models = array(definition.models, 100).map(member => app.models.find(model => model.modelId.toUpperCase() === member.modelId && model.workspaceId.toUpperCase() === member.workspaceId)).filter(Boolean);
  const observation = input.observation || {};
  const mode = savedContext ? 'saved' : input.mode === 'manual' ? 'manual' : 'follow';
  if (mode === 'follow' && observation.pageName && observation.pageName !== page.name) bad('The rendered page does not match its definition. Wait for the page to load.');
  const candidates = input.modelKey ? models.filter(model => model.key === input.modelKey) : observation.modelName && mode === 'follow' ? models.filter(model => model.name === observation.modelName) : definition.models.length === 1 ? models : [];
  if (candidates.length !== 1) bad('Choose the page’s source model. Its active model could not be identified uniquely.');
  const model = candidates[0];
  const metadata = metadataReader(mcp, model, signal);
  let metadataReads = 0;
  const read = (tool, args) => {
    onProgress({ stage: 'verification', message: `Verifying page data · ${++metadataReads} metadata checks` });
    return metadata(tool, args);
  };
  onProgress({ stage: 'verification', message: 'Checking the page’s model access' });
  const hasViewLookup = typeof mcp.tools === 'function' && (await mcp.tools()).some(tool => tool.name === 'show_allviews');
  const modules = metadataTable(await read('show_modules', { limit: 1000 }));
  if (!modules.length || modules.some(module => !module.ID || !module.Name)) bad('The model’s module catalog is unavailable.');
  const options = array(definition.options || [], 100);
  const selections = array(observation.selections || [], 100);
  const selectionContext = { mode, rendered: observation.rendered === true, inheritedModelKey: observation.inheritedModelKey || '', options, selections };
  if (savedContext) selectionContext.savedSources = savedContext.sources.map(source => ({ id: source.id, filters: source.filters.map(({ dimensionId, itemId }) => ({ dimensionId, itemId })), missing: source.savedMissing || source.missing }));
  const warnings = array(definition.warnings || [], 100).map(warning => requiredText(warning, 'Page warning', 2000));
  const sources = [];
  for (const source of array(definition.sources, 40)) {
    const sourceId = requiredText(source.id, 'Source', 150), cardId = requiredText(source.cardId, 'Card', 100);
    const base = { id: sourceId, cardId, name: requiredText(source.name, 'Card name', 2000), moduleIds: [], filters: [], missing: [], warning: source.warning || '', unsupported: source.unsupported === true };
    try {
      base.options = array(source.options || [], 100);
      const queryText = source.query && typeof source.query === 'object' ? JSON.stringify(source.query) : '';
      base.query = queryText.length <= 16000 && queryText ? source.query : null;
      base.queryOmitted = !base.query;
      base.runtimeCustomizable = source.runtimeCustomizable === true;
      let module;
      if (source.kind === 'CLASSIC') {
        const viewId = id(source.sourceId);
        module = modules.find(item => item.ID === viewId);
        if (!module && hasViewLookup) {
          let views;
          try {
            // Reuse a complete catalog across cards. Large catalogs use a
            // bounded exact-ID search before any module-by-module fallback.
            try { views = metadataTable(await read('show_allviews', { limit: 1000 })); }
            catch (error) {
              if (error.status !== 422) throw error;
              views = metadataTable(await read('show_allviews', { search: viewId, limit: 1000 }));
            }
          }
          catch (error) { if (![400, 404, 405, 501, 502].includes(error.status)) throw error; }
          const matches = views?.filter(view => view.ID === viewId) || [];
          if (matches.length > 1) bad('A saved view has ambiguous module membership.');
          if (matches.length === 1) {
            const candidates = modules.filter(candidate => candidate.Name === matches[0].Module);
            if (candidates.length > 1) bad('A saved view has ambiguous module membership.');
            if (candidates.length === 1) {
              const owned = metadataTable(await read('show_savedviews', { moduleId: candidates[0].ID, limit: 1000 }));
              if (owned.some(view => view.ID === viewId)) module = candidates[0];
            }
          }
        }
        if (!module) {
          for (const candidate of modules) {
            const views = metadataTable(await read('show_savedviews', { moduleId: candidate.ID, limit: 1000 }));
            if (views.some(view => view.ID === viewId)) { if (module) bad('A saved view has ambiguous module membership.'); module = candidate; }
          }
        }
        if (!module) bad('The card’s saved view is unavailable in this model.');
        base.viewId = viewId;
      } else {
        for (const moduleId of array(source.moduleIds || [], 30)) {
          const found = modules.find(item => item.ID === id(moduleId));
          if (!found) bad('A card module is unavailable in this model.');
          base.moduleIds.push(found.ID);
        }
        module = /^\d{1,20}$/.test(String(source.sourceId)) ? modules.find(item => item.ID === String(source.sourceId)) : undefined;
        if (source.kind === 'LINE_ITEM') {
          if (!module) bad('The card module is unavailable in this model.');
          const lines = metadataTable(await read('show_lineitems', { moduleId: module.ID, includeAll: true, limit: 1000 }));
          if (!lines.some(line => line.ID === id(source.lineItemId))) bad('The card’s line item is unavailable.');
          base.lineItemId = id(source.lineItemId); base.viewId = module.ID;
        } else {
          base.unsupported = true;
          if (!module && base.moduleIds.length === 1) module = modules.find(item => item.ID === base.moduleIds[0]);
        }
      }
      if (module) {
        base.moduleId = module.ID; base.moduleName = module.Name;
        base.moduleIds = [...new Set([...base.moduleIds, module.ID])];
      }
      base.modules = base.moduleIds.map(moduleId => ({ moduleId, moduleName: modules.find(item => item.ID === moduleId).Name, defaultViewId: moduleId }));
      base.moduleEvidence = base.modules.length > 0;
      if (base.unsupported) {
        const requirements = await moduleSelections({ context: { selectionContext, model }, source: base, read });
        base.filters = requirements.filter(item => item.itemId && !item.issue);
        base.missing = requirements.filter(item => item.issue).map(item => `${item.dimensionName}: ${item.issue}`);
        base.warning = base.moduleEvidence ? 'Module data available. Card filters will be checked for each answer.' : 'The card’s module could not be identified.';
        sources.push(base); continue;
      }
      base.dimensions = viewDimensions(await read('show_viewdetails', { moduleId: module.ID, viewId: base.viewId }), base.viewId);
      if (base.lineItemId) {
        const axis = Object.keys(base.dimensions).find(axis => base.dimensions[axis].some(dimension => dimension.id === '20000000012'));
        if (axis !== 'pages') { base.unsupported = true; base.warning = 'This line-item card needs a cell-coordinate read that MCP does not yet expose.'; }
        else base.filters.push({ dimensionId: '20000000012', dimensionName: 'Line Items', itemId: base.lineItemId, label: base.name, origin: 'card source', axis: 'pages' });
      }
      const dimensions = Object.values(base.dimensions).flat();
      const sourceOptions = array(source.options || [], 100);
      for (const dimension of dimensions) {
        if (base.filters.some(filter => filter.dimensionId === dimension.id)) continue;
        const cardOption = sourceOptions.find(option => option.dimensionId === dimension.id);
        const pageOption = options.find(option => option.dimensionId === dimension.id);
        const cardSelections = selections.filter(item => item.dimensionId === dimension.id && item.cardId === cardId);
        const pageSelections = selections.filter(item => item.dimensionId === dimension.id && item.cardId === '');
        const observed = cardSelections.length ? cardSelections : cardOption?.synced === false ? [] : pageSelections;
        let selection;
        if (mode === 'saved') {
          const saved = savedContext.sources.find(item => item.id === sourceId)?.filters.filter(item => item.dimensionId === dimension.id) || [];
          if (saved.length === 1) selection = { itemId: saved[0].itemId, origin: 'saved selection' };
        } else if (mode === 'follow' && observation.rendered && observed.length === 1 && !observed[0].scope && !observed[0].unresolved) selection = { label: observed[0].label, origin: cardSelections.length ? 'card selection' : 'page selection' };
        else if (mode === 'manual') {
          const inherited = observation.inheritedModelKey === model.key ? selections.filter(item => item.dimensionId === dimension.id && !item.cardId && !item.scope && !item.unresolved) : [];
          if (cardOption?.synced !== false && inherited.length === 1) selection = { label: inherited[0].label, origin: 'inherited from tab' };
          else {
            const option = cardOption?.synced === false ? cardOption : pageOption || cardOption;
            if (option?.itemId && !option.unsupported) selection = { itemId: id(option.itemId), origin: 'page default' };
          }
        }
        if (selection) {
          try {
            const item = await resolveContextItem({ read, dimensionId: dimension.id, ...selection, view: { moduleId: module.ID, viewId: base.viewId, dimensions: base.dimensions } });
            base.filters.push({ dimensionId: dimension.id, dimensionName: dimension.name, ...item, origin: selection.origin, axis: Object.keys(base.dimensions).find(axis => base.dimensions[axis].some(item => item.id === dimension.id)) });
          } catch (error) {
            if (fatal(error)) throw error;
            base.missing.push(`${dimension.name}: ${error.message}`);
          }
        } else if (base.dimensions.pages.some(item => item.id === dimension.id) || cardOption || pageOption || observed.length) base.missing.push(`${dimension.name}: current selection is unknown`);
      }
      if (source.runtimeCustomizable && mode === 'follow') base.unsupported = true;
      if (sourceOptions.some(option => option.unsupported) || options.some(option => option.unsupported)) { base.unsupported = true; base.warning = 'Scoped, multi-select or advanced context filters are not yet supported.'; }
      if (mode === 'follow' && !observation.rendered) base.missing.push('The live page has not finished rendering.');
      if (selections.some(item => item.cardId === '?' || item.scope)) { base.unsupported = true; base.warning = 'A card selector could not be associated with its source.'; }
      sources.push(base);
    } catch (error) {
      if (fatal(error)) throw error;
      sources.push({ ...base, unsupported: true, warning: error.message });
    }
  }
  if (!sources.length || !sources.some(source => source.moduleIds.length)) bad('No page modules could be verified through MCP.');
  if (new Set(sources.map(source => source.id)).size !== sources.length) bad('Duplicate card sources.');
  if (savedContext) checkRestoredContext(savedContext, { sources });
  const context = { page, mode, model: { key: model.key, name: model.name, workspaceName: model.workspaceName }, selectionContext, modelSelection: input.modelKey ? 'chosen for chat' : observation.modelName && mode === 'follow' ? 'observed on tab' : 'only page model', sources, warnings, definitionRevision: definition.definitionRevision || '', observedAt: new Date().toISOString() };
  if (signal?.aborted) throw new AppError('Page verification cancelled.', 499);
  const { observedAt, ...identity } = context;
  context.fingerprint = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return context;
}
