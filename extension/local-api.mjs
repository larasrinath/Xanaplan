export function createLocalApi(getConnection, { fetchImpl = globalThis.fetch } = {}) {
  return async function api(path, { method = 'GET', body, signal } = {}) {
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
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error ?? 'Request failed.'), data);
    return data;
  };
}
