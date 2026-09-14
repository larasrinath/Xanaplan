import { AppError, requiredText } from './validation.mjs';
import { metadataTable, viewDimensions } from './page-metadata.mjs';

const objectId = value => /^\d{1,20}$/.test(String(value));
const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

// A name lookup can omit a visible member. Confirm it against the verified
// view's members before treating a captured selector as missing context.
export async function resolveContextItem({ read, dimensionId, label, itemId, view }) {
  if (!objectId(dimensionId) || (itemId != null && !objectId(itemId))) throw new AppError('Invalid selection identifier.', 422);
  const name = label == null ? '' : requiredText(label, 'Selection', 500);
  if (!name && !itemId) throw new AppError('A selection name or item is required.', 422);
  const match = (text, resolvedBy) => {
    const matches = metadataTable(text).filter(item => name ? normalize(item.Name) === normalize(name) : item.ID === itemId);
    if (matches.length > 1) throw new AppError(`The selection “${name || itemId}” matches more than one member.`, 422);
    if (!matches.length) return null;
    if (!objectId(matches[0].ID) || !matches[0].Name) throw new AppError('Selection metadata is incomplete.', 422);
    return { itemId: matches[0].ID, label: matches[0].Name, resolvedBy };
  };
  const tryRead = async (tool, args) => {
    try { return await read(tool, args); }
    catch (error) {
      // Lookup endpoint availability can differ from view metadata. Never retry
      // past access/cancellation errors, metadata limits or incomplete results.
      if (![400, 404, 405, 501, 502].includes(error.status)) throw error;
      return null;
    }
  };
  if (name) {
    const text = await tryRead('lookup_dimensionitems', { dimensionId, names: [name] });
    const result = text == null ? null : match(text, 'name lookup');
    if (result) return result;
  } else {
    const text = await tryRead('show_dimensionitems', { dimensionId, search: itemId, limit: 1000 });
    const result = text == null ? null : match(text, 'dimension members');
    if (result) return result;
  }
  if (view) {
    const text = view.dimensions ? null : await tryRead('show_viewdetails', { moduleId: view.moduleId, viewId: view.viewId });
    const dimensions = view.dimensions || (text == null ? null : viewDimensions(text, view.viewId));
    if (dimensions && Object.values(dimensions).flat().some(dimension => dimension.id === dimensionId)) {
      const members = await tryRead('show_viewdimensionitems', { viewId: view.viewId, dimensionId, search: name || itemId, limit: 1000 });
      const result = members == null ? null : match(members, 'view members');
      if (result) return result;
    }
  }
  const text = name ? await tryRead('show_dimensionitems', { dimensionId, search: name, limit: 1000 }) : null;
  const result = text == null ? null : match(text, 'dimension members');
  if (result) return result;
  throw new AppError(`The selection “${name || itemId}” could not be verified in the available members.`, 422);
}
