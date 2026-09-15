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

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { pageFromUrl, pageCatalog, pageDefinition, readPageDefinition } from '../extension/page-api.mjs';
import { observeTab, capturePageSelections } from '../extension/page-observer.mjs';
import { createPageService } from '../extension/page-background.mjs';
import { pageRequest } from '../extension/page-tracker.mjs';
import { app, appId, pageId, catalog, board, observation, secondPageId } from './fixtures/page.mjs';

test('page URLs require the enabled HTTPS origin and explicit published page routes', () => {
  assert.equal(pageFromUrl(observation.url).pageId, pageId);
  assert.equal(pageFromUrl(observation.url + '/edit').editing, true);
  for (const url of ['https://evil.test/a/apps/app/x/boards/y', observation.url.replace('https:', 'http:'), observation.url.replace('/boards/', '/unknown/'), observation.url + '/draft', observation.url.replace('us1a.app.anaplan.com', 'us1a.app.anaplan.com.evil.test')]) assert.equal(pageFromUrl(url), null);
});
test('published catalogs enforce app/tenant identity, completeness and unique pages', () => {
  assert.equal(pageCatalog(catalog, app).length, 2);
  assert.throws(() => pageCatalog({ ...catalog, customerId: 'other' }, app), /tenant/);
  assert.throws(() => pageCatalog({ ...catalog, pages: [...catalog.pages, catalog.pages[0]] }, app), /conflicting/);
  assert.throws(() => pageCatalog({ ...catalog, totalCount: 9 }, app), /incomplete/);
});
test('board sources retain independent card selectors; custom views are explicit', () => {
  const definition = pageDefinition(board, { id: pageId, type: 'boards' }, app);
  assert.equal(definition.sources.length, 2);
  assert.equal(definition.sources[1].sourceId, '901');
  assert.equal(definition.sources[1].options[0].synced, false);
  const custom = structuredClone(board);
  custom.widgets.revenue.widgetDataSources = [{ dataSourceId: 'view:custom', dataSourceType: 'MULTI_AXIS_DESCRIPTION', axisDescriptionQuery: { regions: { SINGLE: { moduleId: '101' } } } }];
  const source = pageDefinition(custom, { id: pageId, type: 'boards' }, app).sources[0];
  assert.equal(source.unsupported, true); assert.deepEqual(source.moduleIds, ['101']);
  assert.throws(() => pageDefinition({ ...board, appGuid: secondPageId }, { id: pageId, type: 'boards' }, app), /belongs/);
});
test('worksheet main grid and insight card definitions are separate sources', () => {
  const worksheet = { ...board, pageGuid: secondPageId, name: 'Costs', dataSourceId: '101', widgets: [{ widgetDefinition: board.widgets.budget }] };
  const result = pageDefinition(worksheet, { id: secondPageId, type: 'worksheets', name: 'Costs' }, app);
  assert.equal(result.sources.length, 2); assert.equal(result.sources[0].cardId, `mainGrid:${secondPageId}`);
});

