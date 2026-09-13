import { discoverApps, appOrigin, clearDiscoveryCache } from './app-discovery.mjs';
import { safeSignInUrl, openAnaplanSignIn } from './anaplan-auth.mjs';
import { createSearchableSelect, matchesSearch } from './searchable-select.mjs';

const $ = id => document.getElementById(id);
let connection = null;
let apps = [], selectedKey = '', editing = null, busy = false, controller = null, loadSequence = 0;
let connectionStatus = null;
let anaplanSettings = null, anaplanDirty = false, connectionSaving = false;
let anaplanBusy = false, anaplanState = 'idle', anaplanMessage = '', accessRequest = null;
let llmSettings = null, llmDirty = false, llmEditRevision = null, llmBusy = false;
let llmActivity = '';
const providerNames = { openai: 'OpenAI', claude: 'Claude' };
const llmDrafts = { openai: '', claude: '' };
let draftProvider = 'claude';
const conversations = new Map();
const contextDrafts = new Map();
let draftSelection = '';
let tenantCatalog = [], appCatalog = [], appDiscovery = null, discoveryController = null, discoveryBusy = false, savingApp = false;
let appCatalogReady = false;
let discoveryOrigin = 'https://us1a.app.anaplan.com';
let accessDiscoverySequence = null;
let connectedModels = [];
const connectedModelKeys = () => connectedModels.map(model => model.key);
const appPicker = createSearchableSelect({
  root: $('app-picker'), select: $('available-app'), trigger: $('app-picker-trigger'), menu: $('app-picker-menu'),
  input: $('app-search'), clear: $('clear-app-search'), list: $('app-picker-options'), status: $('app-search-status'),
});
function discoveryStatus(text, error = false) {
  $('app-discovery-status').textContent = text; $('app-discovery-status').dataset.error = String(error);
  $('app-discovery-status').parentElement.hidden = !text && $('discovery-spinner').hidden;
}
function cacheNote(result, kind) {
  const cached = result.cache;
  const updated = cached?.cachedAt ? new Date(cached.cachedAt).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  if (cached?.stored === false) return `Loaded ${kind}, but this browser could not save the list.`;
  if (cached?.refreshFailed) return `Could not refresh ${kind}. Showing the list saved ${updated}.`;
  return '';
}
function renderAppSearchControls() {
  appPicker.sync({ disabled: savingApp || !appCatalogReady || Boolean(editing) });
}
function resetAppSearch({ keepQuery = false } = {}) {
  appCatalogReady = false;
  appPicker.reset({ keepQuery });
  renderAppSearchControls();
}
function filterAvailableApps() {
  if (!appCatalogReady || editing) return;
  $('available-app').disabled = savingApp || !appCatalog.length;
  renderAppSearchControls();
}
function renderAppSave() {
  const loading = discoveryBusy || (anaplanBusy && accessDiscoverySequence === loadSequence);
  $('discovery-spinner').hidden = !loading;
  $('discovery-spinner').parentElement.hidden = !loading && !$('app-discovery-status').textContent;
  $('tenant').setAttribute('aria-busy', String(loading));
  $('available-app').setAttribute('aria-busy', String(loading));
  $('save-app').disabled = savingApp || discoveryBusy || !(editing || appDiscovery?.ticket) || !connectedModels.length;
  $('save-app').textContent = savingApp ? 'Saving…' : editing ? 'Save context' : 'Save & enable';
  $('cancel-discovery').hidden = !loading;
  $('add-app').disabled = savingApp || anaplanBusy;
  $('refresh-discovery').hidden = !editing && anaplanState !== 'connected';
  $('refresh-discovery').disabled = loading || savingApp || anaplanBusy;
  $('refresh-discovery').title = editing && $('tenant').value ? 'Refresh connected models' : 'Refresh tenants, apps and connected models';
  for (const id of ['tenant', 'available-app', 'refresh-discovery', 'add-app', 'close-editor', 'context', 'context-file', 'import-context']) {
    if (savingApp) $(id).disabled = true;
  }
  renderAppSearchControls();
  updateComposer();
}
function cancelDiscovery() { ++loadSequence; discoveryController?.abort(); discoveryController = null; discoveryBusy = false; renderAppSave(); }
function renderConnectedModels(connected) {
  connectedModels = [...connected];
  $('connected-models-section').hidden = !connected.length;
  $('connected-models').replaceChildren();
  for (const model of connected) {
    const item = document.createElement('li'); item.className = 'connected-model';
    const name = document.createElement('strong'), workspace = document.createElement('small');
    name.textContent = model.name; workspace.textContent = model.workspaceName; item.append(name, workspace); $('connected-models').append(item);
  }
  renderAppSave();
}

