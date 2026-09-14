import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyServiceWorkerImports } from '../scripts/worker-check.mjs';

test('the actual service-worker dependency tree has no dynamic imports', () => {
  const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url)));
  const visited = verifyServiceWorkerImports(`extension/${manifest.background.service_worker}`);
  assert.ok(visited.has(resolve('extension/page-observer.mjs')));
  assert.ok(visited.has(resolve('extension/page-api.mjs')));
  assert.equal(visited.has(resolve('extension/panel.js')), false);
});

test('worker check rejects nested dynamic imports while handling re-exports and cycles', () => {
  const files = new Map([
    [resolve('worker.js'), "import './router.mjs';"],
    [resolve('router.mjs'), "export { observe } from './observer.mjs';"],
    [resolve('observer.mjs'), "import './worker.js'; export async function observe() { return import('./page-api.mjs'); }"],
  ]);
  const read = path => { assert.ok(files.has(path)); return files.get(path); };
  assert.throws(() => verifyServiceWorkerImports('worker.js', read), /observer\.mjs.*static imports/);
  files.set(resolve('observer.mjs'), "import './worker.js'; export function observe() { return 'ready'; }");
  assert.equal(verifyServiceWorkerImports('worker.js', read).size, 3);
});
