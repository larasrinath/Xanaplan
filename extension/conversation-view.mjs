const toolLabels = {
  show_modules: 'Model modules', show_moduledetails: 'Module dimensions', show_lineitems: 'Line items',
  show_savedviews: 'Saved views', show_viewdetails: 'View dimensions', show_lists: 'Model lists',
  get_list_items: 'List items', show_dimensionitems: 'Dimension items', show_viewdimensionitems: 'View members',
  show_lineitem_dimensions: 'Line-item dimensions', show_lineitem_dimensions_items: 'Line-item members',
  lookup_dimensionitems: 'Dimension lookup', show_currentperiod: 'Current period', show_modelcalendar: 'Model calendar',
  show_versions: 'Versions', read_cells: 'Cell data', read_module_cells: 'Underlying module data',
  follow_formula: 'Formula dependencies',
};
export function renderConversation(document, { messages, hasApps }) {
  const $ = id => document.getElementById(id);
  $('welcome').hidden = messages.length > 0;
  $('first-app').hidden = hasApps;
  $('messages').replaceChildren();
  for (const message of messages) {
    const article = document.createElement('article'); article.className = `message ${message.role}`;
    const role = document.createElement('div'); role.className = 'role'; role.textContent = message.role === 'user' ? 'You' : 'Xanaplan';
    const body = document.createElement('div'); body.className = 'body'; body.textContent = message.text;
    article.append(role, body);
    if (message.pageContext) {
      const context = document.createElement('p'); context.className = 'answer-context';
      context.textContent = `${message.pageContext.page.name} · ${message.pageContext.model.name} · ${message.pageContext.mode === 'manual' ? 'Chosen for chat' : 'Tab context'}`;
      article.append(context);
    }
    if (message.sources?.length) {
      const details = document.createElement('details'); details.className = 'sources';
      const summary = document.createElement('summary'); summary.textContent = `${message.sources.length} model source${message.sources.length === 1 ? '' : 's'} · context v${message.revision}`;
      const list = document.createElement('ul');
      for (const source of message.sources) {
        const item = document.createElement('li');
        const scope = Object.entries(source.arguments).filter(([key]) => !['workspaceId', 'modelId'].includes(key)).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join(' · ');
        item.textContent = `[${source.id}] ${source.modelName ? source.modelName + ' · ' : ''}${toolLabels[source.tool] ?? source.tool} · ${new Date(source.readAt).toLocaleTimeString()}${source.partial ? ' · Partial data' : ''}${source.rowLimit ? ` · Up to ${source.rowLimit} rows` : ''}\n${scope}`;
        if (source.card) item.textContent += `\n${source.page.name} · ${source.card}`;
        if (source.effectiveFilters?.length) item.textContent += `\n${source.effectiveFilters.map(filter => `${filter.dimensionName}: ${filter.label} (${filter.origin})`).join(' · ')}`;
        if (source.coverage?.kind === 'module evidence') item.textContent += '\nUnderlying module evidence; card membership requires verification.';
        if (source.pendingFilters?.length) item.textContent += `\nContext to evaluate in the data: ${source.pendingFilters.map(filter => `${filter.dimensionName}: ${filter.label || filter.issue || 'unknown'}`).join(' · ')}`;
        list.append(item);
      }
      details.append(summary, list); article.append(details);
    }
    $('messages').append(article);
  }
}