function notice(message, error = false) {
  $('notice').textContent = message; $('notice').dataset.error = String(error); $('notice').hidden = !message;
}
function showError(error) {
  if (error.name === 'AbortError') return;
  if (error.code === 'ANAPLAN_LOGIN') {
    clearDiscoveryCache();
    anaplanState = 'login'; anaplanMessage = 'Sign-in required';
    view('admin'); $('connection-settings').open = true;
    $('auth').hidden = false;
    const url = safeSignInUrl(error.url);
    $('auth-detail').textContent = error.userCode ? `Sign-in code: ${error.userCode}` : '';
    $('auth-link').hidden = !url;
    if (url) $('auth-link').href = url; else $('auth-link').removeAttribute('href');
    $('auth-progress').textContent = url ? 'After signing in, select Check connection.' : 'No sign-in link received. Check connection to retry.';
    notice(''); renderAnaplan();
    $('anaplan-connection').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('anaplan-connection').focus({ preventScroll: true });
  } else notice(error.message, true);
}
async function api(path, { method = 'GET', body, signal } = {}) {
  if (!connection) throw new Error('Start the local helper with npm start, then reload this extension in Chrome.');
  let response;
  try {
    response = await fetch(connection.baseUrl + path, {
      method, signal: signal ?? AbortSignal.timeout(70000),
      headers: { Authorization: `Bearer ${connection.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    throw new Error('Cannot reach the local helper. Run npm start in the Xanaplan folder, then select Check.');
  }
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error ?? 'Request failed.'), data);
  return data;
}
function on(id, event, handler) {
  $(id).addEventListener(event, async e => { try { await handler(e); } catch (error) { showError(error); } });
}
function view(name) {
  if (name !== 'admin') appPicker.close();
  $('assistant-view').hidden = name !== 'assistant'; $('admin-view').hidden = name !== 'admin';
  $('assistant-tab').setAttribute('aria-pressed', String(name === 'assistant'));
  $('admin-tab').setAttribute('aria-pressed', String(name === 'admin'));
}
function options(element, items, prompt) {
  element.replaceChildren(new Option(prompt, ''));
  for (const item of items) element.add(new Option(item.name, item.id));
}
function currentApp() { return apps.find(app => app.key === selectedKey); }
function currentThread() {
  const app = currentApp();
  if (!app) return [];
  const key = `${app.key}:${app.revision}:ai-${llmSettings?.revision ?? 0}`;
  if (!conversations.has(key)) conversations.set(key, []);
  return conversations.get(key);
}
function updateComposer() {
  $('send').disabled = busy || savingApp || llmBusy || !currentApp() || !connectionStatus?.provider?.loggedIn;
  $('question').disabled = busy || savingApp || !currentApp();
  $('chat-app').disabled = busy || savingApp;
  $('cancel-question').hidden = !busy;
  $('question-status').textContent = savingApp ? 'Saving app context…' : busy ? 'Reading your app and preparing an answer…' : !currentApp() ? 'Enable an app in Admin to begin.' : !connectionStatus?.provider?.loggedIn ? 'Connect the AI provider in Admin to ask questions.' : llmBusy ? 'Checking AI settings…' : 'Answers use your selected app.';
  $('active-ai').textContent = llmSettings ? `${providerNames[llmSettings.provider]} · ${llmSettings.model || 'Provider default'} · Managed in Admin` : 'AI is managed in Admin.';
}
function renderConnectionDot(id, state, description) {
  const dot = $(id);
  dot.dataset.state = state; dot.title = description; dot.setAttribute('aria-label', description);
}
function renderLlm() {
  const provider = $('llm-provider').value;
  const status = connectionStatus?.connections?.[provider];
  const runtime = provider === 'openai' ? 'Codex' : 'Claude Code';
  $('llm-runtime').textContent = `${providerNames[provider]} account`;
  $('llm-login').textContent = provider === 'openai' ? 'codex login' : 'claude auth login';
  $('llm-status').textContent = !status ? 'Waiting for the local helper' : status.loggedIn ? `Signed in · ${status.method}` : status.installed ? 'Sign-in needed' : `${runtime} is not available to the helper`;
  $('llm-login-help').hidden = !status?.installed || status.loggedIn;
  $('llm-active').textContent = llmDirty ? 'Unsaved changes' : '';
  $('llm-active').hidden = !llmDirty;
  $('reload-llm').hidden = !llmDirty;
  const savedProvider = llmSettings?.provider;
  const savedStatus = connectionStatus?.connections?.[savedProvider];
  renderConnectionDot('ai-connection-dot', !savedStatus ? 'unknown' : savedStatus.loggedIn ? 'connected' : 'attention',
    !savedStatus ? 'AI sign-in status unavailable · check the local helper' : `${providerNames[savedProvider]}: ${savedStatus.loggedIn ? 'signed in' : savedStatus.installed ? 'sign-in needed' : 'local connection unavailable'}`);
  for (const id of ['llm-provider', 'llm-model', 'test-llm', 'save-llm', 'reload-llm']) $(id).disabled = !llmSettings || llmBusy || busy;
  $('save-llm').disabled ||= !llmDirty;
  $('test-llm').textContent = llmActivity === 'check' ? 'Checking…' : 'Check connection';
  $('save-llm').textContent = llmActivity === 'save' ? 'Saving…' : 'Save settings';
  updateComposer();
}
function applyLlm(settings, force = false) {
  llmSettings = settings;
  if (!llmDirty || force) {
    llmDirty = false; llmEditRevision = settings.revision;
    Object.assign(llmDrafts, settings.models);
    draftProvider = settings.provider; $('llm-provider').value = settings.provider; $('llm-model').value = settings.model;
  }
  renderLlm(); renderMessages();
}
const toolLabels = {
  show_modules: 'Model modules', show_moduledetails: 'Module dimensions', show_lineitems: 'Line items',
  show_savedviews: 'Saved views', show_viewdetails: 'View dimensions', show_lists: 'Model lists',
  get_list_items: 'List items', show_dimensionitems: 'Dimension items', show_viewdimensionitems: 'View members',
  show_lineitem_dimensions: 'Line-item dimensions', show_lineitem_dimensions_items: 'Line-item members',
  lookup_dimensionitems: 'Dimension lookup', show_currentperiod: 'Current period', show_modelcalendar: 'Model calendar',
  show_versions: 'Versions', read_cells: 'Cell data',
};
function renderMessages() {
  const messages = currentThread();
  $('welcome').hidden = messages.length > 0;
  $('first-app').hidden = apps.length > 0;
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
  const app = currentApp();
  $('context-note').textContent = app ? `Context v${app.revision} · ${app.tenantName || 'Tenant not linked'}` : 'Set up your first app in Admin.';
  updateComposer();
}
function renderApps() {
  options($('chat-app'), apps.map(app => ({ id: app.key, name: app.name })), apps.length ? 'Select an app' : 'No enabled apps');
  if (!apps.some(app => app.key === selectedKey)) selectedKey = apps[0]?.key ?? '';
  $('chat-app').value = selectedKey;
  renderEnabledApps();
  renderMessages();
}
function renderEnabledApps() {
  const query = $('enabled-app-search').value;
  const matches = apps.filter(app => matchesSearch(`${app.name} ${app.tenantName ?? ''}`, query));
  $('enabled-app-search-section').hidden = !apps.length;
  $('clear-enabled-app-search').hidden = !query;
  $('enabled-app-search-status').textContent = query.trim() ? `${matches.length} of ${apps.length} apps` : '';
  $('enabled-apps').replaceChildren();
  if (!apps.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    const heading = document.createElement('strong'); heading.textContent = 'Your first app starts here';
    const text = document.createElement('p'); text.textContent = 'Connect to Anaplan, choose an app, and add the context that makes its numbers meaningful.';
    empty.append(heading, text); $('enabled-apps').append(empty);
  }
  if (apps.length && !matches.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No matching apps.';
    $('enabled-apps').append(empty);
  }
  for (const app of matches) {
    const card = document.createElement('article'); card.className = 'card model-item';
    const title = document.createElement('h2'); title.textContent = app.name;
    const workspace = document.createElement('p'); workspace.className = 'workspace-name'; workspace.textContent = `${app.tenantName || 'Tenant not linked'} · ${app.models.length} connected model${app.models.length === 1 ? '' : 's'}`;
    const excerpt = document.createElement('p'); excerpt.className = 'excerpt'; excerpt.textContent = app.context;
    const footer = document.createElement('div'); footer.className = 'item-footer';
    const saved = document.createElement('span'); saved.textContent = `v${app.revision} · ${new Date(app.savedAt).toLocaleDateString()}`;
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit'; edit.addEventListener('click', () => editApp(app));
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      if (!confirm(`Remove ${app.name} from this assistant? Its saved local context will be removed. The Anaplan app is unchanged.`)) return;
      try { await api(`/apps/${encodeURIComponent(app.key)}`, { method: 'DELETE', body: { revision: app.revision } }); if (editing?.key === app.key) { cancelDiscovery(); editing = null; $('app-editor').hidden = true; } await loadApps(); notice('App removed from this assistant.'); } catch (error) { showError(error); }
    });
    footer.append(saved, edit, remove); card.append(title, workspace, excerpt, footer); $('enabled-apps').append(card);
  }
}
async function loadApps() { const result = await api('/apps'); apps = result.apps; renderApps(); $('legacy-context-note').hidden = !result.legacyModelCount; }
function countContext() { $('context-count').textContent = $('context').value.length ? `${$('context').value.length.toLocaleString()} / 60,000` : ''; }
function editApp(app) {
  cancelDiscovery(); editing = app; appDiscovery = null;
  resetAppSearch();
  $('app-editor').hidden = false; $('editor-title').textContent = 'Edit app context';
  options($('tenant'), app.tenantId ? [{ id: app.tenantId, name: app.tenantName }] : [], app.tenantId ? 'Tenant' : 'Tenant not linked'); $('tenant').value = app.tenantId ?? ''; $('tenant').disabled = true;
  options($('available-app'), [{ id: app.appId, name: app.name }], 'App'); $('available-app').value = app.appId; $('available-app').disabled = true;
  $('context').value = app.context; $('context-file').value = ''; $('catalog-note').hidden = true;
  renderConnectedModels(app.models);
  discoveryStatus(app.tenantId ? '' : 'Select Refresh to link this saved app.'); countContext(); $('app-editor').scrollIntoView({ behavior: 'smooth' });
}
function checkAnaplanAccess({ openSignIn = false } = {}) {
  if (accessRequest) return accessRequest;
  accessRequest = verifyAnaplanAccess(openSignIn).finally(() => { accessRequest = null; });
  return accessRequest;
}
async function verifyAnaplanAccess(openSignIn) {
  const sequence = loadSequence;
  let connected = false;
  accessDiscoverySequence = !$('app-editor').hidden && !editing ? sequence : null;
  anaplanBusy = true; anaplanState = 'connecting'; anaplanMessage = 'Checking access…';
  renderConnection(); renderAnaplan(); renderAppSave(); notice('');
  if (!$('auth').hidden) $('auth-progress').textContent = '';
  try {
    await api('/workspaces'); // Authentication check only; workspace resolution stays behind the scenes.
    $('auth').hidden = true; anaplanState = 'connected';
    anaplanMessage = 'Connected';
    connected = true;
  } catch (error) {
    if (sequence === loadSequence && !$('app-editor').hidden && !editing) discoveryStatus(error.code === 'ANAPLAN_LOGIN' ? 'Complete sign-in in Anaplan access.' : error.message, true);
    if (error.code === 'ANAPLAN_LOGIN') {
      showError(error);
      if (openSignIn && safeSignInUrl(error.url)) {
        const opened = await openAnaplanSignIn(error.url);
        $('auth-progress').textContent = opened ? 'Sign-in opened. Return here and select Check connection.' : 'Use the sign-in link, then select Check connection.';
      }
    } else {
      anaplanState = 'error'; anaplanMessage = `Could not connect. ${error.message}`;
      if (!$('auth').hidden) $('auth-progress').textContent = anaplanMessage;
      view('admin'); $('connection-settings').open = true;
      $('anaplan-status').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } finally { anaplanBusy = false; accessDiscoverySequence = null; renderConnection(); renderAnaplan(); renderAppSave(); }
  // Authentication is finished. Discovery has its own progress, cancellation
  // and errors and must not keep the connection card or OAuth check pending.
  if (connected && sequence === loadSequence && !$('app-editor').hidden && !editing) {
    void loadTenants().catch(error => discoveryStatus(error.message, true));
  }
}
async function addApp() {
  cancelDiscovery(); draftSelection = ''; contextDrafts.clear(); editing = null; appDiscovery = null;
  resetAppSearch();
  $('app-form').reset(); $('app-editor').hidden = false; $('editor-title').textContent = 'Enable an app';
  $('tenant').disabled = true; options($('tenant'), [], 'Connect to load tenants'); options($('available-app'), [], 'Select a tenant first'); $('available-app').disabled = true;
  renderConnectedModels([]); $('catalog-note').hidden = true; discoveryStatus('Checking Anaplan access…');
  countContext(); $('app-editor').scrollIntoView({ behavior: 'smooth' });
  await checkAnaplanAccess();
}
async function loadTenants({ refresh = false, preserveSelection = false } = {}) {
  const tenantId = preserveSelection ? $('tenant').value : '';
  const selectedAppId = preserveSelection ? $('available-app').value : '';
  let loaded = false, warning = '';
  cancelDiscovery(); const sequence = loadSequence;
  resetAppSearch({ keepQuery: preserveSelection });
  appDiscovery = null; tenantCatalog = []; appCatalog = []; renderConnectedModels([]);
  options($('tenant'), [], 'Loading tenants…'); $('tenant').disabled = true;
  options($('available-app'), [], 'Select a tenant first'); $('available-app').disabled = true;
  $('catalog-note').hidden = true;
  discoveryBusy = true; discoveryController = new AbortController(); renderAppSave(); discoveryStatus('Loading your Anaplan tenants…');
  try {
    const result = await discoverApps({ origin: editing?.origin ?? discoveryOrigin, signal: discoveryController.signal, refresh });
    if (sequence !== loadSequence) return;
    tenantCatalog = result.items;
    options($('tenant'), tenantCatalog, 'Select a tenant'); $('tenant').disabled = false;
    loaded = true;
    if (tenantCatalog.some(tenant => tenant.id === tenantId)) $('tenant').value = tenantId;
    warning = cacheNote(result, 'tenants');
    discoveryStatus(warning, Boolean(warning));
  } catch (error) { if (sequence === loadSequence) { options($('tenant'), [], 'Tenants could not be loaded'); discoveryStatus(error.message, true); } }
  finally { if (sequence === loadSequence) { discoveryBusy = false; discoveryController = null; renderAppSave(); } }
  if (!loaded || sequence !== loadSequence || !tenantId) return;
  if ($('tenant').value === tenantId) await loadAvailableApps({ refresh, selectedAppId, priorWarning: warning });
  else discoveryStatus([warning, 'The selected tenant is no longer available. Choose another tenant.'].filter(Boolean).join(' '), true);
}
async function loadAvailableApps({ refresh = false, selectedAppId = '', priorWarning = '' } = {}) {
  cancelDiscovery(); const tenantId = $('tenant').value, sequence = loadSequence;
  resetAppSearch({ keepQuery: refresh });
  appDiscovery = null; renderConnectedModels([]); appCatalog = [];
  options($('available-app'), [], tenantId ? 'Loading apps…' : 'Select a tenant first'); $('available-app').disabled = true;
  $('catalog-note').hidden = true; discoveryStatus('');
  if (!tenantId) return;
  discoveryBusy = true; discoveryController = new AbortController(); renderAppSave(); discoveryStatus('Loading apps for this tenant…');
  try {
    const result = await discoverApps({ origin: editing?.origin ?? discoveryOrigin, tenantId, signal: discoveryController.signal, refresh });
    if (sequence !== loadSequence) return;
    appCatalog = result.items.sort((a, b) => a.name.localeCompare(b.name));
    if (editing && !editing.tenantId) {
      const match = appCatalog.find(app => app.id === editing.appId);
      if (!match) throw new Error('The earlier app is not in this tenant. Choose another tenant.');
      options($('available-app'), [match], 'App'); $('available-app').value = match.id;
    } else options($('available-app'), appCatalog, appCatalog.length ? 'Select an app' : 'No apps in this tenant');
    const selectionMissing = selectedAppId && !appCatalog.some(app => app.id === selectedAppId);
    if (selectedAppId && !selectionMissing) $('available-app').value = selectedAppId;
    appCatalogReady = true; filterAvailableApps();
    $('catalog-note').textContent = [priorWarning, cacheNote(result, 'apps'), selectionMissing ? 'The selected app is no longer available. Choose another app.' : ''].filter(Boolean).join(' ');
    $('catalog-note').hidden = !$('catalog-note').textContent;
    $('catalog-note').dataset.error = String(Boolean($('catalog-note').textContent));
    discoveryStatus('');
  } catch (error) { if (sequence === loadSequence) { options($('available-app'), [], 'Apps could not be loaded'); discoveryStatus([priorWarning, error.message].filter(Boolean).join(' '), true); } }
  finally { if (sequence === loadSequence) { discoveryBusy = false; discoveryController = null; renderAppSave(); } }
  if (sequence === loadSequence && ((editing && !editing.tenantId) || selectedAppId) && $('available-app').value) await loadAppModels();
}
async function loadAppModels() {
  cancelDiscovery(); const sequence = loadSequence;
  const chosen = editing ? { id: editing.appId, name: editing.name } : appCatalog.find(app => app.id === $('available-app').value);
  const tenantId = $('tenant').value;
  appDiscovery = null; renderConnectedModels([]);
  discoveryStatus('');
  if (!chosen || !tenantId) return;
  const key = `${editing?.origin ?? discoveryOrigin}|${tenantId}|${chosen.id}`;
  const existing = apps.find(app => app.key === key);
  if (!editing && existing) { editApp(existing); notice('This app is already enabled. You can edit its saved context.'); return; }
  discoveryBusy = true; discoveryController = new AbortController(); const signal = discoveryController.signal; renderAppSave();
  discoveryStatus('Identifying connected models and their workspaces…');
  try {
    const observed = await discoverApps({ origin: editing?.origin ?? discoveryOrigin, tenantId, appId: chosen.id, signal });
    if (sequence !== loadSequence) return;
    discoveryStatus('Checking model access through your Anaplan connection…');
    const result = await api('/app-discovery', { method: 'POST', body: { tenantId: observed.tenantId, tenantName: observed.tenantName, appId: chosen.id, name: chosen.name, origin: observed.origin, models: observed.models }, signal });
    if (sequence !== loadSequence) return;
    appDiscovery = result;
    const connected = result.discovery.models;
    renderConnectedModels(connected);
    discoveryStatus('');
  } catch (error) { if (sequence === loadSequence) { discoveryStatus(error.message, true); if (error.code === 'ANAPLAN_LOGIN') showError(error); } }
  finally { if (sequence === loadSequence) { discoveryBusy = false; discoveryController = null; renderAppSave(); } }
}
async function refreshStatus() {
  try {
    connectionStatus = await api('/status');
    $('helper-status').textContent = 'Connected'; $('helper-recovery').hidden = true;
    if (connectionStatus.llm) applyLlm(connectionStatus.llm);
    renderAnaplan();
    updateComposer();
  } catch (error) { connectionStatus = null; $('helper-status').textContent = 'Unavailable'; $('helper-recovery').hidden = false; $('anaplan-setup').open = true; anaplanState = 'idle'; renderAnaplan(); renderLlm(); throw error; }
}
function renderAnaplan() {
  $('anaplan-status').textContent = anaplanState !== 'idle' ? anaplanMessage : !connectionStatus ? 'Local helper unavailable' : !connectionStatus.mcpAvailable ? 'Anaplan connector unavailable' : connectionStatus.anaplanConfigured ? 'Not checked' : 'Add an OAuth client ID';
  $('anaplan-status').dataset.error = String(anaplanState === 'error');
  renderConnectionDot('connection-dot', !connectionStatus ? 'unknown' : anaplanState === 'connected' ? 'connected' : 'attention', $('anaplan-status').textContent);
  $('connect-anaplan').textContent = anaplanBusy ? 'Checking…' : 'Check connection';
}
function connectionResult(message, state = '') {
  $('connection-result').textContent = message;
  $('connection-result').dataset.state = state;
}
function renderConnection() {
  const saved = !anaplanDirty && anaplanSettings?.source === 'saved';
  $('save-connection').disabled = !connection || connectionSaving || anaplanBusy || !$('client-id').value.trim() || saved;
  $('save-connection').textContent = connectionSaving ? 'Saving…' : 'Save settings';
  $('client-id').disabled = connectionSaving || anaplanBusy;
  $('connect-anaplan').disabled = connectionSaving || anaplanBusy;
}
function describeConnection() {
  $('connection-result').title = anaplanSettings?.savedAt ? `Saved ${new Date(anaplanSettings.savedAt).toLocaleString()}` : '';
  if (anaplanDirty) return connectionResult('Unsaved changes');
  if (anaplanSettings?.source === 'saved') {
    return connectionResult('Saved locally', 'saved');
  }
  connectionResult(anaplanSettings?.source === 'detected' ? 'Detected locally' : '');
}
function applyConnection(settings, force = false) {
  if (!anaplanSettings && !settings.clientId) $('anaplan-setup').open = true;
  if (anaplanSettings && anaplanSettings.clientId !== settings.clientId) clearDiscoveryCache();
  anaplanSettings = settings;
  if (!anaplanDirty || force) { $('client-id').value = settings.clientId; anaplanDirty = false; }
  renderConnection(); describeConnection();
}
async function refreshConnection() {
  try { applyConnection((await api('/connection')).connection); }
  catch (error) { $('anaplan-setup').open = true; connectionResult(error.message, 'error'); throw error; }
}
on('assistant-tab', 'click', () => view('assistant'));
on('admin-tab', 'click', () => view('admin'));
on('first-app', 'click', async () => { view('admin'); await addApp(); });
on('add-app', 'click', addApp);
on('close-editor', 'click', () => { appPicker.close(); cancelDiscovery(); $('app-editor').hidden = true; editing = null; });
on('tenant', 'change', () => {
  if (draftSelection) contextDrafts.set(draftSelection, $('context').value);
  if (!editing) { $('context').value = ''; draftSelection = ''; countContext(); }
  return loadAvailableApps();
});
on('available-app', 'change', () => {
  if (draftSelection) contextDrafts.set(draftSelection, $('context').value);
  draftSelection = `${$('tenant').value}:${$('available-app').value}`;
  if (!editing) { $('context').value = contextDrafts.get(draftSelection) ?? ''; countContext(); }
  filterAvailableApps();
  return loadAppModels();
});
on('enabled-app-search', 'input', renderEnabledApps);
on('clear-enabled-app-search', 'click', () => {
  $('enabled-app-search').value = ''; renderEnabledApps(); $('enabled-app-search').focus();
});
on('refresh-discovery', 'click', () => {
  if (savingApp || discoveryBusy || anaplanBusy) return;
  return editing && $('tenant').value ? loadAppModels() : loadTenants({ refresh: true, preserveSelection: true });
});
on('cancel-discovery', 'click', () => { cancelDiscovery(); discoveryStatus('Cancelled. Select Refresh to retry.'); });
on('connect-anaplan', 'click', () => checkAnaplanAccess({ openSignIn: anaplanState !== 'login' }));
on('refresh-status', 'click', async () => { await refreshConnection(); await refreshStatus(); await loadApps(); notice('Connection status updated.'); });
on('chat-app', 'change', () => { selectedKey = $('chat-app').value; renderMessages(); });
on('context', 'input', countContext);
on('import-context', 'click', () => $('context-file').click());
on('context-file', 'change', async () => {
  const file = $('context-file').files[0]; if (!file) return;
  if (!/\.(txt|md|csv|json)$/i.test(file.name) || file.size > 60000) { $('context-file').value = ''; throw new Error('Choose a TXT, Markdown, CSV or JSON file up to 60 KB.'); }
  const text = await file.text();
  if (/\u0000/.test(text)) throw new Error('This looks like a binary file. Choose a text context document.');
  const combined = [$('context').value.trim(), text.trim()].filter(Boolean).join('\n\n');
  if (combined.length > 60000) throw new Error('The combined context exceeds 60,000 characters. Shorten it before importing.');
  $('context').value = combined; countContext(); notice('Context imported. Review and save.');
});
on('app-form', 'submit', async event => {
  event.preventDefault(); if (savingApp || discoveryBusy || (!editing && !appDiscovery?.ticket)) return;
  savingApp = true; notice(''); renderAppSave();
  try {
    const result = await api('/apps', { method: 'POST', body: { key: editing?.key, ticket: appDiscovery?.ticket, modelKeys: connectedModelKeys(), context: $('context').value, revision: editing?.revision ?? 0 } });
    selectedKey = result.app.key; $('app-editor').hidden = true; editing = null; appDiscovery = null; await loadApps(); notice('App enabled. Context saved.');
  } finally {
    savingApp = false;
    for (const id of ['refresh-discovery', 'add-app', 'close-editor', 'context', 'context-file', 'import-context']) $(id).disabled = false;
    $('tenant').disabled = Boolean(editing?.tenantId);
    $('available-app').disabled = Boolean(editing) || !appCatalog.length;
    renderAppSave();
  }
});
on('connection-form', 'submit', async event => {
  event.preventDefault(); if (connectionSaving || anaplanBusy) return;
  connectionSaving = true; renderConnection(); connectionResult('Saving connection…');
  try {
    const result = await api('/connection', { method: 'POST', body: { clientId: $('client-id').value } });
    clearDiscoveryCache();
    applyConnection(result.connection, true); cancelDiscovery(); appDiscovery = null; if (!editing) renderConnectedModels([]);
    $('auth').hidden = true;
    anaplanState = 'idle'; anaplanMessage = '';
    if (connectionStatus) connectionStatus.anaplanConfigured = true;
    renderAnaplan();
  } catch (error) { connectionResult(`Save failed. ${error.message}`, 'error'); }
  finally { connectionSaving = false; renderConnection(); }
});
on('client-id', 'input', () => {
  anaplanDirty = $('client-id').value.trim() !== (anaplanSettings?.clientId ?? '');
  renderConnection(); describeConnection();
});
on('llm-provider', 'change', () => {
  llmDrafts[draftProvider] = $('llm-model').value;
  draftProvider = $('llm-provider').value; $('llm-model').value = llmDrafts[draftProvider] ?? '';
  llmDirty = true; $('llm-test-result').textContent = ''; renderLlm();
});
on('llm-model', 'input', () => { llmDirty = true; $('llm-test-result').textContent = ''; renderLlm(); });
on('reload-llm', 'click', async () => {
  llmBusy = true; renderLlm();
  try { await refreshStatus(); applyLlm(connectionStatus.llm, true); $('llm-test-result').textContent = ''; }
  finally { llmBusy = false; renderLlm(); }
});
on('test-llm', 'click', async () => {
  const choice = { provider: $('llm-provider').value, model: $('llm-model').value };
  llmBusy = true; llmActivity = 'check'; renderLlm(); $('llm-test-result').dataset.error = 'false'; $('llm-test-result').textContent = '';
  try {
    await api('/llm/test', { method: 'POST', body: choice, signal: AbortSignal.timeout(150000) });
    $('llm-test-result').textContent = `Connection verified.${llmDirty ? ' Save to apply.' : ''}`;
    await refreshStatus();
  } catch (error) { $('llm-test-result').dataset.error = 'true'; $('llm-test-result').textContent = error.message; throw error; }
  finally { llmBusy = false; llmActivity = ''; renderLlm(); }
});
on('llm-form', 'submit', async event => {
  event.preventDefault(); if (!llmDirty || llmBusy || busy) return;
  const choice = { provider: $('llm-provider').value, model: $('llm-model').value, revision: llmEditRevision };
  llmBusy = true; llmActivity = 'save'; renderLlm();
  try {
    const result = await api('/llm', { method: 'POST', body: choice });
    applyLlm(result.llm, true); $('llm-test-result').textContent = ''; await refreshStatus();
    notice('AI settings saved.');
  } finally { llmBusy = false; llmActivity = ''; renderLlm(); }
});
document.querySelectorAll('[data-question]').forEach(button => button.addEventListener('click', () => { $('question').value = button.dataset.question; $('question').focus(); }));
on('cancel-question', 'click', () => controller?.abort());
on('question', 'keydown', event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); if (!$('send').disabled) $('question-form').requestSubmit(); } });
on('question-form', 'submit', async event => {
  event.preventDefault(); if (busy || savingApp || llmBusy || !currentApp() || !llmSettings) return;
  const app = currentApp(), question = $('question').value.trim(); if (!question) return;
  const thread = currentThread(), history = thread.slice(-8).map(({ role, text }) => ({ role, text }));
  thread.push({ role: 'user', text: question }); $('question').value = ''; busy = true; controller = new AbortController(); notice(''); renderMessages(); renderLlm();
  try {
    const result = await api('/chat', { method: 'POST', body: { appKey: app.key, revision: app.revision, llmRevision: llmSettings.revision, question, history }, signal: controller.signal });
    thread.push({ role: 'assistant', text: result.answer, sources: result.sources, revision: result.revision });
  } catch (error) {
    thread.pop(); $('question').value = question;
    if (error.name === 'AbortError') notice('Question stopped. You can edit it and try again.'); else showError(error);
  } finally { busy = false; controller = null; renderMessages(); renderLlm(); $('messages').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});

async function init() {
  try { connection = (await import('./local-config.js')).connection; } catch {}
  const results = await Promise.allSettled([refreshStatus(), loadApps(), refreshConnection()]);
  for (const result of results) if (result.status === 'rejected') showError(result.reason);
  // Opening an app is optional. If one is already active, preselect a unique saved match.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    discoveryOrigin = appOrigin(url.href);
    const appId = url.pathname.match(/\/apps\/app\/([a-zA-Z0-9_-]+)/)?.[1];
    const matching = apps.filter(app => app.appId === appId && app.origin === discoveryOrigin);
    if (matching.length === 1) { selectedKey = matching[0].key; renderApps(); }
  } catch {}
}
await init();
