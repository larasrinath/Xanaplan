import { AppError } from './validation.mjs';

export function metadataTable(text) {
  if (text.length > 500000 || /more not shown|_truncated/i.test(text)) throw new AppError('Metadata is incomplete. Narrow the page or refresh context.', 422);
  const lines = text.split('\n').filter(line => line.startsWith('|'));
  const cells = line => line.trim().slice(1, -1).split(/(?<!\\)\|/).map(value => value.trim().replace(/\\\|/g, '|'));
  if (!lines.length) return [];
  const header = cells(lines[0]);
  if (header[0] !== '#') {
    if (lines.some(line => cells(line).length !== 2)) throw new AppError('Unrecognized metadata table.', 502);
    return [Object.fromEntries(lines.map(cells))];
  }
  return lines.slice(2).map(line => {
    const row = cells(line);
    if (row.length !== header.length) throw new AppError('Ambiguous metadata table delimiter.', 502);
    return Object.fromEntries(header.map((key, index) => [key, row[index]]));
  });
}

export function viewDimensions(text, viewId) {
  if (text.match(/\*\*View ID:\*\*\s*(\S+)/)?.[1] !== viewId) throw new AppError('MCP did not confirm the requested view.', 422);
  const result = { rows: [], columns: [], pages: [] };
  for (const key of Object.keys(result)) {
    const title = key[0].toUpperCase() + key.slice(1);
    const body = text.match(new RegExp(`\\*\\*${title}:\\*\\*([^]*?)(?=\\n\\*\\*|$)`))?.[1];
    if (body === undefined) throw new AppError('View dimensions are unavailable.', 422);
    if (body.trim() === '(none)') continue;
    for (const line of body.trim().split('\n')) {
      const match = line.trim().match(/^- (.+) \((\d+)\)$/);
      if (!match) throw new AppError('View dimensions could not be verified.', 422);
      result[key].push({ name: match[1], id: match[2] });
    }
  }
  return result;
}

export function metadataReader(mcp, model, signal, maxReads = 80) {
  const cache = new Map(); let reads = 0;
  return async (tool, args) => {
    if (signal?.aborted) throw new AppError('Question cancelled.', 499);
    const key = JSON.stringify([tool, args]);
    if (!cache.has(key)) {
      if (++reads > maxReads) throw new AppError('This page needs too many metadata reads. Try a smaller page.', 422);
      const result = await mcp.read(tool, args, model, signal);
      if (result.text.length > 500000) throw new AppError('Page metadata is too large.', 422);
      cache.set(key, result.text);
    }
    return cache.get(key);
  };
}
