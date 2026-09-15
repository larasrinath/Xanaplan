import { pageFromUrl } from './page-api.mjs';

export async function pageRequest(action, input, { signal, chromeApi = globalThis.chrome } = {}) {
  if (!chromeApi?.runtime?.sendMessage) throw new Error('Open the installed extension in Chrome to read page context.');
  const jobId = crypto.randomUUID();
  let timer, abort;
  const stopped = new Promise((_, reject) => {
    abort = () => { chromeApi.runtime.sendMessage({ target: 'page-background', action: 'cancel', jobId }).catch(() => {}); reject(new DOMException('Page read cancelled', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      chromeApi.runtime.sendMessage({ target: 'page-background', action: 'cancel', jobId }).catch(() => {});
      reject(new Error('Page context timed out. Refresh and try again.'));
    }, action === 'observe' ? 10000 : 60000);
  });
  try {
    if (signal?.aborted) throw new DOMException('Page read cancelled', 'AbortError');
    const response = await Promise.race([chromeApi.runtime.sendMessage({ target: 'page-background', action, jobId, input }), stopped]);
    if (signal?.aborted) throw new DOMException('Page read cancelled', 'AbortError');
    if (!response?.ok) throw new Error(response?.error || 'Page context is unavailable. Reload the extension and refresh.');
    return response.result;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

// All async results are generation guarded. A manual page pin survives tab
// navigation; its inherited selections are frozen at the time of selection.
export class PageTracker {
  constructor({ read = pageRequest, api, changed = () => {}, resolveApp = () => null }) {
    this.read = read; this.api = api; this.changed = changed; this.resolveApp = resolveApp;
    this.state = { mode: 'follow', pages: [], selectedPage: '', modelKey: '', context: null, ticket: '', loading: false, error: '' };
    this.sequence = 0; this.observation = null; this.app = null; this.observing = false;
  }
  invalidate() {
    const restoring = this.restoring; this.restoring = null; restoring?.tracker.invalidate();
    ++this.sequence; this.controller?.abort();
    Object.assign(this.state, { context: null, ticket: '', expires: 0, loading: false, error: '', progress: '', startedAt: 0 });
    this.changed(this.state);
  }
  matchingApp(observation) {
    const page = pageFromUrl(observation?.url), app = page && this.resolveApp(page);
    return app?.appId === page?.appId && app?.origin === page?.origin ? app : null;
  }
  async setApp(app, { manual = false, observation } = {}) {
    if (!manual && this.app?.key === app?.key && this.app?.revision === app?.revision) return;
    this.app = app; this.state = { mode: manual ? 'manual' : 'follow', pages: [], selectedPage: '', modelKey: '', context: null, ticket: '', loading: false, error: '' };
    if (observation) this.observation = observation;
    this.definition = null; this.definitionCache = null; this.saved = null; this.inherited = null; this.invalidate();
    if (app) await this.refresh({ observe: !observation });
  }
  async choose(pageId) {
    this.saved = null;
    const inheritedModelKey = this.state.context?.model.key;
    this.state.mode = pageId ? 'manual' : 'follow'; this.state.selectedPage = pageId; this.state.modelKey = '';
    const tab = pageFromUrl(this.observation?.url);
    this.inherited = tab?.appId === this.app?.appId && tab?.origin === this.app?.origin ? { ...structuredClone(this.observation), inheritedModelKey } : null;
    await this.refresh();
  }
  async chooseModel(modelKey) {
    if (this.state.mode === 'saved') { this.saved = null; this.state.mode = 'manual'; this.inherited = null; }
    this.state.modelKey = modelKey; await this.refresh();
  }
  async restoreSaved(app, record) {
    if (!record.page?.id) throw new Error('This chat has no saved page. Continue on the current page instead.');
    if (this.restoring) this.stop();
    this.controller?.abort(); const seq = ++this.sequence;
    const previous = { ...this.state, loading: false, progress: '', startedAt: 0 };
    // Verify a candidate without replacing the active page or ticket. A failed
    // restore leaves Continue on this page and Back usable.
    const candidate = new PageTracker({ read: this.read, api: this.api, changed: state => {
      if (this.restoring?.tracker !== candidate) return;
      Object.assign(this.state, { loading: true, progress: state.progress || 'Restoring saved page', startedAt: state.startedAt || Date.now() });
      this.changed(this.state);
    } });
    this.restoring = { tracker: candidate, previous };
    candidate.app = app;
    candidate.saved = { id: record.id, revision: record.revision };
    Object.assign(candidate.state, { mode: 'saved', selectedPage: record.page.id,
      modelKey: record.messages.findLast(message => message.role === 'assistant')?.pageContext?.model?.key || '' });
    try {
      await candidate.refresh({ observe: false });
      if (seq !== this.sequence || this.restoring?.tracker !== candidate) throw new DOMException('Saved page restoration stopped', 'AbortError');
      if (!candidate.state.ticket) throw new Error(candidate.state.error || 'Saved page restoration was stopped.');
      this.app = app; this.state = candidate.state; this.saved = candidate.saved;
      this.definition = candidate.definition; this.definitionCache = candidate.definitionCache; this.inherited = null;
    } catch (error) {
      if (seq === this.sequence) this.state = previous;
      throw error;
    } finally {
      if (seq === this.sequence) { this.restoring = null; this.changed(this.state); }
    }
  }
  savedRevision(record) { if (record && this.saved?.id === record.id) this.saved.revision = record.revision; }
  stop() {
    if (this.restoring) {
      const { tracker, previous } = this.restoring; this.restoring = null; ++this.sequence;
      tracker.invalidate(); this.state = previous; this.changed(this.state); return;
    }
    this.invalidate(); this.state.error = 'Page loading stopped. Refresh to try again.'; this.changed(this.state);
  }
  async observe() {
    if (this.observationPromise) return this.observationPromise;
    this.observationPromise = this.observeOnce();
    try { await this.observationPromise; } finally { this.observationPromise = null; }
  }
  async observeOnce() {
    if (!this.app || this.restoring) return;
    this.observing = true;
    const app = this.app, sequence = this.sequence;
    try {
      const observation = await this.read('observe');
      if (app !== this.app || sequence !== this.sequence || this.restoring) return;
      const matching = this.state.mode === 'follow' && this.matchingApp(observation);
      if (matching && matching.key !== app.key) { await this.setApp(matching, { observation }); return; }
      const changed = JSON.stringify(observation) !== JSON.stringify(this.observation);
      const modelChanged = pageFromUrl(observation.url)?.pageId !== pageFromUrl(this.observation?.url)?.pageId || observation.modelName !== this.observation?.modelName;
      this.observation = observation;
      if (changed && this.state.mode === 'follow') { if (modelChanged) this.state.modelKey = ''; await this.refresh({ observe: false, useDefinitionCache: true }); }
    } catch (error) {
      if (app === this.app && !this.restoring && this.state.mode === 'follow') { this.invalidate(); this.state.error = error.message; this.changed(this.state); }
    } finally { this.observing = false; }
  }
  async refresh({ observe = true, useDefinitionCache = false } = {}) {
    this.invalidate();
    if (!this.app) return;
    const seq = this.sequence, app = this.app;
    this.controller = new AbortController(); const requestController = this.controller, { signal } = requestController;
    this.state.loading = true; this.state.startedAt = Date.now();
    const progress = message => { if (seq === this.sequence) { this.state.progress = message; this.changed(this.state); } };
    progress('Checking the current page');
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; requestController.abort(); }, 90000);
    try {
      let observationError = '';
      if (observe && this.state.mode === 'follow') {
        let observation;
        try { observation = await this.read('observe', undefined, { signal }); }
        catch (error) {
          if (error.name === 'AbortError') throw error;
          observationError = error.message; observation = null;
        }
        if (seq !== this.sequence) return;
        this.observation = observation;
      }
      const matching = this.state.mode === 'follow' && this.matchingApp(this.observation);
      if (matching && matching.key !== app.key) { await this.setApp(matching, { observation: this.observation }); return; }
      const tab = pageFromUrl(this.observation?.url);
      const pageId = this.state.mode !== 'follow' ? this.state.selectedPage : tab?.origin === app.origin && tab.appId === app.appId && !tab.editing ? tab.pageId : '';
      progress('Loading the published page and cards');
      const cached = useDefinitionCache && this.definitionCache?.pageId === pageId && this.definitionCache.expires > Date.now();
      const definition = cached ? this.definitionCache.definition : await this.read('read', { origin: app.origin, tenantId: app.tenantId, appId: app.appId, ...(pageId ? { pageId } : {}) }, { signal });
      if (seq !== this.sequence) return;
      this.state.pages = definition.pages; this.definition = definition;
      if (definition.unavailableReason) throw new Error(definition.unavailableReason);
      if (!pageId) throw new Error(observationError || (this.state.mode === 'manual' ? 'Choose a page for this chat.' : tab?.editing ? 'Leave page edit mode or choose a published page.' : tab && tab.appId !== app.appId ? 'This tab’s app is not enabled or could not be matched. Enable it in Admin, or choose another page.' : 'Open an Anaplan page, or choose one from the page menu.'));
      if (this.state.mode === 'follow') this.state.selectedPage = pageId;
      if (!cached) this.definitionCache = { pageId, definition, expires: Date.now() + 60000 };
      progress('Verifying the page’s model and selections');
      const result = await this.api('/page-context', { method: 'POST', signal, onProgress: event => { if (event.message) progress(event.message); }, body: {
        stream: true,
        appKey: app.key, revision: app.revision, definition, mode: this.state.mode,
        modelKey: this.state.modelKey || undefined, observation: this.state.mode === 'manual' ? this.inherited : this.observation,
        ...(this.saved ? { savedConversationId: this.saved.id, savedConversationRevision: this.saved.revision } : {}),
      } });
      if (seq !== this.sequence) return;
      Object.assign(this.state, result);
    } catch (error) {
      if (seq === this.sequence && (timedOut || error.name !== 'AbortError')) this.state.error = timedOut ? 'Page verification timed out. Refresh to try again.' : error.message;
    } finally {
      clearTimeout(timeout);
      if (seq === this.sequence) { this.state.loading = false; this.changed(this.state); }
    }
  }
  async snapshot() {
    // Re-observe immediately before every question; polling is only a UI aid.
    await this.observe();
    if (!this.state.ticket || this.state.expires <= Date.now() + 10000) await this.refresh();
    if (!this.state.ticket || this.state.loading) throw new Error(this.state.error || 'Wait for page context to finish loading.');
    return structuredClone({ ticket: this.state.ticket, context: this.state.context });
  }
}
