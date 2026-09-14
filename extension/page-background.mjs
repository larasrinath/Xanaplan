import { readPageDefinition } from './page-api.mjs';
import { observeTab } from './page-observer.mjs';

export function createPageService(chromeApi, { read = readPageDefinition, observe = observeTab } = {}) {
  const jobs = new Map();
  return async (message, sender) => {
    if (sender.id !== chromeApi.runtime.id || sender.url !== chromeApi.runtime.getURL('panel.html')) throw new Error('Page context is available only to the Xanaplan panel.');
    if (message.action === 'observe') return { ok: true, result: await observe(chromeApi) };
    if (!/^[a-f0-9-]{36}$/i.test(message.jobId || '')) throw new Error('Invalid page request.');
    if (message.action === 'cancel') { jobs.get(message.jobId)?.abort(); return { ok: true }; }
    if (message.action !== 'read') throw new Error('Unknown page action.');
    if (jobs.size >= 5) throw new Error('Too many page reads. Retry in a moment.');
    const controller = new AbortController(); jobs.set(message.jobId, controller);
    const timer = setTimeout(() => controller.abort(), 55000);
    let abort;
    const stopped = new Promise((_, reject) => {
      abort = () => reject(new Error('Page discovery stopped or timed out. Refresh to retry.'));
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    try { return { ok: true, result: await Promise.race([read(message.input, { signal: controller.signal }), stopped]) }; }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); jobs.delete(message.jobId); }
  };
}
