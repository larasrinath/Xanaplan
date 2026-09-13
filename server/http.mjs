import { timingSafeEqual } from 'node:crypto';
import { AppError } from './validation.mjs';

export function trustedRequest(req, token, port) {
  if (req.headers.host !== `127.0.0.1:${port}`) return false;
  if (req.headers.origin && !isExtensionOrigin(req.headers.origin)) return false;
  const provided = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
export async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('Expected JSON.', 415);
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 180000) throw new AppError('Request is too large.', 413);
  }
  try { return JSON.parse(body); } catch { throw new AppError('Invalid JSON.'); }
}

function isExtensionOrigin(origin) {
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin ?? '');
}

export function sendJson(res, status, body) {
  if (res.destroyed) return;
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

export function acceptRequest(req, res, token, port) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'application/json');
  const origin = req.headers.origin;
  const originAllowed = isExtensionOrigin(origin);
  if (originAllowed && req.headers.host === `127.0.0.1:${port}`) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(originAllowed && req.headers.host === `127.0.0.1:${port}` ? 204 : 403); res.end(); return false;
  }
  if (!trustedRequest(req, token, port)) {
    sendJson(res, 403, { error: 'Open Xanaplan from its paired Chrome extension.' });
    return false;
  }
  return true;
}
