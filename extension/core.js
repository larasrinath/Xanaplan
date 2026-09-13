(() => {
  "use strict";
  const MIN_WIDTH = 6;
  const MAX_WIDTH = 800;
  function clampWidth(value) {
    if (!Number.isFinite(value)) throw new TypeError("Width must be a finite number.");
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
  }
  function parseHeaderId(id) {
    const match = /^(.*)_cell_x_(\d+)_ny_0$/.exec(id);
    return match ? { gridId: match[1], column: Number(match[2]) } : null;
  }
  function fitWidth(measurements) {
    if (!measurements.length) throw new Error("No rendered cells to measure.");
    return clampWidth(Math.ceil(Math.max(...measurements)) + 14);
  }
  const api = Object.freeze({ MIN_WIDTH, MAX_WIDTH, clampWidth, parseHeaderId, fitWidth });
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.XanaplanCore = api;
})();
