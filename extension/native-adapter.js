(() => {
  "use strict";
  const { clampWidth } = globalThis.XanaplanCore;
  const normalize = value => (value || "").replace(/\s+/g, " ").trim();
  const visible = el => Boolean(el?.isConnected && el.getClientRects().length &&
    getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none");
  const shown = (root, selector) => Array.from(root.querySelectorAll(selector)).filter(visible);
  function exactlyOne(items, message) {
    if (items.length !== 1) throw new Error(message);
    return items[0];
  }
  function activate(element) {
    const rect = element.getBoundingClientRect();
    const options = { bubbles: true, cancelable: true, view: window, button: 0,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    // Dijit's drop-down opens on mousedown; click alone only stops propagation.
    element.dispatchEvent(new MouseEvent("mousedown", { ...options, buttons: 1 }));
    element.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
    element.dispatchEvent(new MouseEvent("click", { ...options, buttons: 0, detail: 1 }));
  }
  function button(root, label) {
    return exactlyOne(shown(root, 'button, [role="button"]').filter(el =>
      normalize(el.textContent) === label && el.getAttribute("aria-disabled") !== "true" && !el.disabled
    ), `Could not identify the ${label} button.`);
  }
  async function waitFor(read, description, timeout = 2000) {
    const deadline = performance.now() + timeout;
    do {
      const result = read();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 35));
    } while (performance.now() < deadline);
    throw new Error(description);
  }
  function currentHeader(context) {
    const header = document.getElementById(context.headerId);
    if (!visible(context.scope) || !visible(header) || !context.scope.contains(header) ||
        normalize(header.querySelector(".cellWrapper")?.textContent) !== context.label) {
      throw new Error("The module changed. Try resizing again.");
    }
    return header;
  }
  // Use the existing view-setting controls, so the grid owns its geometry and hit testing.
  // Never call private Dojo/model APIs or overwrite cell widths with CSS.
  async function applyWidth(context, requestedWidth) {
    const width = clampWidth(requestedWidth);
    currentHeader(context);
    if (shown(document, '[role="dialog"]').length) throw new Error("Close the open dialog first.");
    const format = exactlyOne(shown(context.scope, '[data-anaplan-element-name="toolbar-button-format"]'),
      "This module's Format menu is not available.");
    if (format.getAttribute("aria-disabled") === "true") throw new Error("Column settings are unavailable.");
    let ownedDialog;
    let menu;
    let submitted = false;
    try {
      if (format.getAttribute("aria-expanded") !== "true") activate(format);
      menu = await waitFor(() => {
        const el = document.getElementById(format.getAttribute("aria-owns"));
        return visible(el) && el;
      }, "The Format menu did not open.");
      const command = exactlyOne(shown(menu, '[role="menuitem"]').filter(el =>
        /^Column Settings(?:\.\.\.|…)?$/.test(normalize(el.getAttribute("aria-label") || el.textContent)) &&
        el.getAttribute("aria-disabled") !== "true"
      ), "Column Settings is unavailable in this view.");
      activate(command);
      ownedDialog = await waitFor(() => shown(document, '.qa-dialog-column-settings[role="dialog"]')[0],
        "The Column Settings dialog did not open.");
      const heading = exactlyOne(Array.from(ownedDialog.querySelectorAll(".form-group-heading"))
        .filter(el => normalize(el.textContent) === "Individual Column Widths"),
      "This view does not offer individual line-item column widths.");
      const table = heading.nextElementSibling;
      if (!table?.matches("table.tableGroup")) throw new Error("Column Settings layout has changed.");
      const label = exactlyOne(Array.from(table.querySelectorAll("label[for]"))
        .filter(el => normalize(el.textContent) === context.label),
      "Could not uniquely match this column to an individual width setting.");
      const input = document.getElementById(label.htmlFor);
      if (!input || !table.contains(input) || input.tagName !== "INPUT" || input.disabled || input.readOnly) {
        throw new Error("The column width field is unavailable.");
      }
      currentHeader(context);
      input.focus();
      input.value = String(width);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
      // Legacy number fields finish parsing after the input/blur events.
      await new Promise(resolve => setTimeout(resolve, 80));
      currentHeader(context);
      if (!visible(ownedDialog) || input.getAttribute("aria-invalid") === "true" || Number(input.value) !== width) {
        throw new Error("Anaplan did not accept the requested width.");
      }
      activate(button(ownedDialog, "OK"));
      submitted = true;
      await waitFor(() => !visible(ownedDialog), "Anaplan did not close Column Settings.");
      await waitFor(() => {
        const header = currentHeader(context);
        return Math.abs(header.getBoundingClientRect().width - width) <= 3;
      }, "The requested width could not be verified. Check the column before trying again.");
      return width;
    } catch (error) {
      // Cancel only the dialog opened by this operation. Never submit another dialog.
      if (!submitted && visible(ownedDialog)) {
        const cancels = shown(ownedDialog, 'button, [role="button"]').filter(el => normalize(el.textContent) === "Cancel");
        if (cancels.length === 1) activate(cancels[0]);
      } else if (!ownedDialog && visible(menu)) {
        format.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
      }
      throw error;
    }
  }
  globalThis.XanaplanAdapter = Object.freeze({ applyWidth, currentHeader, visible, normalize });
})();
