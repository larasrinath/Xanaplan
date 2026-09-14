import { AppError, requiredText } from './validation.mjs';
import { createPageScope, pageTools } from './page-scope.mjs';

export async function answerQuestion({ store, mcp, provider, input, signal, pageContext }) {
  const scope = input.appKey ? store.getApp(input.appKey) : store.get(input.modelKey);
  const models = input.appKey ? scope.models.filter(model => !pageContext || model.key === pageContext.model.key) : [scope];
  if (pageContext && models.length !== 1) throw new AppError('The page model is no longer enabled.', 409);
  const latest = () => input.appKey ? store.getApp(scope.key) : store.get(scope.key);
  if (input.revision !== scope.revision) throw new AppError('The business context was updated. Refresh before asking.', 409);
  const question = requiredText(input.question, 'Question', 4000);
  const history = Array.isArray(input.history) ? input.history.slice(-8).map(turn => ({
    role: turn.role === 'assistant' ? 'assistant' : 'user', text: requiredText(turn.text, 'Conversation message', 12000),
  })) : [];
  const catalog = await mcp.tools();
  const toolCatalog = (pageContext ? pageTools(catalog) : catalog).map(tool => {
    const schema = structuredClone(tool.inputSchema);
    delete schema.properties.workspaceId; delete schema.properties.modelId;
    schema.required = (schema.required ?? []).filter(key => !['workspaceId', 'modelId'].includes(key));
    if (input.appKey) {
      schema.properties.modelKey = { type: 'string', enum: models.map(model => model.key), description: 'One of this app’s enabled connected models.' };
      schema.required.push('modelKey');
    }
    return { name: tool.name, description: tool.description, inputSchema: schema };
  });
  const evidence = [], sources = [];
  const pageScope = pageContext ? createPageScope(pageContext, { mcp, model: models[0], signal, question }) : null;
  const payload = { ...(input.appKey ? { app: { name: scope.name, context: scope.context, contextRevision: scope.revision, models: models.map(({ key, name, workspaceName }) => ({ key, name, workspaceName })) } } : { model: { name: scope.name, context: scope.context, contextRevision: scope.revision } }), question, history, tools: toolCatalog, evidence };
  if (pageContext) payload.pageContext = pageContext;
  let readCount = 0, totalChars = 0;
  while (readCount <= 10) {
    if (signal?.aborted) throw new AppError('Question cancelled.', 499);
    if (latest().revision !== scope.revision) throw new AppError('Business context changed during this question. Ask again using the updated context.', 409);
    const decision = await provider.decide({ ...payload, readsRemaining: 10 - readCount }, signal);
    if (signal?.aborted) throw new AppError('Question cancelled.', 499);
    if (decision.kind === 'answer') {
      if (!decision.answer.trim()) throw new AppError('The AI provider returned an empty answer.', 502);
      if (latest().revision !== scope.revision) throw new AppError('Context changed while answering. Ask again.', 409);
      const cited = sources.filter(source => decision.sourceIds.includes(source.id));
      return { answer: decision.answer, sources: cited.length ? cited : sources, revision: scope.revision, ...(pageContext ? { pageContext } : {}), ...(input.appKey ? { appKey: scope.key } : { modelKey: scope.key }), answeredAt: new Date().toISOString() };
    }
    if (readCount === 10) throw new AppError('This question needs more data than one local request can retrieve. Try a specific KPI, period or business unit.', 422);
    let args;
    try { args = JSON.parse(decision.arguments); } catch { throw new AppError('The AI provider requested invalid read arguments. Please retry.', 502); }
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new AppError('Tool arguments must be an object.', 502);
    if (pageContext) {
      const tool = toolCatalog.find(tool => tool.name === decision.tool);
      if (!tool || Object.keys(args).some(key => !Object.hasOwn(tool.inputSchema.properties, key))) throw new AppError('This read is outside the page tool contract.', 403);
    }
    const model = input.appKey ? models.find(model => model.key === args.modelKey) : scope;
    if (!model) throw new AppError('A question can only access the app’s enabled connected models.', 403);
    if (input.appKey) delete args.modelKey;
    readCount++;
    let read;
    try {
      if (!toolCatalog.some(tool => tool.name === decision.tool)) throw new AppError('This tool is outside the current page context.', 403);
      read = await pageScope?.execute(decision.tool, args);
      read ??= await mcp.read(decision.tool, args, model, signal);
    }
    catch (error) {
      if ([401, 403, 409, 499, 503].includes(error.status)) throw error;
      evidence.push({ id: readCount, modelKey: model.key, modelName: model.name, tool: decision.tool, error: error.message });
      continue;
    }
    const remaining = Math.max(0, 110000 - totalChars);
    const cap = Math.min(45000, remaining);
    const truncated = read.text.length > cap;
    const text = read.text.slice(0, cap);
    totalChars += text.length;
    const source = { id: readCount, modelKey: model.key, modelName: model.name, workspaceName: model.workspaceName, tool: decision.tool, arguments: read.arguments, readAt: new Date().toISOString(), partial: truncated || read.partial === true || /_truncated|more not shown/i.test(read.text), rowLimit: read.arguments.maxRows ?? null };
    for (const key of ['page', 'card', 'effectiveFilters', 'pendingFilters', 'coverage', 'dependencyPaths', 'contextFingerprint']) if (read[key]) source[key] = read[key];
    evidence.push({ ...source, text, ...(truncated ? { warning: 'Evidence is truncated. Do not compute whole-model totals or rankings from it.' } : {}) });
    sources.push(source);
  }
}
