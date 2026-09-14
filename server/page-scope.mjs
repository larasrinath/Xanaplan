import { AppError, requiredText } from './validation.mjs';
import { metadataReader, metadataTable, viewDimensions } from './page-metadata.mjs';
import { readModuleEvidence } from './module-evidence.mjs';
import { resolveContextItem } from './page-selections.mjs';

// Recognize Anaplan qualified references, including quoted names and SUM/LOOKUP
// mappings. Strip double-quoted string literals before recognizing references.
export function formulaReferences(formula, modules, localLines) {
  const text = formula.replace(/"(?:""|[^"\\]|\\.)*"/g, ' ');
  const refs = [], spans = [];
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const module of modules) {
    if (modules.filter(item => item.Name === module.Name).length !== 1) continue;
    const token = `(?:'${escape(module.Name.replace(/'/g, "''"))}'|${escape(module.Name)})`;
    const pattern = new RegExp(`(?<![A-Za-z0-9_'.])${token}\\s*\\.\\s*(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_ ]*))`, 'g');
    for (const match of text.matchAll(pattern)) {
      const lineName = match[1] ? match[1].replace(/''/g, "'") : match[2].split(/\s+(?:THEN|ELSE|AND|OR)\b/)[0].trim();
      refs.push({ moduleId: module.ID, lineName });
      spans.push([match.index, match.index + match[0].length]);
    }
  }
  const localText = [...text].map((character, index) => spans.some(([start, end]) => index >= start && index < end) ? ' ' : character).join('');
  for (const line of localLines) {
    const escaped = line.Name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[^A-Za-z0-9_])(?:'${escaped.replace(/'/g, "''")}'|${escaped})(?=$|[^A-Za-z0-9_])`).test(localText)) refs.push({ lineName: line.Name });
  }
  return refs;
}

