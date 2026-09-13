(() => {
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
  // Only our hidden document may drive this reader. Ordinary tabs and Anaplan's
  // nested Application content frames do not connect or receive commands.
  if (window.top === window || location.ancestorOrigins?.[0] !== extensionOrigin) return;
  // Chrome can omit sender.documentId for frames outside a browser tab. Keep
  // a per-document ID in this isolated world, carried only on the native port.
  const documentId = crypto.randomUUID();
  const port = chrome.runtime.connect({ name: `xanaplan-discovery-frame-v3:${documentId}` });
  port.onDisconnect.addListener(() => { void chrome.runtime.lastError; });
  port.onMessage.addListener(message => {
    if (message?.target !== 'xanaplan-discovery-frame' || !/^[a-f0-9-]{36}$/i.test(message.jobId ?? '') || !/^[a-f0-9-]{36}$/i.test(message.requestId ?? '')) return;
    const { inspectTenantDocument, inspectAppDocument } = globalThis.XanaplanDiscoveryDOM;
    let result = null;
    try {
      if (message.action === 'tenant' && /^[a-zA-Z0-9_-]{0,80}$/.test(message.tenantId ?? '') && typeof message.allowSwitch === 'boolean') {
        result = inspectTenantDocument(message.tenantId, message.allowSwitch);
      } else if (message.action === 'catalog' || (message.action === 'models' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(message.appId ?? ''))) {
        const documents = [document];
        for (const frame of document.querySelectorAll('iframe[title="Application content"]')) {
          try { if (frame.contentDocument?.location.origin === location.origin) documents.push(frame.contentDocument); } catch { /* Still loading or signed out. */ }
        }
        for (const doc of documents) {
          result = inspectAppDocument(message.action, message.appId, doc);
          if (result) break;
        }
      } else return;
      port.postMessage({ jobId: message.jobId, requestId: message.requestId, result });
    } catch {
      // Navigation may tear down the port while a response is being sent.
    }
  });
})();
