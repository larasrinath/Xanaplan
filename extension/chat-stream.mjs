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

// Consume actual helper activity; do not display provider reasoning or raw output.
export async function readChatStream(response, { signal, onProgress, idleMs = 45000 }) {
  if (!response.body) throw new Error('The helper returned an empty response. Please retry.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', timer, abort;
  const stopped = new Promise((_, reject) => {
    abort = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
  });
  function event(line) {
    let data;
    try { data = JSON.parse(line); } catch { throw new Error('The helper sent an unreadable update. Please retry.'); }
    if (data?.type === 'result' && (typeof data.result?.answer === 'string' || typeof data.result?.ticket === 'string' && data.result.context)) return data.result;
    if (data?.type === 'error') throw Object.assign(new Error(data.error || 'The question failed.'), data);
    if (data?.type === 'heartbeat' || (data?.type === 'progress' && typeof data.message === 'string' && data.message.length <= 240)) onProgress(data);
    else throw new Error('The helper sent an unexpected update. Restart it and retry.');
  }
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const idle = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('The local helper stopped sending updates. Check that it is running, then retry.')), idleMs);
      });
      let chunk;
      try { chunk = await Promise.race([reader.read(), stopped, idle]); }
      finally { clearTimeout(timer); }
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1);
        if (line.length > 2000000) throw new Error('The helper response exceeded the local size limit.');
        if (line) { const result = event(line); if (result) return result; }
      }
      if (pending.length > 2000000) throw new Error('The helper response exceeded the local size limit.');
      if (chunk.done) {
        if (pending.trim()) { const result = event(pending); if (result) return result; }
        throw new Error('The connection ended before an answer arrived. Please retry.');
      }
    }
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
