(() => {
  "use strict";
  if (document.getElementById("xanaplan-resize-layer")) return;
  const { MIN_WIDTH, MAX_WIDTH, clampWidth, parseHeaderId, fitWidth } = globalThis.XanaplanCore;
  const { applyWidth, currentHeader, visible, normalize } = globalThis.XanaplanAdapter;
  const layer = document.createElement("div");
  layer.id = "xanaplan-resize-layer";
  const status = document.createElement("div");
  status.className = "xp-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  layer.append(status);
  document.body.append(layer);
  const handles = new Map();
  let busy = false;
  let drag = null;
  let scheduled = false;
  let statusTimer;

  function notify(message) {
    clearTimeout(statusTimer);
    status.textContent = message;
    status.hidden = false;
    statusTimer = setTimeout(() => { status.hidden = true; }, 5000);
  }
  function editing() {
    const active = document.activeElement;
    return visible(active) && active.matches('input, textarea, [contenteditable="true"]');
  }
  function hasDialog() {
    return Array.from(document.querySelectorAll('[role="dialog"]')).some(visible);
  }
  async function resize(context, width) {
    if (busy) return;
    if (editing()) { notify("Finish editing the cell or formula before resizing."); return; }
    const restoreKeyboardFocus = document.activeElement?.classList.contains("xp-handle");
    busy = true;
    schedule();
    try {
      const applied = await applyWidth(context, width);
      notify(`${context.label}: ${applied} px`);
    } catch (error) {
      notify(error.message || "Could not resize this column.");
    } finally {
      busy = false;
      schedule();
      if (restoreKeyboardFocus) requestAnimationFrame(() => {
        const entry = handles.get(context.headerId);
        if (entry?.context.scope === context.scope && visible(entry.button) && !entry.button.hidden) {
          entry.button.focus({ preventScroll: true });
        }
      });
    }
  }
  function measureCell(cell) {
    const wrapper = cell.querySelector(".cellWrapper") || cell;
    const text = normalize(wrapper.textContent);
    const style = getComputedStyle(wrapper);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return ctx.measureText(text).width + (parseFloat(style.letterSpacing) || 0) * Math.max(0, text.length - 1);
  }
  function autoFit(context) {
    try {
      const header = currentHeader(context);
      const parsed = parseHeaderId(header.id);
      const table = header.closest("table.grid.qa-module");
      const cells = Array.from(table.querySelectorAll("th[id], td[id]")).filter(el =>
        el.id.startsWith(`${parsed.gridId}_cell_x_${parsed.column}_`) && visible(el));
      resize(context, fitWidth(cells.map(measureCell)));
    } catch (error) { notify(error.message); }
  }
  function endDrag(cancelled = false) {
    if (!drag) return;
    const state = drag;
    drag = null;
    state.guide.remove();
    if (state.button.hasPointerCapture(state.pointerId)) state.button.releasePointerCapture(state.pointerId);
    if (!cancelled && Math.abs(state.width - state.startWidth) >= 3) resize(state.context, state.width);
    schedule();
  }
  function makeHandle(context) {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "xp-handle";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-valuemin", MIN_WIDTH);
    handle.setAttribute("aria-valuemax", MAX_WIDTH);
    handle.setAttribute("aria-label", `Resize ${context.label}`);
    handle.title = `${context.label}: drag to resize; double-click to fit rendered cells. Keyboard: arrows to resize, Enter to fit.`;
    handle.addEventListener("pointerdown", event => {
      event.preventDefault();
      event.stopPropagation();
      if (event.button !== 0 || busy || drag || hasDialog()) return;
      if (editing()) { notify("Finish editing the cell or formula before resizing."); return; }
      const header = currentHeader(context);
      const rect = header.getBoundingClientRect();
      const guide = document.createElement("div");
      guide.className = "xp-guide";
      Object.assign(guide.style, { left: `${rect.right}px`, top: `${rect.top}px`, height: `${Math.max(40, Math.min(500, innerHeight - rect.top))}px` });
      const label = document.createElement("span");
      label.className = "xp-width";
      label.textContent = `${Math.round(rect.width)} px`;
      guide.append(label);
      layer.append(guide);
      drag = { context, button: handle, pointerId: event.pointerId, startX: event.clientX,
        startWidth: rect.width, width: rect.width, left: rect.left, guide, label };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", event => {
      if (!drag || drag.button !== handle) return;
      drag.width = clampWidth(drag.startWidth + event.clientX - drag.startX);
      drag.guide.style.left = `${drag.left + drag.width}px`;
      drag.label.textContent = `${drag.width} px`;
    });
    handle.addEventListener("pointerup", () => endDrag());
    handle.addEventListener("pointercancel", () => endDrag(true));
    handle.addEventListener("lostpointercapture", () => endDrag(true));
    handle.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); });
    handle.addEventListener("dblclick", event => {
      event.preventDefault(); event.stopPropagation();
      if (!busy) autoFit(context);
    });
    handle.addEventListener("keydown", event => {
      if (!["Enter", "ArrowLeft", "ArrowRight", "Escape"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") { endDrag(true); return; }
      if (busy || event.repeat) return;
      if (event.key === "Enter") autoFit(context);
      else resize(context, currentHeader(context).getBoundingClientRect().width +
        (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 20 : 10));
    });
    layer.append(handle);
    return handle;
  }
  function render() {
    scheduled = false;
    if (drag && (!visible(drag.context.scope) || hasDialog())) endDrag(true);
    if (drag) return;
    const found = new Set();
    if (!busy && !hasDialog()) {
      for (const table of document.querySelectorAll("table.grid.qa-module")) {
        if (!visible(table)) continue;
        const headers = Array.from(table.querySelectorAll("th.gridcolumnheader[id]"));
        // Initial support is deliberately limited to an unambiguous single header level.
        if (!headers.length || headers.some(el => !parseHeaderId(el.id) || el.colSpan > 1 || el.rowSpan > 1)) continue;
        const labels = headers.map(el => normalize(el.querySelector(".cellWrapper")?.textContent));
        if (labels.some(label => !label) || new Set(labels).size !== labels.length) continue;
        const scope = table.closest('[id^="object-"]');
        if (!scope || !visible(scope)) continue;
        headers.forEach((header, i) => {
          const rect = header.getBoundingClientRect();
          // Respect clipped/virtualized headers: the edge must actually be under the pointer.
          if (rect.right < 8 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight) return;
          const hit = document.elementsFromPoint(rect.right - 2, rect.top + rect.height / 2)
            .find(el => !layer.contains(el));
          if (!hit || !header.contains(hit)) return;
          found.add(header.id);
          let entry = handles.get(header.id);
          if (entry && (entry.context.label !== labels[i] || entry.context.scope !== scope)) {
            entry.button.remove(); handles.delete(header.id); entry = null;
          }
          if (!entry) {
            const context = { headerId: header.id, label: labels[i], scope };
            entry = { context, button: makeHandle(context) };
            handles.set(header.id, entry);
          }
          Object.assign(entry.button.style, { left: `${rect.right - 4}px`, top: `${rect.top}px`, height: `${rect.height}px` });
          entry.button.setAttribute("aria-valuenow", Math.round(rect.width));
          entry.button.hidden = false;
        });
      }
    }
    for (const [id, entry] of handles) {
      if (!found.has(id)) {
        if (!document.getElementById(id)) { entry.button.remove(); handles.delete(id); }
        else entry.button.hidden = true;
      }
    }
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(render); }
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => record.target !== layer && !layer.contains(record.target))) schedule();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
  document.addEventListener("scroll", () => { endDrag(true); schedule(); }, true);
  window.addEventListener("resize", () => { endDrag(true); schedule(); });
  window.addEventListener("blur", () => endDrag(true));
  document.addEventListener("keydown", event => {
    if (drag && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); endDrag(true); }
  }, true);
  schedule();
})();
