document.getElementById("test-adapter").addEventListener("click", async event => {
  const output = document.getElementById("test-output");
  const lines = [];
  const assert = (ok, description) => { if (!ok) throw new Error(description); lines.push(`PASS: ${description}`); };
  const width = col => document.getElementById(`demo-grid_cell_x_${col}_ny_0`).getBoundingClientRect().width;
  const scope = document.getElementById("object-demo");
  const context = {scope, headerId: "demo-grid_cell_x_3_ny_0", label: "Standard Deviation"};
  event.target.disabled = true;
  output.textContent = "Running actual native-adapter checks…";
  try {
    document.getElementById("missing-field").checked = false;
    document.getElementById("reset").click();
    const neighbors = [width(2), width(4)];
    await XanaplanAdapter.applyWidth(context, 151);
    assert(Math.abs(width(3) - 151) < 2, "Width applied through the native dialog and verified after table replacement");
    assert(width(2) === neighbors[0] && width(4) === neighbors[1], "Adjacent columns retain their widths");
    document.getElementById("repaint").click();
    assert(Math.abs(width(3) - 151) < 2, "Native width survives a grid redraw");
    await XanaplanAdapter.applyWidth(context, 55);
    assert(Math.abs(width(3) - 55) < 2, "Column can shrink as well as expand");
    let rejected = false;
    try { await XanaplanAdapter.applyWidth({...context, label: "Changed module"}, 200); } catch { rejected = true; }
    assert(rejected && !document.querySelector('[role="dialog"]'), "Stale header context is rejected before opening settings");
    document.getElementById("missing-field").checked = true;
    rejected = false;
    try { await XanaplanAdapter.applyWidth({scope, headerId: "demo-grid_cell_x_4_ny_0", label: "Coefficient of Variation"}, 200); } catch { rejected = true; }
    assert(rejected && !document.querySelector('[role="dialog"]'), "Missing individual setting cancels the owned dialog without submitting");
    document.getElementById("missing-field").checked = false;
    document.getElementById("format-toggle").dispatchEvent(new MouseEvent("mousedown", {bubbles: true}));
    document.getElementById("column-settings").click();
    const preexisting = document.querySelector('[role="dialog"]');
    rejected = false;
    try { await XanaplanAdapter.applyWidth(context, 200); } catch { rejected = true; }
    assert(rejected && preexisting.isConnected, "A preexisting user dialog is left untouched");
    Array.from(preexisting.querySelectorAll("button")).find(button => button.textContent === "Cancel").click();
    document.getElementById("reset").click();
    output.textContent = lines.join("\n") + "\n\n7/7 adapter checks passed. Live Anaplan integration remains unverified.";
  } catch (error) { output.textContent = lines.join("\n") + `\nFAIL: ${error.message}`; }
  finally { event.target.disabled = false; }
});
