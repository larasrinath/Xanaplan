const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/core.js');

test('widths respect the native 6–800 px limits', () => {
  assert.equal(core.clampWidth(-500), 6);
  assert.equal(core.clampWidth(1000), 800);
  assert.equal(core.clampWidth(140.6), 141);
  for (const invalid of [NaN, Infinity, -Infinity, undefined, '100']) {
    assert.throws(() => core.clampWidth(invalid), TypeError);
  }
});
test('only a leaf column header in the first header level is accepted', () => {
  assert.deepEqual(core.parseHeaderId('anaplan/gridlet/_LinkMixin_4_cell_x_3_ny_0'),
    {gridId: 'anaplan/gridlet/_LinkMixin_4', column: 3});
  for (const id of ['grid_cell_x_3_y_0', 'grid_cell_nx_0_ny_0', 'grid_cell_x_3_ny_1', 'unrelated']) {
    assert.equal(core.parseHeaderId(id), null);
  }
});
test('AutoFit includes padding, can shrink, and caps long content', () => {
  assert.equal(core.fitWidth([34, 60.5, 49]), 75);
  assert.equal(core.fitWidth([4]), 18);
  assert.equal(core.fitWidth([2000]), 800);
  assert.throws(() => core.fitWidth([]));
});
