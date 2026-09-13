import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400, details = {}) { super(message); this.status = status; this.details = details; }
}
export function requiredText(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AppError(`${label} is required (up to ${max} characters).`);
  return value.trim();
}
export function identifier(value, label) {
  const id = requiredText(value, label, 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new AppError(`${label} is invalid.`);
  return id;
}
export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = join(directory, 'settings.json');
    try { this.data = JSON.parse(readFileSync(this.file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Local settings could not be read. Restore settings.json from a backup before restarting.');
      this.data = { version: 1, token: randomBytes(32).toString('hex'), anaplanClientId: '', models: [] };
      this.flush();
    }
    if (this.data.version !== 1 || !Array.isArray(this.data.models) || !this.data.token) throw new Error('Unsupported local settings file.');
    chmodSync(this.file, 0o600);
  }
  flush() {
    writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
  }
  list() { return structuredClone(this.data.models); }
  listApps() { return structuredClone(this.data.apps ?? []); }
  getApp(key) {
    const app = this.listApps().find(app => app.key === key);
    if (!app) throw new AppError('This app is not enabled. Add it in Admin first.', 404);
    return app;
  }
  saveApp(input) {
    const appId = identifier(input.appId, 'App');
    const origin = requiredText(input.origin, 'Anaplan site', 200);
    if (!/^https:\/\/[a-z0-9-]+\.app\.anaplan\.com$/i.test(origin)) throw new AppError('Invalid Anaplan site.');
    const apps = this.listApps();
    const prior = input.key ? apps.find(app => app.key === input.key) : null;
    // Preserve older workspace-based entries when editing their context offline.
    // Fresh discovery moves them to tenant/app identity without losing context.
    const legacy = prior && !prior.tenantId && !input.tenantId;
    const tenantId = legacy ? null : identifier(input.tenantId, 'Tenant');
    const tenantName = legacy ? null : requiredText(input.tenantName, 'Tenant name');
    const key = legacy ? prior.key : `${origin}|${tenantId}|${appId}`;
    if (prior && (prior.appId !== appId || prior.origin !== origin || (prior.tenantId && prior.tenantId !== tenantId))) throw new AppError('The selected app changed. Reload before saving.', 409);
    const target = apps.find(app => app.key === key);
    if (prior && target && prior.key !== target.key) throw new AppError('This app is already enabled for the tenant. Edit that entry instead.', 409);
    const existing = prior ?? target;
    if ((input.revision ?? 0) !== (existing?.revision ?? 0)) throw new AppError('App context changed in another window. Reload before saving.', 409);
    if (!Array.isArray(input.models) || !input.models.length || input.models.length > 100) throw new AppError('Select at least one connected model (up to 100).');
    const models = input.models.map(model => {
      const wid = identifier(model.workspaceId, 'Model workspace'), mid = identifier(model.modelId, 'Model');
      return { key: `${wid}:${mid}`, workspaceId: wid, modelId: mid, name: requiredText(model.name, 'Model name'), workspaceName: requiredText(model.workspaceName, 'Workspace name') };
    });
    if (new Set(models.map(model => model.key)).size !== models.length) throw new AppError('Duplicate connected models.');
    const app = { key, appId, origin, tenantId, tenantName, name: requiredText(input.name, 'App name', 300), models,
      context: requiredText(input.context, 'Business context', 60000), revision: (existing?.revision ?? 0) + 1, savedAt: new Date().toISOString(), discoveredAt: input.discoveredAt ?? existing?.discoveredAt ?? null };
    const previous = this.data;
    this.data = { ...previous, apps: [...apps.filter(item => item.key !== key && item.key !== existing?.key), app] };
    try { this.flush(); } catch (error) { this.data = previous; throw error; }
    return structuredClone(app);
  }
  removeApp(key, revision) {
    if (this.getApp(key).revision !== revision) throw new AppError('App context changed. Reload before removing.', 409);
    const previous = this.data;
    this.data = { ...previous, apps: this.listApps().filter(app => app.key !== key) };
    try { this.flush(); } catch (error) { this.data = previous; throw error; }
  }
  saveConnection(clientId) {
    const previous = this.data;
    this.data = { ...previous, anaplanClientId: requiredText(clientId, 'Anaplan OAuth client ID', 300), anaplanConnectionSavedAt: new Date().toISOString() };
    try { this.flush(); } catch (error) { this.data = previous; throw error; }
  }
  getLlm() {
    return structuredClone(this.data.llm ?? { provider: 'claude', model: '', revision: 1, savedAt: null, models: { claude: '', openai: '' } });
  }
  saveLlm({ provider, model, revision }) {
    const current = this.getLlm();
    if (!['claude', 'openai'].includes(provider) || typeof model !== 'string' || model.length > 120 || (model.trim() && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model.trim()))) throw new AppError('Choose OpenAI or Claude and a valid model name.');
    if (revision !== current.revision) throw new AppError('AI settings changed in another window. Reload them before saving.', 409);
    this.data.llm = { provider, model: model.trim(), revision: current.revision + 1, savedAt: new Date().toISOString(), models: { ...current.models, [provider]: model.trim() } };
    this.flush();
    return this.getLlm();
  }
  get(key) {
    const model = this.data.models.find(model => model.key === key);
    if (!model) throw new AppError('This model is not enabled. Add it in Admin first.', 404);
    return structuredClone(model);
  }
  save(input) {
    const workspaceId = identifier(input.workspaceId, 'Workspace');
    const modelId = identifier(input.modelId, 'Model');
    const key = `${workspaceId}:${modelId}`;
    const existing = this.data.models.find(model => model.key === key);
    if ((input.revision ?? 0) !== (existing?.revision ?? 0)) throw new AppError('Model context changed in another window. Reload it before saving.', 409);
    const model = {
      key, workspaceId, modelId,
      name: requiredText(input.name, 'Model name'),
      workspaceName: requiredText(input.workspaceName, 'Workspace name'),
      context: requiredText(input.context, 'Business context', 60000),
      revision: (existing?.revision ?? 0) + 1,
      savedAt: new Date().toISOString(),
    };
    this.data.models = [...this.data.models.filter(item => item.key !== key), model];
    this.flush();
    return structuredClone(model);
  }
  remove(key, revision) {
    if (this.get(key).revision !== revision) throw new AppError('Model context changed. Reload before removing.', 409);
    this.data.models = this.data.models.filter(model => model.key !== key);
    this.flush();
  }
}
