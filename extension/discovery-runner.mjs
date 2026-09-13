export function appOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.app\.anaplan\.com$/i.test(url.hostname) || url.port || url.username || url.password) throw new Error('Use an HTTPS Anaplan app address.');
  return url.origin;
}

export function discoveryInput({ origin, tenantId = '', appId = '' }) {
  origin = appOrigin(origin);
  if (typeof tenantId !== 'string' || (tenantId && !/^[a-zA-Z0-9_-]{1,80}$/.test(tenantId))) throw new Error('Select a tenant from the list.');
  if (typeof appId !== 'string' || (appId && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(appId))) throw new Error('Select an app from the list.');
  if (appId && !tenantId) throw new Error('Select a tenant before choosing an app.');
  return { origin, tenantId, appId };
}

export function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Discovery cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

// The transport owns a hidden iframe. Tests supply the same boundary without a browser.
export async function runDiscovery(input, transport, { signal, timeout = 45000, interval = 700 } = {}) {
  const { origin, tenantId, appId } = discoveryInput(input);
  const mode = !tenantId ? 'tenants' : appId ? 'models' : 'catalog';
  let phase = 'tenants';
  const deadline = Date.now() + timeout;
  const check = () => {
    if (signal?.aborted) throw new DOMException('Discovery cancelled', 'AbortError');
    if (Date.now() >= deadline) throw new Error(transport.timeoutMessage?.(phase) || 'Could not load Anaplan in the background. Check that you are signed in to Anaplan in this Chrome profile, then retry.');
  };
  try {
    check();
    await transport.navigate(`${origin}/a/apps`);
    let tenants, switchRequested = false, previousDocument;
    while (!tenants) {
      check();
      const sample = await transport.inspect('tenant', { tenantId, allowSwitch: !switchRequested });
      const result = sample?.result;
      if (result?.kind === 'tenant-error') throw new Error(result.message);
      if (result?.kind === 'tenant-switching') switchRequested = true;
      if (result?.kind === 'tenants' && (!tenantId || result.selectedId === tenantId)) {
        tenants = result; previousDocument = sample.documentId;
      }
      if (!tenants) await pause(interval, signal);
    }
    if (mode === 'tenants') return { ...tenants, origin };
    const tenant = tenants.items.find(item => item.id === tenantId);
    if (!tenant) throw new Error('The selected tenant is no longer available. Reload tenants.');
    phase = mode;
    const navigate = switchRequested || Boolean(appId);
    if (navigate) await transport.navigate(`${origin}/a/apps${appId ? `/app/${appId}` : ''}`);
    let stable = '', count = 0;
    while (true) {
      check();
      const sample = await transport.inspect(mode, { appId });
      // Do not accept the previous document while navigation is still pending.
      if (navigate && (!sample?.documentId || sample.documentId === previousDocument)) { await pause(interval, signal); continue; }
      const found = sample?.result;
      if (found?.kind === mode) {
        const value = JSON.stringify(found);
        count = value === stable ? count + 1 : 1; stable = value;
        if (count >= 3) {
          const current = await transport.inspect('tenant', { tenantId, allowSwitch: false });
          if (!current?.result) { await pause(interval, signal); continue; }
          if (current.documentId !== sample.documentId || current.result.kind !== 'tenants' || current.result.selectedId !== tenantId) throw new Error('The active Anaplan tenant changed during discovery. Reload apps for your selected tenant.');
          return { ...found, origin, tenantId: tenant.id, tenantName: tenant.name, discoveredAt: new Date().toISOString() };
        }
      } else { stable = ''; count = 0; }
      await pause(interval, signal);
    }
  } finally { await transport.close(); }
}
