// This module operates only inside the offscreen extension document.
export function frameTransport(origin, jobId, signal, { document = globalThis.document, chromeApi = globalThis.chrome } = {}) {
  const frame = document.createElement('iframe');
  frame.title = 'Background Anaplan discovery';
  frame.width = '1280'; frame.height = '900';
  const pending = new Map(), retiredDocuments = new Set();
  let port = null, readyDocument = null, everConnected = false, replied = false;
  let tenantProgress = null;
  let loadEvents = 0, connectionAttempts = 0, lastRejection = 'none', framePolicyBlocked = false;
  const loaded = () => { loadEvents++; };
  const policyViolation = event => { if (event.effectiveDirective === 'frame-src') framePolicyBlocked = true; };
  frame.addEventListener('load', loaded);
  document.addEventListener('securitypolicyviolation', policyViolation);
  // Only counters and fixed codes: never page URLs, account details or tokens.
  const diagnostic = () => `Reader v3: load-events=${loadEvents}, connections=${connectionAttempts}, rejected=${lastRejection}, frame-policy=${framePolicyBlocked ? 'blocked' : 'clear'}.`;
  const stopPending = () => { for (const finish of [...pending.values()]) finish(null); };
  const disconnect = () => { const old = port; port = null; old?.disconnect(); stopPending(); };
  const receive = candidate => {
    if (!candidate.name?.startsWith('xanaplan-discovery-frame-')) return;
    connectionAttempts++;
    const documentId = candidate.name.match(/^xanaplan-discovery-frame-v3:([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i)?.[1];
    const sender = candidate.sender;
    let senderOrigin;
    try { senderOrigin = new URL(sender?.url).origin; } catch {}
    // Authenticate with Chrome's extension ID, origin and no-tab metadata.
    // documentId is an isolated-reader instance ID for navigation freshness,
    // not an authorization credential. Chrome's optional sender.documentId is
    // absent for offscreen frames (message_service.cc only fills it for tabs).
    const rejection = sender?.id !== chromeApi.runtime.id ? 'extension'
      : sender.tab ? 'visible-tab'
      : senderOrigin !== origin || (sender.origin && sender.origin !== origin) ? 'origin'
      : !documentId ? 'reader-version'
      : retiredDocuments.has(documentId) ? 'retired-document' : null;
    if (rejection || signal.aborted) { lastRejection = rejection || 'cancelled'; candidate.disconnect(); return; }
    if (readyDocument && readyDocument !== documentId) retiredDocuments.add(readyDocument);
    disconnect(); readyDocument = documentId; port = candidate; everConnected = true;
    candidate.onMessage.addListener(data => {
      if (port !== candidate || data?.jobId !== jobId) return;
      const finish = pending.get(data.requestId);
      if (!finish) return;
      replied = true;
      if (data.result?.kind === 'tenant-pending') tenantProgress = data.result;
      else if (data.result?.kind === 'tenants') tenantProgress = null;
      finish({ documentId, result: data.result });
    });
    candidate.onDisconnect.addListener(() => {
      void chromeApi.runtime.lastError;
      if (port === candidate) { port = null; stopPending(); }
    });
  };
  chromeApi.runtime.onConnect.addListener(receive);
  signal.addEventListener('abort', stopPending, { once: true });
  return {
    navigate(url) {
      if (new URL(url).origin !== origin) throw new Error('Invalid discovery destination.');
      if (readyDocument) retiredDocuments.add(readyDocument);
      disconnect(); readyDocument = null; tenantProgress = null; frame.src = url;
      if (!frame.isConnected) document.body.append(frame);
    },
    inspect(action, args) {
      if (signal.aborted || !port) return Promise.resolve(null);
      return new Promise(resolve => {
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => finish(null), 1200);
        const finish = value => { clearTimeout(timer); pending.delete(requestId); resolve(value); };
        pending.set(requestId, finish);
        try { port.postMessage({ target: 'xanaplan-discovery-frame', jobId, requestId, action, ...args }); }
        catch { finish(null); disconnect(); }
      });
    },
    timeoutMessage(mode) {
      if (framePolicyBlocked) return `Chrome blocked a page required for hidden Anaplan discovery. ${diagnostic()}`;
      if (!everConnected) return `The background reader did not connect. ${diagnostic()}`;
      if (!replied || !port) return `The Anaplan page disconnected while loading. ${diagnostic()}`;
      if (mode === 'tenants') {
        const messages = {
          'selector-missing': 'The background Anaplan page has not exposed its tenant selector.',
          'menu-missing': 'The tenant selector was found, but its menu did not appear.',
          'menu-not-visible': 'The tenant menu was found, but its options were not visible.',
          'items-unrecognized': 'The tenant menu opened, but its option identifiers could not be read.',
          'selection-unrecognized': 'The tenant list was read, but the active tenant could not be identified.',
        };
        const number = key => Number.isInteger(tenantProgress?.[key]) && tenantProgress[key] >= 0 ? tenantProgress[key] : 0;
        const page = ['apps', 'home'].includes(tenantProgress?.page) ? tenantProgress.page : 'other';
        const ready = ['loading', 'interactive', 'complete'].includes(tenantProgress?.ready) ? tenantProgress.ready : 'unknown';
        const message = Object.hasOwn(messages, tenantProgress?.stage) ? messages[tenantProgress.stage] : 'The tenant menu could not be read.';
        return `${message} Tenant reader: selector=${tenantProgress?.selector === true}, menu=${tenantProgress?.menu === true}, items=${number('totalItems')}, visible=${number('visibleItems')}, parsed=${number('parsedItems')}, selected=${number('selectedItems')}, page=${page}, ready=${ready}.`;
      }
      return mode === 'models' ? 'Anaplan loaded, but this app’s connected models could not be read. Check that your account can use Manage app → Show models, then refresh connected models.' : 'Anaplan loaded, but its app list could not be read. Refresh apps for the selected tenant.';
    },
    close() {
      disconnect(); frame.remove(); chromeApi.runtime.onConnect.removeListener(receive);
      frame.removeEventListener('load', loaded); document.removeEventListener('securitypolicyviolation', policyViolation);
      signal.removeEventListener('abort', stopPending);
    },
  };
}
