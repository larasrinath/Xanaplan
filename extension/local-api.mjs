import { readChatStream } from './chat-stream.mjs';

export function createLocalApi(getConnection, { fetchImpl = globalThis.fetch } = {}) {
  return async function api(path, { method = 'GET', body, signal, onProgress } = {}) {
    const connection = getConnection();
    if (!connection) throw new Error('Start the local helper with npm start, then reload this extension in Chrome.');
    let response;
    try {
      response = await fetchImpl(connection.baseUrl + path, {
        method, signal: signal ?? AbortSignal.timeout(70000),
        headers: { Authorization: `Bearer ${connection.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      throw new Error('Cannot reach the local helper. Run npm start in the Xanaplan folder, then select Check.');
    }
    if (response.ok && onProgress && response.headers.get('content-type')?.includes('application/x-ndjson')) return readChatStream(response, { signal, onProgress });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 404 && (path === '/page-context' || path === '/conversations') && data.error === 'Not found.') {
        throw Object.assign(new Error('The local helper needs an update. Stop it with Ctrl+C, run npm start again in the Xanaplan folder, then refresh page context.'), { code: 'HELPER_UPDATE_REQUIRED', status: 404 });
      }
      throw Object.assign(new Error(data.error ?? 'Request failed.'), { status: response.status }, data);
    }
    return data;
  };
}
