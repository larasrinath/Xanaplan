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

import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { verifyServiceWorkerImports } from './worker-check.mjs';

const generatedConfig = resolve('extension/local-config.js');
for (const directory of ['extension', 'server', 'scripts', 'tests']) {
  for (const file of readdirSync(directory, { recursive: true }).filter(file => /\.(mjs|js|cjs)$/.test(file))) {
    const path = join(directory, file);
    const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
    // Check literal module links in production code. The UI harness embeds its
    // browser imports in a string, so they are resolved by the browser instead.
    if (!['extension', 'server'].includes(directory)) continue;
    for (const [, , target] of readFileSync(path, 'utf8').matchAll(/\b(?:from\s+|import\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g)) {
      const dependency = resolve(dirname(path), target);
      if (dependency !== generatedConfig) readFileSync(dependency);
    }
  }
}
const manifest = JSON.parse(readFileSync('extension/manifest.json'));
const pkg = JSON.parse(readFileSync('package.json'));
if (manifest.version !== pkg.version) throw new Error('Package and extension versions must match.');
for (const file of [manifest.background.service_worker, manifest.side_panel.default_path]) readFileSync(`extension/${file}`);
for (const file of new Set([...Object.values(manifest.icons || {}), ...Object.values(manifest.action.default_icon || {})])) readFileSync(`extension/${file}`);
verifyServiceWorkerImports(`extension/${manifest.background.service_worker}`);
const panel = join('extension', manifest.side_panel.default_path);
for (const [, asset] of readFileSync(panel, 'utf8').matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)=["']([^"']+)["']/g)) {
  readFileSync(resolve(dirname(panel), asset));
}
if (manifest.action.default_popup) throw new Error('Assistant must open in the Chrome side panel.');
if (manifest.permissions.includes('offscreen') || manifest.content_scripts?.length) throw new Error('Do not add persistent content scripts or offscreen pages.');
if (!manifest.permissions.includes('scripting')) throw new Error('Page context needs the read-only on-demand selector snapshot.');
if (!manifest.content_security_policy.extension_pages.includes("frame-src 'none'") || !manifest.content_security_policy.extension_pages.includes('https://*.app.anaplan.com')) throw new Error('Allow Anaplan data requests and disable embedded pages.');
for (const file of ['background.js', 'app-discovery.mjs', 'discovery-background.mjs', 'discovery-input.mjs', 'discovery-api.mjs', 'page-background.mjs', 'page-observer.mjs', 'page-api.mjs', 'page-tracker.mjs']) {
  if (/\btabs\s*\.\s*(create|update|remove)|window\s*\.\s*open/.test(readFileSync(`extension/${file}`, 'utf8'))) throw new Error(`${file}: discovery must never open a tab.`);
}
console.log('JavaScript syntax, module links, service-worker imports, extension assets, and versions verified.');
