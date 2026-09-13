(() => {
  "use strict";
  const labels = ["Units", "Count (Days)", "Mean", "Standard Deviation", "Coefficient of Variation", "Variability", "Lead + Transit", "SKU Count"];
  const widths = labels.map(() => 80);
  const format = document.getElementById("format-toggle");
  const menu = document.getElementById("format-menu");
  const grid = document.getElementById("sample-grid");
  const status = document.getElementById("native-status");
  function text(tag, value) { const el = document.createElement(tag); el.textContent = value; return el; }
  function render() {
    const table = document.createElement("table");
    table.className = "grid qa-module";
    table.style.width = `${140 + widths.reduce((a, b) => a + b, 0)}px`;
    const header = table.insertRow();
    const corner = text("th", "Product");
    corner.className = "row-label";
    header.append(corner);
    labels.forEach((name, col) => {
      const th = document.createElement("th");
      th.className = "gridcolumnheader";
      th.id = `demo-grid_cell_x_${col}_ny_0`;
      th.style.width = `${widths[col]}px`;
      const wrapper = text("div", name);
      wrapper.className = "cellWrapper";
      wrapper.style.width = `${widths[col] - 3}px`;
      th.append(wrapper); header.append(th);
    });
    for (let row = 0; row < 10; row++) {
      const tr = table.insertRow();
      const name = text("th", `Sample SKU ${String(row + 1).padStart(3, "0")}`);
      name.className = "row-label"; tr.append(name);
      const values = [(12000 + row * 2107).toLocaleString("en-US"), "365", String(240 + row * 13),
        String(76.2 + row * 2.5), `${(18.4 + row * 0.7).toFixed(2)}%`, "X", "7", "1"];
      values.forEach((value, col) => {
        const td = tr.insertCell(); td.id = `demo-grid_cell_x_${col}_y_${row}`;
        const wrapper = text("div", value); wrapper.className = "cellWrapper";
        wrapper.style.width = `${widths[col] - 3}px`; td.append(wrapper);
        td.addEventListener("click", () => {
          grid.querySelector(".selected")?.classList.remove("selected"); td.classList.add("selected");
          status.textContent = `Selected ${labels[col]}, sample row ${row + 1}.`;
        });
      });
    }
    grid.replaceChildren(table);
  }
  function closeMenu() { menu.hidden = true; format.setAttribute("aria-expanded", "false"); }
  // Match Dijit's press-driven dropdown instead of letting click-only adapters pass.
  format.addEventListener("mousedown", () => { menu.hidden = !menu.hidden; format.setAttribute("aria-expanded", String(!menu.hidden)); });
  format.addEventListener("keydown", event => { if (event.key === "Escape") closeMenu(); });
  document.getElementById("column-settings").addEventListener("click", () => {
    closeMenu();
    const dialog = document.createElement("div");
    dialog.className = "qa-dialog-column-settings"; dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Column Settings");
    dialog.append(text("h2", "Column Settings"));
    const heading = text("div", "Individual Column Widths"); heading.className = "form-group-heading"; dialog.append(heading);
    const table = document.createElement("table"); table.className = "tableGroup"; dialog.append(table);
    const inputs = [];
    labels.forEach((name, col) => {
      if (col === 4 && document.getElementById("missing-field").checked) return;
      const tr = table.insertRow(); const th = document.createElement("th");
      const label = text("label", name); label.htmlFor = `width-${col}`; th.append(label); tr.append(th);
      const input = document.createElement("input"); input.type = "text"; input.id = label.htmlFor;
      input.value = String(widths[col]); let parsed = widths[col];
      input.addEventListener("input", () => { parsed = Number(input.value); input.setAttribute("aria-invalid", String(!Number.isFinite(parsed) || parsed < 6 || parsed > 800)); });
      tr.insertCell().append(input); inputs.push({col, input, value: () => parsed});
    });
    const buttons = document.createElement("div"); buttons.className = "dialog-buttons";
    const cancel = text("button", "Cancel"); cancel.addEventListener("click", () => dialog.remove());
    const ok = text("button", "OK"); ok.addEventListener("click", () => {
      const changes = inputs.filter(item => item.value() !== widths[item.col]);
      if (inputs.some(item => item.input.getAttribute("aria-invalid") === "true")) return;
      inputs.forEach(item => { widths[item.col] = item.value(); });
      status.textContent = `Native settings applied: ${changes.map(item => `${labels[item.col]} = ${widths[item.col]} px`).join(", ") || "no change"}. Changed fields: ${changes.length}.`;
      dialog.remove(); render();
    });
    buttons.append(cancel, ok); dialog.append(buttons); document.body.append(dialog);
  });
  document.getElementById("repaint").addEventListener("click", render);
  document.getElementById("reset").addEventListener("click", () => { widths.fill(80); render(); status.textContent = "Sample widths reset to 80 px."; });
  render();
})();
