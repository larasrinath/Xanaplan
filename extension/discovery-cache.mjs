import { discoveryInput } from './discovery-input.mjs';

const STORAGE_KEY = 'xanaplan.discovery-cache.v1';
const keyFor = input => `${input.origin}|${input.tenantId || '@tenants'}`;

// Only names/IDs for dropdowns are cached. Authorization, models and tickets
// always go through the live connection. Lists have no expiry or eviction timer;
// only successful explicit refreshes replace them. Connection resets clear them.
// Keep the existing storage format so already-saved catalogs remain available.
export function createDiscoveryCache({ storage = () => globalThis.localStorage, now = Date.now } = {}) {
  const read = () => {
    try {
      const value = JSON.parse(storage()?.getItem(STORAGE_KEY) || 'null');
      if (value?.version === 1 && Array.isArray(value.entries) && typeof value.generation === 'string') return { ...value, entries: value.entries.filter(entry => entry && typeof entry.key === 'string' && entry.result && typeof entry.cachedAt === 'number') };
    } catch { /* Storage unavailable or corrupt: continue with live discovery. */ }
    return { version: 1, generation: '', entries: [] };
  };
  const save = value => {
    try { const target = storage(); if (!target) return false; target.setItem(STORAGE_KEY, JSON.stringify(value)); return true; }
    catch { return false; }
  };
  const validTime = entry => Number.isFinite(entry.cachedAt) && entry.cachedAt >= 0;
  function clean(input, result) {
    if (input.appId || result?.origin !== input.origin || !Array.isArray(result?.items) || result.items.length > 10000) return null;
    const kind = input.tenantId ? 'catalog' : 'tenants';
    if (result.kind !== kind || (kind === 'catalog' && (result.tenantId !== input.tenantId || typeof result.tenantName !== 'string'))) return null;
    const items = result.items.map(item => ({ id: item?.id, name: item?.name, ...(kind === 'tenants' ? { selected: item?.selected === true } : {}) }));
    if (items.some(item => typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 2000)) return null;
    if (new Set(items.map(item => item.id)).size !== items.length) return null;
    if (kind === 'tenants' && (!items.length || (result.selectedId ? !items.some(item => item.id === result.selectedId && item.selected) : items.some(item => item.selected)))) return null;
    return { kind, origin: input.origin, items, ...(kind === 'tenants' ? { selectedId: result.selectedId } : { tenantId: input.tenantId, tenantName: result.tenantName }) };
  }
  return {
    begin(value, refresh = false) {
      const input = discoveryInput(value), data = read(), key = keyFor(input);
      if (refresh && !input.appId) {
        // Invalidate pending writes, not saved lists. A failed refresh must not
        // destroy the last good catalog, nor force other tenants to reload.
        data.generation = crypto.randomUUID(); save(data);
      }
      const entry = !input.appId && data.entries.find(entry => entry.key === key && validTime(entry));
      const result = entry && clean(input, entry.result);
      const previous = result ? { ...result, cache: { hit: true, stored: true, cachedAt: entry.cachedAt } } : null;
      return { generation: data.generation, result: refresh ? null : previous, previous };
    },
    put(value, result, generation) {
      const input = discoveryInput(value), safe = clean(input, result), data = read();
      if (!safe || data.generation !== generation) return;
      const key = keyFor(input);
      data.entries = data.entries.filter(entry => entry.key !== key && validTime(entry));
      const cachedAt = now();
      data.entries.push({ key, cachedAt, result: safe });
      return { hit: false, cachedAt, stored: save(data) };
    },
    clear() { save({ version: 1, generation: crypto.randomUUID(), entries: [] }); },
  };
}

export const discoveryCache = createDiscoveryCache();
export const clearDiscoveryCache = () => discoveryCache.clear();
