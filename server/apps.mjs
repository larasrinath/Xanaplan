import { AppError, identifier, requiredText } from './validation.mjs';

// Browser discovery supplies app membership; the authenticated MCP independently
// resolves and verifies every model ID. Names are never authorization IDs.
export async function verifyAppDiscovery(input, mcp) {
  const tenantId = identifier(input.tenantId, 'Tenant');
  const tenantName = requiredText(input.tenantName, 'Tenant name');
  const appId = identifier(input.appId, 'App');
  const origin = requiredText(input.origin, 'Anaplan site', 200);
  if (!/^https:\/\/[a-z0-9-]+\.app\.anaplan\.com$/i.test(origin)) throw new AppError('Invalid Anaplan site.');
  const name = requiredText(input.name, 'App name', 300);
  if (!Array.isArray(input.models) || !input.models.length || input.models.length > 100) throw new AppError('No complete connected-model list was found (maximum 100 models).');
  const workspaces = await mcp.discover('show_workspaces');
  if (workspaces.incomplete) throw new AppError('The workspace list is incomplete. App discovery cannot safely resolve these model connections.', 422);
  const verified = [], lists = new Map();
  for (const observed of input.models) {
    const modelId = identifier(observed.id, 'Connected model');
    const workspaceName = requiredText(observed.workspaceName, 'Connected workspace name');
    const candidates = workspaces.items.filter(workspace => workspace.name === workspaceName);
    if (candidates.length !== 1) throw new AppError(`Cannot uniquely resolve the workspace for ${requiredText(observed.name, 'Model name')}. Use the same Anaplan account in Chrome and the helper.`, 403);
    const workspace = candidates[0];
    if (!lists.has(workspace.id)) lists.set(workspace.id, await mcp.discover('show_models', { workspaceId: workspace.id }));
    const result = lists.get(workspace.id);
    if (result.incomplete) throw new AppError('The model list is incomplete. No app was enabled; narrow the discovery before continuing.', 422);
    const model = result.items.find(model => model.id === modelId);
    if (!model) throw new AppError(`A connected model is not accessible through the helper in ${workspace.name}. Check the account and model access.`, 403);
    if (verified.some(item => item.modelId === modelId)) throw new AppError('Duplicate models in app discovery. Reload the app list.', 422);
    verified.push({ key: `${workspace.id}:${modelId}`, modelId, workspaceId: workspace.id, name: model.name, workspaceName: workspace.name });
  }
  return { appId, origin, name, tenantId, tenantName, models: verified, discoveredAt: new Date().toISOString() };
}