export function createPageScope(context, { mcp, model, signal, question }) {
  const read = metadataReader(mcp, model, signal, 60);
  const roots = new Set(context.sources.flatMap(source => source.moduleIds));
  const allowed = new Map([...roots].map(moduleId => [moduleId, { depth: 0, lines: null }]));
  const paths = [];
  const requireModule = moduleId => {
    if (!allowed.has(moduleId)) throw new AppError('This module is outside the page and its verified formula dependencies.', 403);
  };
  const getLines = async moduleId => metadataTable(await read('show_lineitems', { moduleId, includeAll: true, limit: 1000 }));
  const catalog = async () => metadataTable(await read('show_modules', { limit: 1000 }));
  const effective = async (source, moduleId, viewId, overrides) => {
    if (source.unsupported) throw new AppError(source.warning || 'This card’s view cannot be reproduced by MCP.', 422);
    const dimensions = moduleId === source.moduleId && viewId === source.viewId ? source.dimensions : viewDimensions(await read('show_viewdetails', { moduleId, viewId }), viewId);
    const filters = source.filters.filter(filter => Object.values(dimensions).flat().some(dimension => dimension.id === filter.dimensionId)).map(filter => ({ ...filter }));
    if (!Array.isArray(overrides) || overrides.length > 10) throw new AppError('Invalid question context overrides.', 422);
    const used = new Set();
    for (const override of overrides) {
      const dimension = Object.values(dimensions).flat().find(item => item.id === override.dimensionId);
      const itemName = requiredText(override.itemName, 'Requested filter item', 500);
      const quote = requiredText(override.questionQuote, 'Question phrase', 1000);
      if (!dimension || used.has(dimension.id) || !question.toLocaleLowerCase().includes(quote.toLocaleLowerCase()) || !quote.toLocaleLowerCase().includes(itemName.toLocaleLowerCase())) throw new AppError('A context override must match an explicit item in this question. Ask for the period, version or entity by name.', 422);
      used.add(dimension.id);
      const item = await resolveContextItem({ read, dimensionId: dimension.id, label: itemName, view: { moduleId, viewId, dimensions } });
      const filter = { dimensionId: dimension.id, dimensionName: dimension.name, ...item, origin: 'question override' };
      const index = filters.findIndex(item => item.dimensionId === dimension.id);
      if (index < 0) filters.push(filter); else filters[index] = filter;
    }
    if (source.missing.some(message => !Object.values(source.dimensions).flat().some(dimension => used.has(dimension.id) && message.startsWith(`${dimension.name}:`)))) throw new AppError(`Clarify the missing page context: ${source.missing.join('; ')}.`, 422);
    if (filters.some(filter => !dimensions.pages.some(item => item.id === filter.dimensionId))) throw new AppError('A requested selector is on a row or column axis. MCP cannot safely apply it as a page filter yet.', 422);
    const missing = dimensions.pages.filter(dimension => !filters.some(filter => filter.dimensionId === dimension.id));
    if (missing.length) throw new AppError(`Specify ${missing.map(item => item.name).join(', ')} for this source before reading cells.`, 422);
    return filters;
  };
  return {
    async execute(tool, args) {
      if (tool === 'follow_formula') {
        requireModule(args.moduleId);
        const current = allowed.get(args.moduleId);
        if (current.lines && !current.lines.has(args.lineItemId)) throw new AppError('Follow only a line item referenced by the page’s formulas.', 403);
        if (current.depth >= 4) throw new AppError('Formula dependency depth is limited to four levels.', 422);
        const lines = await getLines(args.moduleId), line = lines.find(item => item.ID === args.lineItemId);
        if (!line || line.Formula === undefined || line.Formula.length > 20000) throw new AppError('This line item’s formula is unavailable or too large.', 422);
        const targets = [];
        for (const reference of formulaReferences(line.Formula, await catalog(), lines)) {
          const moduleId = reference.moduleId || args.moduleId;
          const target = (moduleId === args.moduleId ? lines : await getLines(moduleId)).filter(item => item.Name === reference.lineName);
          if (target.length !== 1) continue;
          if (!allowed.has(moduleId)) {
            if (allowed.size >= 25) throw new AppError('Formula dependency module limit reached.', 422);
            allowed.set(moduleId, { depth: current.depth + 1, lines: new Set() });
          }
          allowed.get(moduleId).lines?.add(target[0].ID);
          const path = { fromModuleId: args.moduleId, fromLineItemId: line.ID, moduleId, lineItemId: target[0].ID, name: target[0].Name };
          if (!paths.some(item => JSON.stringify(item) === JSON.stringify(path))) paths.push(path);
          targets.push(path);
        }
        return { text: JSON.stringify({ formula: line.Formula, dependencies: targets, note: 'Only uniquely resolved references are followed; unsupported formula syntax is not inferred.' }), arguments: { moduleId: args.moduleId, lineItemId: args.lineItemId }, dependencyPaths: [...paths] };
      }
      if (tool === 'show_modules') {
        const values = (await catalog()).filter(module => allowed.has(module.ID));
        return { text: JSON.stringify(values), arguments: {}, dependencyPaths: [...paths] };
      }
      if (tool === 'read_module_cells') {
        requireModule(args.moduleId);
        const source = context.sources.find(item => item.id === args.sourceId);
        if (!source?.moduleEvidence) throw new AppError('Choose a verified card module for this read.', 422);
        if (roots.has(args.moduleId) && !source.moduleIds.includes(args.moduleId)) throw new AppError('This module does not belong to the selected card source.', 403);
        return readModuleEvidence({ context, source, args, read, mcp, model, signal, question, dependencyPaths: [...paths] });
      }
      const permitted = new Set(['show_moduledetails', 'show_lineitems', 'show_savedviews', 'show_viewdetails', 'read_cells', 'show_currentperiod', 'show_modelcalendar', 'show_versions']);
      if (!permitted.has(tool)) throw new AppError('Use the page’s scoped modules and context tools.', 403);
      if (['show_currentperiod', 'show_modelcalendar', 'show_versions'].includes(tool)) return null;
      requireModule(args.moduleId);
      if (tool !== 'read_cells') {
        if (tool === 'show_lineitems') args.includeAll = true;
        if (tool === 'show_viewdetails' && args.viewId !== args.moduleId) {
          const views = metadataTable(await read('show_savedviews', { moduleId: args.moduleId, limit: 1000 }));
          if (!views.some(view => view.ID === args.viewId)) throw new AppError('This view is outside the verified module.', 403);
        }
        return null;
      }
      const source = context.sources.find(item => item.id === args.sourceId);
      if (!source || !source.moduleId) throw new AppError('Choose a verified card source for this cell read.', 422);
      if (roots.has(args.moduleId) && (args.moduleId !== source.moduleId || args.viewId !== source.viewId)) throw new AppError('Read this card’s verified view. Do not substitute a module default.', 403);
      if (!roots.has(args.moduleId) && args.viewId !== args.moduleId) throw new AppError('Dependency reads use the verified module default with compatible context.', 403);
      const filters = await effective(source, args.moduleId, args.viewId, args.contextOverrides || []);
      if ('pages' in args || 'exportType' in args || 'exportModuleId' in args) throw new AppError('Cell filters are applied by the helper from verified page context.', 403);
      const clean = { moduleId: args.moduleId, viewId: args.viewId, maxRows: args.maxRows, pages: filters.map(({ dimensionId, itemId }) => ({ dimensionId, itemId })) };
      const result = await mcp.read(tool, clean, model, signal);
      return { ...result, page: context.page, card: source.name, effectiveFilters: filters, dependencyPaths: [...paths], contextFingerprint: context.fingerprint };
    },
  };
}

