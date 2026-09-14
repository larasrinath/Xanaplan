import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from './validation.mjs';

const validId = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const MAX_BYTES = 8 * 1024 * 1024;
export const conversationSummary = ({ id, scopeKey, title, app, page, llm, createdAt, updatedAt, revision, messages }) => ({ id, scopeKey, title, app, page, llm, createdAt, updatedAt, revision, messageCount: messages.length });

// Separate files keep settings small. Records contain displayed messages and
// source/context snapshots, never credentials, tickets or raw tool evidence.
export class ConversationStore {
  constructor(directory) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  file(id) {
    if (!validId(id)) throw new AppError('Invalid conversation ID.', 400);
    return join(this.directory, `${id}.json`);
  }
  get(id) {
    let text;
    try { text = readFileSync(this.file(id), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') throw new AppError('This conversation was not found.', 404); throw error; }
    try {
      const record = JSON.parse(text);
      if (Buffer.byteLength(text) > MAX_BYTES || record.version !== 1 || record.id !== id || !Array.isArray(record.messages) || !Number.isInteger(record.revision)) throw new Error('Invalid record');
      return record;
    } catch { throw new AppError('This saved conversation could not be read. Its file has been left unchanged.', 500); }
  }
  list() {
    const conversations = [], unreadable = [];
    for (const file of readdirSync(this.directory)) {
      if (!file.endsWith('.json') || !validId(file.slice(0, -5))) continue;
      try { conversations.push(conversationSummary(this.get(file.slice(0, -5)))); }
      catch { unreadable.push(file.slice(0, -5)); }
    }
    conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    return { conversations, ...(unreadable.length ? { warning: `${unreadable.length} saved conversation(s) could not be read. Their files have been preserved.` } : {}) };
  }
  prepare({ input, scope, pageContext, llm }) {
    const id = input.conversationId || randomUUID();
    this.file(id);
    let record;
    try { record = this.get(id); } catch (error) { if (error.status !== 404) throw error; }
    const scopeKey = `${scope.key}:${scope.revision}:ai-${llm.revision}:page-${pageContext?.fingerprint || 'none'}`;
    if ((input.conversationRevision ?? 0) !== (record?.revision ?? 0)) throw new AppError('This conversation changed in another panel. Reopen it from History before continuing.', 409);
    if (record && record.scopeKey !== scopeKey) throw new AppError('This conversation uses a different app, page or context. Start a new chat for the current page.', 409);
    if (record?.messages.length >= 200) throw new AppError('This conversation is full. Start a new chat; it remains available in History.', 422);
    return record || { version: 1, id, scopeKey, title: '', app: { key: scope.key, name: scope.name, tenantName: scope.tenantName || '' }, page: pageContext ? { ...pageContext.page, modelName: pageContext.model.name } : null, llm: { provider: llm.provider, model: llm.model, revision: llm.revision }, createdAt: new Date().toISOString(), revision: 0, messages: [] };
  }
  saveTurn(record, question, result) {
    let current;
    try { current = this.get(record.id); } catch (error) { if (error.status !== 404) throw error; }
    if ((current?.revision ?? 0) !== record.revision) throw new AppError('The saved conversation changed before this answer could be saved.', 409);
    const now = result.answeredAt || new Date().toISOString();
    const pageContext = result.pageContext ? structuredClone(result.pageContext) : undefined;
    if (pageContext) delete pageContext.selectionContext; // Filter provenance is already on each source.
    const next = { ...record, title: record.title || question.replace(/\s+/g, ' ').slice(0, 100), updatedAt: now, revision: record.revision + 1,
      messages: [...record.messages, { role: 'user', text: question, createdAt: now }, { role: 'assistant', text: result.answer, sources: result.sources, revision: result.revision, pageContext, createdAt: now }],
    };
    const data = JSON.stringify(next);
    if (Buffer.byteLength(data) > MAX_BYTES) throw new AppError('This conversation is too large to save. Start a new chat; earlier saved messages remain in History.', 422);
    const file = this.file(record.id), temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, data, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
    } catch {
      throw new AppError('The answer could not be saved locally. Check available disk space and access to the Xanaplan .local folder.', 507);
    } finally { try { unlinkSync(temporary); } catch {} }
    return conversationSummary(next);
  }
  remove(id, revision) {
    const record = this.get(id);
    if (record.revision !== revision) throw new AppError('This conversation changed. Refresh History before deleting it.', 409);
    unlinkSync(this.file(id));
  }
}
