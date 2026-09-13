/* Loaded in an isolated content-script world. No inspection until a verified offscreen request. */
(() => {
const tenantMenuOpening = new WeakSet();
function inspectTenantDocument(targetId = '', allowSwitch = false, document = globalThis.document) {
  const trigger = document.querySelector('[data-test-id="tenant-switcher-menu-trigger-button"]');
  const menu = document.querySelector('[data-test-id="tenant-switcher-menu-trigger-menu"]');
  const allButtons = menu ? [...menu.querySelectorAll('button[role="menuitem"]')] : [];
  // A menu wrapper may use display:contents and have no box even when its
  // buttons are visible. Testing the wrapper's rectangles made us miss that
  // list and repeatedly toggle an already-open menu.
  const buttons = allButtons.filter(button => button.getClientRects().length && !button.disabled);
  const pending = (stage, parsed = 0, selected = 0) => ({
    kind: 'tenant-pending', stage,
    selector: Boolean(trigger), menu: Boolean(menu), totalItems: allButtons.length,
    visibleItems: buttons.length, parsedItems: parsed, selectedItems: selected,
    ready: document.readyState,
    page: /^\/a\/(apps|home)(\/|$)/.test(document.location.pathname) ? document.location.pathname.split('/')[2] : 'other',
  });
  if (!trigger) return pending('selector-missing');
  if (!buttons.length) {
    if (trigger.getAttribute('aria-expanded') !== 'true' && !tenantMenuOpening.has(trigger)) {
      tenantMenuOpening.add(trigger); trigger.click();
    }
    return pending(menu ? 'menu-not-visible' : 'menu-missing');
  }
  tenantMenuOpening.delete(trigger);
  const items = buttons.map(button => ({
    id: button.id.match(/^dropdown-menu-option-([a-zA-Z0-9_-]+)$/)?.[1],
    name: button.textContent.trim().replace(/ \(Default\)$/, ''),
    selected: button.classList.contains('tenant-switcher-selected-item'),
  })).filter(item => item.id && item.name);
  const selected = items.filter(item => item.selected);
  if (items.length !== buttons.length) return pending('items-unrecognized', items.length, selected.length);
  if (selected.length !== 1) return pending('selection-unrecognized', items.length, selected.length);
  if (targetId && !items.some(item => item.id === targetId)) return { kind: 'tenant-error', message: 'This tenant is no longer available to the signed-in Chrome account. Reload tenants.' };
  if (targetId && selected[0].id !== targetId && allowSwitch) {
    buttons.find(button => button.id === `dropdown-menu-option-${targetId}`).click();
    return { kind: 'tenant-switching' };
  }
  return { kind: 'tenants', items, selectedId: selected[0].id };
}

function inspectAppDocument(mode, appId = '', document = globalThis.document) {
  const path = document.location.pathname;
  if (mode === 'catalog' && path === '/a/table-of-contents-toc-ui') {
    const links = [...document.querySelectorAll('a[href]')];
    const items = new Map();
    for (const link of links) {
      const match = link.getAttribute('href').match(/^\/a\/apps\/app\/([a-f0-9-]{36})\/?$/i);
      const name = link.textContent.trim();
      if (match && name) items.set(match[1], { id: match[1], name });
    }
    if (items.size) return { kind: 'catalog', items: [...items.values()] };
    return null;
  }
  if (mode !== 'models' || path !== `/a/table-of-contents-toc-ui/app/${appId}`) return null;
  const list = document.querySelector('[data-test-id="show-models-list"]');
  if (list) {
    const rows = [...list.querySelectorAll('li[data-test-id]')];
    const expected = Number(document.querySelector('.models-list-header__count')?.textContent.trim());
    const models = rows.map(row => ({
      id: row.getAttribute('data-test-id').match(/^([a-f0-9]{32})-/i)?.[1],
      name: row.querySelector('[data-test-id="model-list-model-name"]')?.textContent.trim(),
      workspaceName: row.querySelector('[data-test-id="model-list-workspace-name"]')?.textContent.trim(),
    }));
    if (models.length && expected === models.length && models.every(model => model.id && model.name && model.workspaceName)) return { kind: 'models', models };
    return null;
  }
  const visible = el => el.getClientRects().length > 0 && !el.disabled;
  const show = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.trim() === 'Show models' && visible(el));
  if (show) { show.click(); return { kind: 'waiting' }; }
  const manage = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Manage app' && visible(el));
  // Do not repeatedly toggle the menu or reopen a dialog that is still loading.
  if (!document.querySelector('[role="dialog"]') && manage && manage.getAttribute('aria-expanded') !== 'true') manage.click();
  return { kind: 'waiting' };
}


globalThis.XanaplanDiscoveryDOM = { inspectTenantDocument, inspectAppDocument };
})();
