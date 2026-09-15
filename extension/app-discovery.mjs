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
import { discoveryCache } from './discovery-cache.mjs';
export { clearDiscoveryCache } from './discovery-cache.mjs';
export { appOrigin } from './discovery-input.mjs';

// The panel never creates a browser tab for discovery, including error paths.
export async function discoverApps({ origin, tenantId, appId, signal, refresh = false, cache = discoveryCache, chromeApi = globalThis.chrome }) {
  if (!chromeApi?.runtime?.sendMessage) throw new Error('Open Xanaplan from the installed Chrome extension, then reload it to enable background discovery.');
  const input = discoveryInput({ origin, tenantId, appId });
  if (signal?.aborted) throw new DOMException('Discovery cancelled', 'AbortError');
  const cached = cache.begin(input, refresh);
  if (cached.result) return cached.result;
  const jobId = crypto.randomUUID();
  const send = action => chromeApi.runtime.sendMessage({ target: 'discovery-background', action, jobId, ...(action === 'start' ? { input } : {}) });
  let timer, abort;
  const stopped = new Promise((_, reject) => {
    abort = () => { send('cancel').catch(() => {}); reject(new DOMException('Discovery cancelled', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    globalThis.addEventListener?.('pagehide', abort, { once: true });
    timer = setTimeout(() => {
      send('cancel').catch(() => {});
      reject(new Error('Background discovery timed out. Check Anaplan sign-in in Chrome, then retry.'));
    }, 65000);
  });
  try {
    const response = await Promise.race([send('start'), stopped]);
    if (signal?.aborted) throw new DOMException('Discovery cancelled', 'AbortError');
    if (!response?.ok) {
      if (['ANAPLAN_BROWSER_LOGIN', 'ANAPLAN_BROWSER_FORBIDDEN'].includes(response?.code)) cache.clear();
      throw Object.assign(new Error(response?.error || 'Background discovery is unavailable. Reload the extension in Chrome and retry.'), { code: response?.code });
    }
    const saved = cache.put(input, response.result, cached.generation);
    return saved ? { ...response.result, cache: saved } : response.result;
  } catch (error) {
    if (refresh && cached.previous && !signal?.aborted && error.name !== 'AbortError' && !['ANAPLAN_BROWSER_LOGIN', 'ANAPLAN_BROWSER_FORBIDDEN'].includes(error.code)) {
      const current = cache.begin(input);
      if (current.generation === cached.generation && current.result) return { ...current.result, cache: { ...current.result.cache, refreshFailed: true } };
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    globalThis.removeEventListener?.('pagehide', abort);
  }
}
