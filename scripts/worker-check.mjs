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
