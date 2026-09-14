import { PageTracker } from './page-tracker.mjs';

function pageSelectionSummary(context, mode) {
  const origin = mode === 'manual' ? 'inherited from tab' : 'page selection';
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
  return labels.length ? `${mode === 'manual' ? 'From current tab' : 'Page selections'}: ${labels.join(' · ')}` : '';
}

export function createPagePanel({ document, api, changed, read }) {
  const $ = id => document.getElementById(id);
  const tracker = new PageTracker({ api, read, changed: state => { render(state); changed(state); } });
  function render(state) {
    const select = $('chat-page'); select.replaceChildren();
    const auto = document.createElement('option'); auto.value = ''; auto.textContent = state.mode === 'follow' && state.context ? `${state.context.page.name} · Following tab` : 'Follow current tab'; select.append(auto);
    for (const page of state.pages) {
      const option = document.createElement('option'); option.value = page.id; option.textContent = page.name;
      option.disabled = !['boards', 'worksheets'].includes(page.type); select.append(option);
    }
    select.value = state.mode === 'manual' ? state.selectedPage : '';
    select.title = select.options[select.selectedIndex]?.textContent || 'Page for this chat';
    select.disabled = !tracker.app;
    $('refresh-page').disabled = !tracker.app || state.loading;
    $('page-status').textContent = state.loading ? 'Reading this page…' : state.error || (state.context ? `${state.context.page.name} · ${state.mode === 'manual' ? 'Chosen for chat' : 'Following tab'}` : 'Select an enabled app.');
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
  $('chat-page').addEventListener('change', () => tracker.choose($('chat-page').value));
  $('page-model').addEventListener('change', () => tracker.chooseModel($('page-model').value));
  $('refresh-page').addEventListener('click', () => tracker.refresh());
  const observe = () => { if (!document.hidden) void tracker.observe(); };
  const updated = (_, change) => { if (change.url || change.status === 'complete') observe(); };
  const tabs = globalThis.chrome?.tabs;
  tabs?.onActivated?.addListener(observe); tabs?.onUpdated?.addListener(updated);
  const poll = setInterval(observe, 2000);
  globalThis.addEventListener?.('pagehide', () => {
    clearInterval(poll); tabs?.onActivated?.removeListener(observe); tabs?.onUpdated?.removeListener(updated); tracker.invalidate();
  }, { once: true });
  return tracker;
}
