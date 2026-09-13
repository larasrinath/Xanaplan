import { discoveryInput } from './discovery-runner.mjs';
import { readAnaplanDiscovery } from './discovery-api.mjs';

export function createDiscoveryService(chromeApi, { read = readAnaplanDiscovery, timeout = 55000 } = {}) {
  let active;
  return async function handle(message, sender) {
    if (sender.id !== chromeApi.runtime.id || sender.url !== chromeApi.runtime.getURL('panel.html')) throw new Error('Discovery can only be started from the Xanaplan panel.');
    if (!/^[a-f0-9-]{36}$/i.test(message.jobId ?? '')) throw new Error('Invalid discovery request.');
    if (message.action === 'cancel') {
      if (active?.jobId === message.jobId) active.controller.abort();
      return { ok: true };
    }
    if (message.action !== 'start') throw new Error('Unknown discovery action.');
    const input = discoveryInput(message.input);
    active?.controller.abort();
    const job = { jobId: message.jobId, controller: new AbortController() }; active = job;
    const { signal } = job.controller;
    let abort;
    const stopped = new Promise((_, reject) => {
      abort = () => reject(signal.reason?.name === 'TimeoutError' ? signal.reason : new DOMException('Discovery cancelled', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
    });
    const timer = setTimeout(() => job.controller.abort(new DOMException('Anaplan discovery timed out. Retry in a moment.', 'TimeoutError')), timeout);
    try {
      const result = await Promise.race([read(input, { signal }), stopped]);
      if (signal.aborted) throw new DOMException('Discovery cancelled', 'AbortError');
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: error.message, ...(typeof error.code === 'string' && error.code.startsWith('ANAPLAN_') ? { code: error.code } : {}) };
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (active === job) active = null;
    }
  };
}
