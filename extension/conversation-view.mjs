const toolLabels = {
  show_modules: 'Model modules', show_moduledetails: 'Module dimensions', show_lineitems: 'Line items',
  show_savedviews: 'Saved views', show_viewdetails: 'View dimensions', show_lists: 'Model lists',
  get_list_items: 'List items', show_dimensionitems: 'Dimension items', show_viewdimensionitems: 'View members',
  show_lineitem_dimensions: 'Line-item dimensions', show_lineitem_dimensions_items: 'Line-item members',
  lookup_dimensionitems: 'Dimension lookup', show_currentperiod: 'Current period', show_modelcalendar: 'Model calendar',
  show_versions: 'Versions', read_cells: 'Cell data',
};
export function renderConversation(document, { messages, hasApps, app }) {
  const $ = id => document.getElementById(id);
  $('welcome').hidden = messages.length > 0;
  $('first-app').hidden = hasApps;
  $('messages').replaceChildren();
  for (const message of messages) {
    const article = document.createElement('article'); article.className = `message ${message.role}`;
    const role = document.createElement('div'); role.className = 'role'; role.textContent = message.role === 'user' ? 'You' : 'Xanaplan';
    const body = document.createElement('div'); body.className = 'body'; body.textContent = message.text;
    article.append(role, body);
    if (message.sources?.length) {
      const details = document.createElement('details'); details.className = 'sources';
      const summary = document.createElement('summary'); summary.textContent = `${message.sources.length} model source${message.sources.length === 1 ? '' : 's'} · context v${message.revision}`;
      const list = document.createElement('ul');
      for (const source of message.sources) {
        const item = document.createElement('li');
        const scope = Object.entries(source.arguments).filter(([key]) => !['workspaceId', 'modelId'].includes(key)).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join(' · ');
        item.textContent = `[${source.id}] ${source.modelName ? source.modelName + ' · ' : ''}${toolLabels[source.tool] ?? source.tool} · ${new Date(source.readAt).toLocaleTimeString()}${source.partial ? ' · Partial data' : ''}${source.rowLimit ? ` · Up to ${source.rowLimit} rows` : ''}\n${scope}`;
        list.append(item);
      }
      details.append(summary, list); article.append(details);
    }
    $('messages').append(article);
  }
  $('context-note').textContent = app ? `Context v${app.revision} · ${app.tenantName || 'Tenant not linked'}` : 'Set up your first app in Admin.';
}
