import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const directory of ['extension', 'server', 'scripts']) {
  for (const file of readdirSync(directory).filter(file => /\.(mjs|js)$/.test(file))) {
    const result = spawnSync(process.execPath, ['--check', `${directory}/${file}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
const manifest = JSON.parse(readFileSync('extension/manifest.json'));
for (const file of [manifest.background.service_worker, manifest.side_panel.default_path]) readFileSync(`extension/${file}`);
if (manifest.action.default_popup) throw new Error('Assistant must open in the Chrome side panel.');
if (manifest.permissions.includes('offscreen') || manifest.permissions.includes('scripting') || manifest.content_scripts?.length) throw new Error('Discovery must use read-only background requests, without frames or content scripts.');
if (!manifest.content_security_policy.extension_pages.includes("frame-src 'none'") || !manifest.content_security_policy.extension_pages.includes('https://*.app.anaplan.com')) throw new Error('Allow Anaplan data requests and disable embedded pages.');
for (const script of manifest.content_scripts ?? []) for (const file of script.js) readFileSync(`extension/${file}`);
for (const file of ['background.js', 'app-discovery.mjs', 'discovery-background.mjs', 'discovery-runner.mjs', 'discovery-api.mjs']) {
  if (/\btabs\s*\.\s*(create|update|remove)|window\s*\.\s*open/.test(readFileSync(`extension/${file}`, 'utf8'))) throw new Error(`${file}: discovery must never open a tab.`);
}
console.log('JavaScript syntax and extension entry points verified.');
