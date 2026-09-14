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
  constructor({ read = pageRequest, api, changed = () => {} }) {
    this.read = read; this.api = api; this.changed = changed;
    this.state = { mode: 'follow', pages: [], selectedPage: '', modelKey: '', context: null, ticket: '', loading: false, error: '' };
    this.sequence = 0; this.observation = null; this.app = null; this.observing = false;
  }
  invalidate() {
    ++this.sequence; this.controller?.abort();
    Object.assign(this.state, { context: null, ticket: '', expires: 0, loading: false, error: '' });
    this.changed(this.state);
  }
  async setApp(app) {
    if (this.app?.key === app?.key && this.app?.revision === app?.revision) return;
    this.app = app; this.state = { mode: 'follow', pages: [], selectedPage: '', modelKey: '', context: null, ticket: '', loading: false, error: '' };
    this.definition = null; this.inherited = null; this.invalidate();
    if (app) await this.refresh();
  }
  async choose(pageId) {
    const inheritedModelKey = this.state.context?.model.key;
    this.state.mode = pageId ? 'manual' : 'follow'; this.state.selectedPage = pageId; this.state.modelKey = '';
    const tab = pageFromUrl(this.observation?.url);
    this.inherited = tab?.appId === this.app?.appId && tab?.origin === this.app?.origin ? { ...structuredClone(this.observation), inheritedModelKey } : null;
    await this.refresh();
  }
  async chooseModel(modelKey) { this.state.modelKey = modelKey; await this.refresh(); }
  async observe() {
    if (this.observationPromise) return this.observationPromise;
    this.observationPromise = this.observeOnce();
    try { await this.observationPromise; } finally { this.observationPromise = null; }
  }
  async observeOnce() {
    if (!this.app) return;
    this.observing = true;
    const app = this.app;
    try {
      const observation = await this.read('observe');
      if (app !== this.app) return;
      const changed = JSON.stringify(observation) !== JSON.stringify(this.observation);
      const modelChanged = pageFromUrl(observation.url)?.pageId !== pageFromUrl(this.observation?.url)?.pageId || observation.modelName !== this.observation?.modelName;
      this.observation = observation;
      if (changed && this.state.mode === 'follow') { if (modelChanged) this.state.modelKey = ''; await this.refresh({ observe: false }); }
    } catch (error) {
      if (app === this.app && this.state.mode === 'follow') { this.invalidate(); this.state.error = error.message; this.changed(this.state); }
    } finally { this.observing = false; }
  }
  async refresh({ observe = true } = {}) {
    this.invalidate();
    if (!this.app) return;
    const seq = this.sequence, app = this.app;
    this.controller = new AbortController(); const { signal } = this.controller;
    this.state.loading = true; this.changed(this.state);
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
      const tab = pageFromUrl(this.observation?.url);
      const pageId = this.state.mode === 'manual' ? this.state.selectedPage : tab?.origin === app.origin && tab.appId === app.appId && !tab.editing ? tab.pageId : '';
      const definition = await this.read('read', { origin: app.origin, tenantId: app.tenantId, appId: app.appId, ...(pageId ? { pageId } : {}) }, { signal });
      if (seq !== this.sequence) return;
      this.state.pages = definition.pages; this.definition = definition;
      if (!pageId) throw new Error(observationError || (tab?.editing ? 'Leave page edit mode or select a published page below.' : 'Open a page in this app, or choose a page for chat.'));
      if (this.state.mode === 'follow') this.state.selectedPage = pageId;
      const result = await this.api('/page-context', { method: 'POST', signal, body: {
        appKey: app.key, revision: app.revision, definition, mode: this.state.mode,
        modelKey: this.state.modelKey || undefined, observation: this.state.mode === 'manual' ? this.inherited : this.observation,
      } });
      if (seq !== this.sequence) return;
      Object.assign(this.state, result);
    } catch (error) {
      if (seq === this.sequence && error.name !== 'AbortError') this.state.error = error.message;
    } finally {
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
