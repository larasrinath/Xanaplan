export function matchesSearch(text, query) {
  const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const name = normalize(text);
  return normalize(query).trim().split(/\s+/).filter(Boolean).every(word => name.includes(word));
}

// The native select holds the chosen value; filtering never changes that value.
export function createSearchableSelect({ root, select, trigger, menu, input, clear, list, status }) {
  let matches = [], active = -1, locked = true;
  const isOpen = () => !menu.hidden;
  const choices = () => Array.from(select.options).filter(option => option.value && !option.disabled);

  function position() {
    if (!isOpen()) return;
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
    const upward = below < 240 && above > below;
    root.classList.toggle('opens-up', upward);
    menu.style.maxHeight = `${Math.max(120, Math.min(320, upward ? above : below))}px`;
  }
  function highlight(index, scroll = false) {
    active = index;
    const rows = Array.from(list.children);
    rows.forEach((row, i) => row.classList.toggle('active', i === active));
    if (rows[active]) {
      input.setAttribute('aria-activedescendant', rows[active].id);
      if (scroll) rows[active].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function render() {
    const all = choices();
    matches = all.filter(option => matchesSearch(option.textContent, input.value));
    clear.hidden = !input.value;
    list.replaceChildren();
    matches.forEach((option, index) => {
      const row = document.createElement('div');
      row.id = `${list.id}-${index}`; row.className = 'picker-option';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.value === select.value));
      row.textContent = option.textContent;
      row.addEventListener('pointerdown', event => event.preventDefault());
      row.addEventListener('pointermove', () => highlight(index));
      row.addEventListener('click', () => choose(index));
      list.append(row);
    });
    status.textContent = !matches.length ? 'No matching apps' : input.value.trim() ? `${matches.length} of ${all.length} apps` : '';
    const selected = matches.findIndex(option => option.value === select.value);
    highlight(selected >= 0 ? selected : matches.length ? 0 : -1);
    list.scrollTop = 0;
    position();
  }
  function close({ focus = false } = {}) {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    if (focus && !trigger.disabled) trigger.focus({ preventScroll: true });
  }
  function open() {
    if (trigger.disabled) return;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-expanded', 'true');
    render(); input.focus({ preventScroll: true });
  }
  function choose(index) {
    const option = matches[index];
    if (!option || locked || select.disabled) return;
    const changed = select.value !== option.value;
    select.value = option.value;
    close({ focus: true }); sync();
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function sync({ disabled = locked } = {}) {
    locked = disabled;
    trigger.disabled = locked || select.disabled;
    trigger.querySelector('span').textContent = select.selectedOptions[0]?.textContent ?? 'Select an app';
    trigger.classList.toggle('placeholder', !select.value);
    trigger.title = select.selectedOptions[0]?.textContent ?? '';
    trigger.setAttribute('aria-busy', select.getAttribute('aria-busy') ?? 'false');
    if (trigger.disabled) close();
    else if (isOpen()) render();
  }
  function reset({ keepQuery = false } = {}) {
    close();
    if (!keepQuery) input.value = '';
    list.replaceChildren(); status.textContent = '';
  }

  trigger.addEventListener('click', () => isOpen() ? close() : open());
  trigger.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault(); open();
    if (event.key === 'ArrowUp') highlight(matches.length - 1, true);
  });
  input.addEventListener('input', render);
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (matches.length) highlight((active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length, true);
    } else if (event.key === 'Enter') {
      event.preventDefault(); choose(active);
    }
  });
  clear.addEventListener('click', () => { input.value = ''; render(); input.focus(); });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen()) { event.preventDefault(); event.stopPropagation(); close({ focus: true }); }
  });
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) close(); });
  document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) close(); });
  window.addEventListener('resize', position);
  document.addEventListener('scroll', event => { if (!menu.contains(event.target)) position(); }, true);
  sync();
  return { sync, reset, close };
}
