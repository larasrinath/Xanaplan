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

import { pageFromUrl } from './page-api.mjs';

// Serialized by chrome.scripting. Keep this function self-contained and read-only.
// Selectors are from Anaplan's public Springboard client; no values, cookies,
// storage, React internals, network interception or browser navigation are used.
export function capturePageSelections() {
  if (!/^https:\/\/[a-z0-9-]+\.app\.anaplan\.com$/i.test(location.origin)) return null;
  if (!/^\/a\/(apps|springboard-ui)(\/|$)/.test(location.pathname)) return null;
  const visible = element => element.getClientRects().length > 0;
  const nodes = [...document.querySelectorAll('[data-test-id*="-context-filter-"]')];
  const selections = [];
  for (const element of nodes) {
    const match = element.getAttribute('data-test-id')?.match(/^(.+)-context-filter-(\d+)(?:-(.*?))?-(button|label-Editable)$/);
    if (!match || !visible(element)) continue;
    const card = element.closest('[id^="widget-wrapper-"]');
    const isPage = Boolean(element.closest('[data-test-id="page-level-context-selector"]'));
    const label = (element.getAttribute('data-selected-label') || element.textContent || '').trim().slice(0, 500);
    selections.push({ dimensionId: match[2], scope: match[3] || '', label,
      cardId: isPage ? '' : card?.id.slice('widget-wrapper-'.length) || '?',
      unresolved: Boolean(!label || element.querySelector('[data-empty-context], [data-test-id="context-label-loader"]')) });
    if (selections.length >= 100) break;
  }
  const title = document.querySelector('[data-test-id="inline-page-title__title"]');
  const model = document.querySelector('[data-test-id="model-select-name"]');
  const cardIds = [...document.querySelectorAll('[id^="widget-wrapper-"]')].filter(visible).map(element => element.id.slice('widget-wrapper-'.length)).slice(0, 500);
  return { url: location.origin + location.pathname, rendered: Boolean(title || cardIds.length || selections.length),
    pageName: title && visible(title) ? title.textContent.trim().slice(0, 2000) : '', modelName: model && visible(model) ? model.textContent.trim().slice(0, 500) : '', selections, cardIds };
}

export async function observeTab(chromeApi) {
  const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return { url: '', rendered: false, selections: [], cardIds: [] };
  // Read frame zero's URL before authorizing any DOM observation.
  if (!pageFromUrl(tab.url)) return { url: tab.url, rendered: false, selections: [], cardIds: [] };
  const frames = await chromeApi.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: capturePageSelections });
  const [current] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  if (current?.id !== tab.id || current?.url !== tab.url) throw new Error('The active tab changed. Refresh page context.');
  const results = frames.map(frame => frame.result).filter(result => result?.rendered);
  if (results.length !== 1) return { tabId: tab.id, url: tab.url, rendered: false, selections: [], cardIds: [], warning: 'The rendered page could not be identified uniquely.' };
  return { ...results[0], tabId: tab.id, url: tab.url };
}
