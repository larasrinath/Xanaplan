import { discoveryInput } from './discovery-input.mjs';

// Routes and field names come from Anaplan's web clients; see docs/discovery-api.md.
// All requests are read-only and use Chrome's own session cookie handling.
const CUSTOMERS = '/a/springboard-platform-gateway-service/customers';
const DEFINITION = '/a/springboard-definition-service';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const TENANT_ID = /^[a-zA-Z0-9_-]{1,80}$/;
const MODEL_ID = /^[a-f0-9]{32}$/i;
const MAX_BYTES = 16 * 1024 * 1024;
const failure = (message, code = 'ANAPLAN_DISCOVERY_FAILED') => Object.assign(new Error(message), { code });
const malformed = resource => failure(`Anaplan returned an unrecognized ${resource} response. No app was enabled.`);
function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason?.name === 'TimeoutError' ? signal.reason : new DOMException('Discovery cancelled', 'AbortError');
}
function label(value, resource) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw malformed(resource);
  return value.trim();
}
function rows(value, resource, limit = 10000) {
  if (!Array.isArray(value) || value.length > limit) throw malformed(resource);
  return value;
}
function requireComplete(data, count, resource) {
  const totals = [data.totalCount, data.totalElements, data.total, data.pagination?.totalCount];
  if (totals.some(total => typeof total === 'number' && total > count) || data.hasMore === true || data.next || data.links?.next || data.pagination?.hasMore === true) {
    throw failure(`Anaplan returned an incomplete ${resource} list. No app was enabled.`);
  }
}

