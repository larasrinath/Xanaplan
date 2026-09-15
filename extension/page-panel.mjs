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

import { PageTracker } from './page-tracker.mjs';

function pageSelectionSummary(context, mode) {
  const origin = mode === 'saved' ? 'saved selection' : mode === 'manual' ? 'inherited from tab' : 'page selection';
  const dimensions = new Map();
  for (const source of context?.sources || []) {
    for (const filter of source.filters) {
      if (filter.origin !== origin || filter.issue || filter.dimensionId === '20000000012' || filter.dimensionName === 'Line Items') continue;
      const label = filter.label?.trim();
      if (!label || label === filter.itemId || /^\d{11,}$/.test(label) || /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(label)) continue;
      if (!dimensions.has(filter.dimensionId)) dimensions.set(filter.dimensionId, new Map());
      dimensions.get(filter.dimensionId).set(filter.itemId, label);
    }
  }
  // Card-specific defaults and conflicting values must not look like shared page selections.
  const labels = [...new Set([...dimensions.values()].filter(items => items.size === 1).flatMap(items => [...items.values()]))];
  return labels.length ? `${mode === 'saved' ? 'Saved selections' : mode === 'manual' ? 'From current tab' : 'Page selections'}: ${labels.join(' · ')}` : '';
}

export function createPagePanel({ document, api, changed, read, resolveApp }) {
  const $ = id => document.getElementById(id);
  let disposed = false;
  const tracker = new PageTracker({ api, read, resolveApp, changed: state => { if (!disposed) { render(state); changed(state); } } });
  const pageLabel = state => {
    if (disposed) return;
    const expanded = $('context-controls').open;
    $('current-page-label').textContent = state.context?.page.name || (state.loading ? 'Loading page…' : tracker.app ? 'Choose a page' : 'Set up an app in Admin');
    $('current-page-label').parentElement.setAttribute('aria-label', `${expanded ? 'Close' : 'Open'} page menu: ${$('current-page-label').textContent}`);
  };
  const status = state => {
    $('page-status').textContent = state.loading ? `${state.progress || 'Loading page'} · ${Math.floor((Date.now() - state.startedAt) / 1000)}s` : state.error || '';
  };
  function render(state) {
    $('current-page-label').parentElement.title = state.context ? `${tracker.app?.name || ''}\n${state.context.page.name} · ${state.mode === 'saved' ? 'Saved chat context' : state.mode === 'manual' ? 'Chosen for chat' : 'Following tab'}\nClick to choose app and page` : 'Choose app and page';
    $('context-mode-label').textContent = state.context ? state.mode === 'saved' ? 'Saved' : state.mode === 'manual' ? 'Chosen' : 'Live' : '';
    pageLabel(state);
    $('follow-tab').disabled = !tracker.app || state.loading;
    $('follow-tab').setAttribute('aria-pressed', String(state.mode === 'follow'));
    $('follow-tab').textContent = state.mode === 'follow' ? 'Following current tab' : 'Follow current tab';
    const select = $('chat-page'); select.replaceChildren();
    const auto = document.createElement('option'); auto.value = ''; auto.textContent = state.mode === 'follow' ? state.context?.page.name || 'Current tab' : 'Choose a page'; auto.disabled = state.mode !== 'follow'; select.append(auto);
    for (const page of state.pages) {
      const option = document.createElement('option'); option.value = page.id; option.textContent = page.name + (page.type === 'reports' ? ' · Report (unavailable)' : page.type === 'unsupported' ? ' · Unsupported page type' : '');
      option.disabled = !['boards', 'worksheets'].includes(page.type); select.append(option);
    }
    select.value = state.mode !== 'follow' ? state.selectedPage : '';
    select.title = select.options[select.selectedIndex]?.textContent || 'Page for this chat';
    select.disabled = !tracker.app;
    $('refresh-page').disabled = !tracker.app || state.loading;
    status(state);
    $('stop-page').hidden = !state.loading;
    $('page-status').dataset.error = String(Boolean(state.error));
    $('page-status').hidden = !state.loading && !state.error;
    const picker = $('page-model'); picker.replaceChildren();
    const detected = document.createElement('option'); detected.value = ''; detected.textContent = 'Use detected model'; picker.append(detected);
    const members = tracker.definition?.models || [];
    for (const model of tracker.app?.models || []) {
      if (!members.some(member => member.modelId === model.modelId.toUpperCase() && member.workspaceId === model.workspaceId.toUpperCase())) continue;
      const option = document.createElement('option'); option.value = model.key; option.textContent = model.name; picker.append(option);
    }
    picker.value = state.modelKey;
    $('page-model-field').hidden = members.length <= 1;
    picker.disabled = state.loading;
    const summary = state.loading || state.error ? '' : pageSelectionSummary(state.context, state.mode);
    $('page-selections').textContent = summary;
    $('page-selections').title = summary;
    $('page-selections').hidden = !summary;
  }
  $('context-controls').addEventListener('toggle', () => pageLabel(tracker.state));
  const closePicker = () => { $('context-controls').open = false; };
  const choose = async pageId => { await tracker.choose(pageId); if (tracker.state.ticket && !tracker.state.error) { closePicker(); $('context-controls').querySelector('summary').focus(); } };
  $('chat-page').addEventListener('change', () => choose($('chat-page').value));
  $('follow-tab').addEventListener('click', () => choose(''));
  document.addEventListener('click', event => { if (!$('context-controls').contains(event.target)) closePicker(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('context-controls').open) { closePicker(); $('context-controls').querySelector('summary').focus(); }
  });
  $('page-model').addEventListener('change', () => tracker.chooseModel($('page-model').value));
  $('refresh-page').addEventListener('click', () => tracker.refresh());
  $('stop-page').addEventListener('click', () => tracker.stop());
  const observe = () => { if (!document.hidden) void tracker.observe(); };
  const updated = (_, change) => { if (change.url || change.status === 'complete') observe(); };
  const tabs = globalThis.chrome?.tabs;
  tabs?.onActivated?.addListener(observe); tabs?.onUpdated?.addListener(updated);
  const poll = setInterval(observe, 2000);
  const elapsed = setInterval(() => { if (tracker.state.loading) status(tracker.state); }, 1000);
  globalThis.addEventListener?.('pagehide', () => {
    disposed = true; tracker.app = null;
    clearInterval(poll); clearInterval(elapsed); tabs?.onActivated?.removeListener(observe); tabs?.onUpdated?.removeListener(updated); tracker.invalidate();
  }, { once: true });
  return tracker;
}
