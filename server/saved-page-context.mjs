import { AppError } from './validation.mjs';

const unavailable = message => { throw new AppError(`${message} Continue on the current page instead.`, 422); };

// Restore only the helper's stored snapshot, never a browser-supplied filter set.
export function savedPageContext(conversations, input, app) {
  const record = conversations.get(input.savedConversationId);
  if (record.revision !== input.savedConversationRevision) throw new AppError('This chat changed. Reopen it from History before restoring its page.', 409);
  if (record.app.key !== app.key) unavailable('The saved chat belongs to a different app.');
  const context = record.messages.findLast(message => message.role === 'assistant')?.pageContext;
  if (!context?.sources?.length || !context.model?.key) unavailable('This chat has no saved page selections.');
  if (context.page.id !== input.definition?.page?.id || context.page.type !== input.definition?.page?.type) unavailable('The saved page is no longer available.');
  if (context.definitionRevision && context.definitionRevision !== input.definition.definitionRevision) unavailable('The published page changed since this chat was saved.');
  if (context.sources.some(source => !Array.isArray(source.filters) || !Array.isArray(source.missing))) unavailable('The saved page context is incomplete.');
  return context;
}

export function checkRestoredContext(saved, current) {
  const shape = source => JSON.stringify({
    moduleIds: [...source.moduleIds].sort(), viewId: source.viewId || '', lineItemId: source.lineItemId || '',
    query: source.query || null, options: source.options || [], dimensions: source.dimensions || null,
  });
  const filters = source => JSON.stringify(source.filters.map(({ dimensionId, itemId }) => [dimensionId, itemId]).sort());
  if (saved.sources.length !== current.sources.length) unavailable('The page’s cards changed since this chat was saved.');
  for (const source of current.sources) {
    const original = saved.sources.find(item => item.id === source.id);
    if (!original || shape(original) !== shape(source) || filters(original) !== filters(source)) unavailable('The saved cards or selections could not be verified.');
    // Unknown selections are part of the saved context, not a reason to lose
    // the conversation. Keep the original limitations across ticket renewals.
    const missing = original.savedMissing || original.missing;
    if (missing.length) {
      source.savedMissing = [...missing];
      source.missing = [...new Set([...source.missing, ...missing])];
    }
    // A saved limitation cannot become an exact-card read by restoring it.
    source.unsupported ||= original.unsupported;
  }
}