test('Anaplan GRID-PAGE catalog entries load through the worksheet route', async () => {
  assert.equal(pageCatalog(catalog, app)[1].type, 'worksheets');
  const worksheet = { ...board, pageGuid: secondPageId, name: 'Costs', dataSourceId: '101', widgets: [{ widgetDefinition: board.widgets.budget }] };
  const urls = [];
  const result = await readPageDefinition({ ...app, pageId: secondPageId }, { fetchImpl: async (url, options) => {
    urls.push(url); assert.equal(options.method, 'GET');
    return Response.json(url.includes('/grid-pages/') ? worksheet : catalog);
  } });
  assert.equal(result.page.type, 'worksheets'); assert.equal(result.sources.length, 2);
  assert.match(urls[1], new RegExp(`/grid-pages/${secondPageId}$`));
  assert.equal(result.unavailableReason, undefined); assert.equal(urls.length, 3);
});
test('empty selection metadata is ordinary scalar context and data-bound text remains a source', () => {
  const value = structuredClone(board);
  value.contextOptions[0] = { ...value.contextOptions[0], filter: {}, selections: [], selectedItems: [] };
  value.widgets.text = { type: 'TEXT', dataSourceId: '101' };
  const result = pageDefinition(value, { id: pageId, type: 'boards' }, app);
  assert.equal(result.options[0].unsupported, false);
  assert.equal(result.sources.length, 3);
  value.contextOptions[0].selectedItems = ['601', '602'];
  assert.equal(pageDefinition(value, { id: pageId, type: 'boards' }, app).options[0].unsupported, true);
});
test('oversized custom queries keep module discovery and explicitly mark omitted query metadata', () => {
  const value = structuredClone(board);
  value.widgets.revenue.widgetDataSources = [{ dataSourceId: 'view:custom', dataSourceType: 'CUSTOM_VIEW', axisDescriptionQuery: { moduleId: '101', description: 'x'.repeat(16000) } }];
  const source = pageDefinition(value, { id: pageId, type: 'boards' }, app).sources[0];
  assert.deepEqual(source.moduleIds, ['101']);
  assert.equal(source.query, null);
  assert.equal(source.queryOmitted, true);
});
test('page discovery uses only published GET routes and rechecks membership', async () => {
  const urls = [];
  const fetchImpl = async (url, options) => {
    urls.push(url); assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'include'); assert.equal(options.redirect, 'manual');
    return new Response(JSON.stringify(url.includes('/boards/') ? board : catalog), { headers: { 'content-type': 'application/json' } });
  };
  const result = await readPageDefinition({ ...app, pageId }, { fetchImpl });
  assert.equal(result.page.id, pageId); assert.equal(urls.length, 3);
  assert.match(urls[0], /includeUnpublished=false/); assert.equal(urls[0], urls[2]);
  await assert.rejects(readPageDefinition({ ...app, pageId }, { fetchImpl, signal: AbortSignal.abort() }), /cancel/i);
});
test('report and unknown pages keep the supported page picker available with distinct explanations', async () => {
  for (const type of ['REPORT', 'NEW_PAGE_TYPE']) {
    const data = structuredClone(catalog); data.pages[0].pageType = type;
    let calls = 0;
    const result = await readPageDefinition({ ...app, pageId }, { fetchImpl: async () => { calls++; return Response.json(data); } });
    assert.equal(calls, 1); assert.equal(result.pages.length, 2); assert.equal(result.page, undefined);
    assert.match(result.unavailableReason, type === 'REPORT' ? /report pages/ : /does not recognize/);
    if (type !== 'REPORT') assert.doesNotMatch(result.unavailableReason, /report pages/);
  }
});
test('tab observation never injects into unrelated tabs and rejects navigation races', async () => {
  let current = { id: 3, url: 'https://example.com' }, injections = 0;
  const chrome = { tabs: { query: async () => [current] }, scripting: { executeScript: async input => { injections++; assert.equal(input.func, capturePageSelections); return [{ frameId: 0, result: observation }]; } } };
  await observeTab(chrome); assert.equal(injections, 0);
  current = { id: 3, url: observation.url };
  const result = await observeTab(chrome); assert.equal(result.tabId, 3); assert.equal(injections, 1);
  chrome.scripting.executeScript = async () => { current = { id: 4, url: observation.url }; return []; };
  await assert.rejects(observeTab(chrome), /changed/);
});
test('page background rejects web-page callers and propagates targeted cancellation', async () => {
  const chrome = { runtime: { id: 'x', getURL: path => `chrome-extension://x/${path}` } };
  let cancelled = false;
  const service = createPageService(chrome, { read: async (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(new Error('Cancelled')); })) });
  const sender = { id: 'x', url: chrome.runtime.getURL('panel.html') };
  await assert.rejects(service({ action: 'observe' }, { id: 'x', url: observation.url }), /panel/);
  const jobId = crypto.randomUUID();
  const pending = service({ action: 'read', jobId, input: { appId } }, sender);
  await service({ action: 'cancel', jobId }, sender);
  await assert.rejects(pending, /stopped|Cancelled/); assert.equal(cancelled, true);
});
test('page observation passes through the background service using the real observer', async () => {
  const chrome = {
    runtime: { id: 'x', getURL: path => `chrome-extension://x/${path}` },
    tabs: { query: async () => [{ id: 3, url: observation.url }] },
    scripting: { executeScript: async ({ func }) => { assert.equal(func, capturePageSelections); return [{ frameId: 0, result: observation }]; } },
  };
  const service = createPageService(chrome);
  const response = await service({ action: 'observe' }, { id: 'x', url: chrome.runtime.getURL('panel.html') });
  assert.equal(response.ok, true); assert.equal(response.result.url, observation.url);
  assert.deepEqual(response.result.selections, observation.selections);
});

test('browser sign-in error codes reach the panel through the actual worker message handler', async () => {
  let listener;
  const chrome = {
    runtime: { id: 'x', getURL: path => `chrome-extension://x/${path}`, onMessage: { addListener: value => { listener = value; } }, onInstalled: { addListener() {} } },
    sidePanel: { setPanelBehavior: async () => {} },
  };
  const source = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  runInNewContext(source, { chrome, console,
    createDiscoveryService: () => async () => { throw new Error('Unexpected discovery call'); },
    createPageService: () => createPageService(chrome, { read: input => readPageDefinition(input, { fetchImpl: async () => new Response('', { status: 401 }) }) }),
  });
  chrome.runtime.sendMessage = message => new Promise(resolve => listener(message, { id: 'x', url: chrome.runtime.getURL('panel.html') }, resolve));
  await assert.rejects(pageRequest('read', { ...app, pageId }, { chromeApi: chrome }), { code: 'ANAPLAN_BROWSER_LOGIN' });
});
