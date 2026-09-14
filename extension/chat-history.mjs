import { matchesSearch } from './searchable-select.mjs';

const blank = () => ({ id: crypto.randomUUID(), revision: 0, messages: [], loaded: true });

export class ChatHistory {
  constructor({ api, changed = () => {} }) {
    this.api = api; this.changed = changed; this.records = []; this.threads = new Map();
    this.ready = false; this.loading = false; this.error = ''; this.viewed = null; this.listOpen = false; this.sequence = 0;
    this.refreshSequence = 0;
  }
  async refresh() {
    const sequence = ++this.refreshSequence;
    this.loading = true; this.error = ''; this.changed();
    try {
      const result = await this.api('/conversations');
      if (sequence !== this.refreshSequence) return;
      this.records = result.conversations; this.ready = true; this.error = result.warning || '';
      for (const thread of this.threads.values()) if (thread.loadError) { thread.loaded = false; thread.loadError = ''; }
    } catch (error) { if (sequence === this.refreshSequence) this.error = error.message; }
    finally { if (sequence === this.refreshSequence) { this.loading = false; this.changed(); } }
  }
  current(key) {
    if (!key) return null;
    if (!this.threads.has(key)) this.threads.set(key, { ...blank(), loaded: false });
    const thread = this.threads.get(key);
    if (this.ready && !thread.loaded && !thread.loading) {
      const saved = this.records.find(record => record.scopeKey === key);
      if (!saved) thread.loaded = true;
      else {
        thread.loading = true;
        this.api(`/conversations/${saved.id}`).then(({ conversation }) => {
          if (this.threads.get(key) === thread) Object.assign(thread, { id: conversation.id, revision: conversation.revision, messages: conversation.messages, loaded: true });
        }).catch(error => { thread.loadError = error.message; thread.loaded = true; })
          .finally(() => { thread.loading = false; this.changed(); });
      }
    }
    return thread;
  }
  newChat(key) {
    if (!key) return;
    ++this.sequence; this.loading = false; this.viewed = null; this.listOpen = false;
    this.threads.set(key, blank()); this.changed();
  }
  async open(id, currentKey) {
    const sequence = ++this.sequence;
    this.loading = true; this.error = ''; this.changed();
    try {
      const { conversation } = await this.api(`/conversations/${id}`);
      if (sequence !== this.sequence) return;
      if (conversation.scopeKey === currentKey()) {
        this.threads.set(conversation.scopeKey, { id: conversation.id, revision: conversation.revision, messages: conversation.messages, loaded: true });
        this.viewed = null;
      } else this.viewed = conversation;
      this.listOpen = false;
    } catch (error) { if (sequence === this.sequence) this.error = error.message; }
    finally { if (sequence === this.sequence) { this.loading = false; this.changed(); } }
  }
  back() { ++this.sequence; this.loading = false; this.viewed = null; this.listOpen = false; this.changed(); }
  saved(thread, result) {
    thread.saveError = result.historyError || '';
    if (result.conversation) {
      Object.assign(thread, { id: result.conversation.id, revision: result.conversation.revision });
      this.records = [result.conversation, ...this.records.filter(item => item.id !== result.conversation.id)];
    }
    this.changed();
  }
  async remove(id, revision) {
    await this.api(`/conversations/${id}`, { method: 'DELETE', body: { revision } });
    this.records = this.records.filter(record => record.id !== id);
    for (const [key, thread] of this.threads) if (thread.id === id) this.threads.delete(key);
    if (this.viewed?.id === id) this.viewed = null;
    this.changed();
  }
}

export function renderChatHistory(document, history, { scopeKey, busy, open, remove }) {
  const $ = id => document.getElementById(id), thread = history.current(scopeKey);
  $('chat-history').hidden = !history.listOpen;
  $('history-toggle').setAttribute('aria-expanded', String(history.listOpen));
  $('history-toggle').disabled = busy;
  $('new-chat').disabled = busy || history.loading || !scopeKey;
  $('history-refresh').disabled = history.loading || busy;
  $('history-status').textContent = history.loading ? 'Loading saved chats…' : history.error || 'Saved on this computer.';
  $('history-status').dataset.error = String(Boolean(history.error));
  $('chat-save-status').textContent = thread?.saveError ? 'Not saved' : thread?.loadError ? 'History unavailable' : thread?.loading || !history.ready ? 'Loading chats…' : busy ? 'Answering…' : thread?.revision ? 'Saved locally' : '';
  $('chat-save-status').dataset.error = String(Boolean(thread?.saveError || thread?.loadError || history.error));
  const query = $('history-search').value;
  const records = history.records.filter(record => matchesSearch(`${record.title} ${record.app.name} ${record.app.tenantName} ${record.page?.name || ''}`, query));
  $('history-list').replaceChildren();
  if (!records.length && !history.loading) {
    const empty = document.createElement('li'); empty.className = 'history-empty'; empty.textContent = query.trim() ? 'No matching chats.' : 'No saved chats yet.'; $('history-list').append(empty);
  }
  for (const record of records) {
    const row = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.className = 'history-item'; button.disabled = busy || history.loading;
    const title = document.createElement('strong'), meta = document.createElement('span'), date = document.createElement('small');
    title.textContent = record.title; meta.textContent = `${record.app.name}${record.page ? ` · ${record.page.name}` : ''}`;
    button.title = `${record.title}\n${meta.textContent}`;
    date.textContent = new Date(record.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    button.append(title, meta, date); button.addEventListener('click', () => open(record.id));
    const trash = document.createElement('button'); trash.type = 'button'; trash.className = 'text-button history-delete'; trash.textContent = 'Delete'; trash.setAttribute('aria-label', `Delete chat: ${record.title}`); trash.disabled = busy || history.loading;
    trash.addEventListener('click', () => remove(record)); row.append(button, trash); $('history-list').append(row);
  }
  const archived = history.viewed;
  $('saved-chat-heading').hidden = !archived || history.listOpen;
  $('live-context').hidden = Boolean(archived) || history.listOpen;
  $('question-form').hidden = Boolean(archived) || history.listOpen;
  $('conversation').hidden = history.listOpen;
  $('chat-privacy').hidden = Boolean(archived) || history.listOpen;
  if (archived) {
    $('saved-chat-title').textContent = archived.title;
    $('saved-chat-context').textContent = `${archived.app.name}${archived.page ? ` · ${archived.page.name}` : ''} · ${new Date(archived.updatedAt).toLocaleString()}`;
  }
}
