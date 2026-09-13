import { runDiscovery, discoveryInput } from './discovery-runner.mjs';

import { frameTransport } from './discovery-frame.mjs';

let active;
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || (sender.url && sender.url !== chrome.runtime.getURL('background.js')) || message?.target !== 'discovery-offscreen') return;
  if (message.action === 'cancel') {
    if (active?.jobId === message.jobId) {
      active.controller.abort(); active.done.then(() => reply({ ok: true }));
      return true;
    }
    reply({ ok: true }); return;
  }
  if (message.action !== 'start') return;
  if (active) { reply({ ok: false, error: 'Another background discovery is still finishing. Retry in a moment.' }); return; }
  const controller = new AbortController(), job = { jobId: message.jobId, controller };
  active = job;
  const heartbeat = setInterval(() => chrome.runtime.sendMessage({ target: 'discovery-heartbeat' }).catch(() => {}), 15000);
  job.done = (async () => {
    try {
      const input = discoveryInput(message.input);
      const result = await runDiscovery(input, frameTransport(input.origin, job.jobId, controller.signal), { signal: controller.signal });
      return { ok: true, result };
    } catch (error) { return { ok: false, error: error.message }; }
    finally { clearInterval(heartbeat); if (active === job) active = null; }
  })();
  job.done.then(reply);
  return true;
});
