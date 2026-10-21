import test from 'node:test';
import assert from 'node:assert/strict';
import { chartScale, visibleTrendCount } from '../lib/chart-presentation.mjs';

test('17万度使用真实零基线、0至20万和5万刻度', () => {
  assert.deepEqual(chartScale([140000, 170000]).ticks, [0, 50000, 100000, 150000, 200000]);
  assert.deepEqual(chartScale([0, 121.01]).ticks, [0, 50, 100, 150, 200]);
  assert.deepEqual(chartScale([0, 0]).ticks, [0, 1, 2, 3, 4]);
});

test('周图最多展示12个已有周期，月图保持8个月', () => {
  assert.equal(visibleTrendCount([140, 155, 170, 150, 160, 172, 149, 166]), 8);
  assert.equal(visibleTrendCount(Array(12).fill(160)), 12);
  assert.equal(visibleTrendCount(Array(18).fill(160)), 12);
  assert.equal(visibleTrendCount(Array(9).fill(160)), 9);
  assert.equal(visibleTrendCount([121.01]), 1);
  assert.equal(visibleTrendCount(Array(12).fill(160), 'month'), 8);
});
