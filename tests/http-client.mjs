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

import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

// Exercise the real request listener without binding a port or contacting services.
export function request(server, store, method, path, body, { headers = {}, rawBody } = {}) {
  return new Promise(resolve => {
    const input = rawBody ?? (body === undefined ? '' : JSON.stringify(body));
    const req = Readable.from(input ? [input] : []);
    Object.assign(req, {
      method, url: path,
      headers: { host: '127.0.0.1:8766', authorization: `Bearer ${store.data.token}`, 'content-type': 'application/json', ...headers },
    });
    const res = new EventEmitter(), responseHeaders = {};
    res.writableEnded = false;
    res.setHeader = (name, value) => { responseHeaders[name.toLowerCase()] = value; };
    res.writeHead = status => { res.status = status; };
    res.end = text => {
      res.writableEnded = true;
      resolve({ status: res.status, body: text ? JSON.parse(text) : undefined, headers: responseHeaders });
    };
    server.emit('request', req, res);
  });
}

// Fetch-like adapter for incremental responses from the real request listener.
// Cancellation emits the same response-close event as a disconnected browser.
export function streamRequest(server, store, method, path, body, { signal, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { method, url: path, headers: { host: '127.0.0.1:8766', authorization: `Bearer ${store.data.token}`, 'content-type': 'application/json', ...headers } });
    const res = new EventEmitter(), responseHeaders = {}, encoder = new TextEncoder();
    let output, sent = false;
    const disconnect = () => { if (!res.destroyed && !res.writableEnded) { res.destroyed = true; res.emit('close'); } };
    const stream = new ReadableStream({ start(controller) { output = controller; }, cancel() { disconnect(); signal?.removeEventListener('abort', abort); } });
    const abort = () => {
      if (res.destroyed || res.writableEnded) return;
      disconnect(); const error = new DOMException('Cancelled', 'AbortError'); output.error(error); if (!sent) reject(error);
      signal?.removeEventListener('abort', abort);
    };
    signal?.addEventListener('abort', abort, { once: true });
    res.setHeader = (name, value) => { responseHeaders[name.toLowerCase()] = value; };
    res.writeHead = status => { res.status = status; };
    res.flushHeaders = () => {
      if (!sent && !res.destroyed) { sent = true; resolve(new Response(stream, { status: res.status || 200, headers: responseHeaders })); }
    };
    res.write = text => { if (res.destroyed) return false; res.flushHeaders(); output.enqueue(encoder.encode(text)); return true; };
    res.end = text => {
      if (res.destroyed) return;
      if (text) res.write(text); res.flushHeaders(); res.writableEnded = true;
      output.close(); signal?.removeEventListener('abort', abort); res.emit('close');
    };
    if (signal?.aborted) { abort(); return; }
    server.emit('request', req, res);
  });
}
