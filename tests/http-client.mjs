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
