import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Chrome module service workers allow static imports, but reject dynamic
// imports even when those imports work in the panel or Node-based tests.
export function verifyServiceWorkerImports(entry, read = path => readFileSync(path, 'utf8')) {
  const visited = new Set();
  function visit(path) {
    path = resolve(path);
    if (visited.has(path)) return;
    visited.add(path);
    const source = read(path);
    if (/\bimport(?:\s|\/\*[^]*?\*\/|\/\/[^\n]*(?:\n|$))*\(/.test(source)) throw new Error(`${path}: Chrome service-worker modules must use static imports.`);
    for (const [, , target] of source.matchAll(/\b(?:from\s+|import\s+)(['"])(\.{1,2}\/[^'"]+)\1/g)) visit(resolve(dirname(path), target));
  }
  visit(entry);
  return visited;
}
