import assert from 'node:assert/strict';
import test from 'node:test';
import { weekLabelFromDateUtc } from '../lib/weekly-period.mjs';

test('cross-month dates share the Sunday-to-Saturday week label', () => {
  for (const day of [27, 28, 29, 30]) {
    assert.equal(weekLabelFromDateUtc(new Date(Date.UTC(2026, 8, day))), '2026年9月5周');
  }
  for (const day of [1, 2, 3]) {
    assert.equal(weekLabelFromDateUtc(new Date(Date.UTC(2026, 9, day))), '2026年9月5周');
  }
  assert.notEqual(weekLabelFromDateUtc(new Date(Date.UTC(2026, 9, 4))), '2026年9月5周');
});

test('the first full October Sunday-to-Saturday week is October week one', () => {
  for (const day of [4, 5, 6, 7, 8, 9, 10]) {
    assert.equal(weekLabelFromDateUtc(new Date(Date.UTC(2026, 9, day))), '2026年10月1周');
  }
  assert.equal(weekLabelFromDateUtc(new Date(Date.UTC(2026, 7, 30))), '2026年9月1周');
});