export function pageTools(tools) {
  const permitted = new Set(['show_modules', 'show_moduledetails', 'show_lineitems', 'show_savedviews', 'show_viewdetails', 'show_currentperiod', 'show_modelcalendar', 'show_versions', 'read_cells']);
  const selected = tools.filter(tool => permitted.has(tool.name)).map(tool => {
    if (tool.name !== 'read_cells') return tool;
    const schema = structuredClone(tool.inputSchema);
    for (const key of ['pages', 'exportType', 'exportModuleId']) delete schema.properties[key];
    schema.properties.sourceId = { type: 'string', description: 'Card source ID from pageContext.sources. Required for page and dependency reads.' };
    schema.properties.contextOverrides = { type: 'array', description: 'Only explicit item names requested in this question. Keep all other defaults.', items: { type: 'object', properties: { dimensionId: { type: 'string' }, itemName: { type: 'string' }, questionQuote: { type: 'string' } }, required: ['dimensionId', 'itemName', 'questionQuote'], additionalProperties: false } };
    schema.required = [...(schema.required || []).filter(key => key !== 'pages'), 'sourceId'];
    return { ...tool, inputSchema: schema };
  });
  selected.push({ name: 'follow_formula', description: 'Trace a relevant line item formula into verified referenced modules. Up to four levels; follow only the returned referenced line items.', inputSchema: { type: 'object', properties: { moduleId: { type: 'string' }, lineItemId: { type: 'string' } }, required: ['moduleId', 'lineItemId'] } });
  const cells = selected.find(tool => tool.name === 'read_cells');
  if (cells) {
    const schema = structuredClone(cells.inputSchema);
    schema.required = [...new Set([...schema.required.filter(key => key !== 'viewId'), 'moduleId', 'sourceId'])];
    schema.properties.viewId.description = 'A verified saved view of this module, or omit to use its default. This is module evidence, not the exact custom card.';
    schema.properties.lineItemId = { type: 'string', description: 'Optional verified line item ID when Line Items is a page dimension of the chosen view.' };
    selected.push({ name: 'read_module_cells', description: 'Investigate data in a verified card module or formula dependency, including custom cards. Inspect line items and query metadata first. Applies known page-axis selectors; returns other selectors as pendingFilters that must be resolved from evidence. Does not reproduce the card or establish its totals automatically.', inputSchema: schema });
  }
  return selected;
}
