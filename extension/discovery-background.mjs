/*
 * Copyright 2026 Lara Srinath
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { discoveryInput } from './discovery-input.mjs';
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