async function requestJson(origin, path, resource, { signal, fetchImpl, requestTimeout, apiVersion = '1' }) {
  checkAbort(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeout);
  try {
    const response = await fetchImpl(origin + path, {
      method: 'GET', credentials: 'include', redirect: 'manual', cache: 'no-store',
      headers: { Accept: 'application/json', 'x-api-version': apiVersion }, signal: controller.signal,
    });
    checkAbort(signal);
    if (response.status === 401 || response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw failure('Sign in to Anaplan in this Chrome profile, then refresh tenants.', 'ANAPLAN_BROWSER_LOGIN');
    }
    if (response.status === 403) throw failure(`Anaplan denied access to ${resource} for this Chrome session. Check that this browser account has access.`, 'ANAPLAN_BROWSER_FORBIDDEN');
    if (!response.ok) throw failure(`Anaplan could not return ${resource} (HTTP ${response.status}). Retry in a moment.`);
    if (!/\bapplication\/json\b/i.test(response.headers.get('content-type') || '')) {
      throw failure('Anaplan returned a sign-in page instead of data. Sign in in this Chrome profile, then refresh tenants.', 'ANAPLAN_BROWSER_LOGIN');
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw failure(`The Anaplan ${resource} response is too large to read safely.`);
    const reader = response.body?.getReader();
    if (!reader) throw malformed(resource);
    const decoder = new TextDecoder(); let bytes = 0, body = '';
    try {
      while (true) {
        const { value, done } = await reader.read(); checkAbort(signal);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) throw failure(`The Anaplan ${resource} response is too large to read safely.`);
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
    let data;
    try { data = JSON.parse(body); } catch { throw malformed(resource); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw malformed(resource);
    return data;
  } catch (error) {
    checkAbort(signal);
    if (timedOut) throw failure(`Anaplan took too long to return ${resource}. Retry in a moment.`);
    if (typeof error?.code === 'string' && error.code.startsWith('ANAPLAN_')) throw error;
    // Never forward response bodies, redirect URLs or raw network errors to the panel.
    throw failure(`Could not request ${resource} from Anaplan. Check the connection and Xanaplan's site access in this Chrome profile.`);
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}

function readTenants(data) {
  const customers = rows(data.customers, 'tenant'); requireComplete(data, customers.length, 'tenant');
  const seen = new Set();
  const items = customers.map(customer => {
    if (typeof customer?.customerGuid !== 'string' || !TENANT_ID.test(customer.customerGuid) || seen.has(customer.customerGuid)) throw malformed('tenant');
    seen.add(customer.customerGuid);
    return { id: customer.customerGuid, name: label(customer.customerName, 'tenant'), selected: customer.selectedCustomer === true };
  });
  if (!items.length) throw failure('This Anaplan browser account has no accessible tenants.');
  const selected = items.filter(item => item.selected);
  if (selected.length > 1) throw malformed('tenant');
  return { items, selectedId: selected[0]?.id || '' };
}

function readCatalog(data, tenantId) {
  if (data.customerId !== undefined && data.customerId !== tenantId) throw failure('Anaplan returned apps for a different tenant. Refresh tenants.');
  const apps = rows(data.items, 'app'); requireComplete(data, apps.length, 'app');
  const seen = new Set();
  return apps.map(app => {
    if (typeof app?.guid !== 'string' || !UUID.test(app.guid) || seen.has(app.guid.toLowerCase()) || (app.customerId !== undefined && app.customerId !== tenantId)) throw malformed('app');
    seen.add(app.guid.toLowerCase());
    return { id: app.guid.toLowerCase(), name: label(app.name, 'app') };
  });
}

function requireAppTenant(data, tenantId, appId) {
  if (data.customerId !== tenantId || (data.guid !== undefined && (typeof data.guid !== 'string' || data.guid.toLowerCase() !== appId.toLowerCase()))) {
    throw failure('The app no longer belongs to the selected tenant or is unavailable. Refresh apps.');
  }
}

function readModels(data, tenantId) {
  if (data.customerId !== undefined && data.customerId !== tenantId) throw failure('Anaplan returned model connections for a different tenant. Refresh apps.');
  const pages = rows(data.pages, 'connected-model'); requireComplete(data, pages.length, 'connected-model');
  const found = new Map();
  for (const page of pages) {
    const models = rows(page?.models, 'connected-model', 100); requireComplete(page, models.length, 'connected-model');
    for (const model of models) {
      if (typeof model?.modelId !== 'string' || !MODEL_ID.test(model.modelId)) throw malformed('connected-model');
      const value = { id: model.modelId.toUpperCase(), name: label(model.modelName, 'connected-model'), workspaceName: label(model.workspaceName, 'connected-model') };
      const existing = found.get(value.id);
      if (existing && (existing.name !== value.name || existing.workspaceName !== value.workspaceName)) throw failure('Anaplan returned conflicting details for a connected model. Refresh connected models.');
      found.set(value.id, value);
      if (found.size > 100) throw failure('This app has more than 100 connected models, which is not supported yet.');
    }
  }
  if (!found.size) throw failure('Anaplan returned no connected models for this app.');
  return [...found.values()];
}

export async function readAnaplanDiscovery(value, { signal, fetchImpl = globalThis.fetch, requestTimeout = 15000 } = {}) {
  const { origin, tenantId, appId } = discoveryInput(value);
  const get = (path, resource, apiVersion) => requestJson(origin, path, resource, { signal, fetchImpl, requestTimeout, apiVersion });
  const tenants = readTenants(await get(CUSTOMERS, 'tenants'));
  checkAbort(signal);
  if (!tenantId) return { kind: 'tenants', origin, ...tenants };
  const tenant = tenants.items.find(item => item.id === tenantId);
  if (!tenant) throw failure('The selected tenant is no longer available to this browser account. Refresh tenants.');
  const scope = { origin, tenantId, tenantName: tenant.name };
  if (!appId) {
    const items = readCatalog(await get(`${DEFINITION}/customer/${encodeURIComponent(tenantId)}/apps`, 'apps'), tenantId);
    checkAbort(signal);
    return { kind: 'catalog', ...scope, items, discoveredAt: new Date().toISOString() };
  }
  const details = `${DEFINITION}/apps/${encodeURIComponent(appId)}?includeUnpublished=true&includeReportPages=true`;
  requireAppTenant(await get(details, 'app details', '2'), tenantId, appId);
  const data = await get(`${DEFINITION}/pagemodels/app/${encodeURIComponent(appId)}?includeReportPages=true&includeArchived=false`, 'connected models');
  const models = readModels(data, tenantId);
  requireAppTenant(await get(details, 'app details', '2'), tenantId, appId);
  checkAbort(signal);
  return { kind: 'models', ...scope, models, discoveredAt: new Date().toISOString() };
}
