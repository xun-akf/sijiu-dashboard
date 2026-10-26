import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCompetitorOverview } from '../lib/competitor-overview.ts';

const row = (name, high, flat = '') => ({ name, distance: '', guns: '', peak: '', high, flat, valley: '' });
const config = (two, three) => ({ competitorsByWeekJson: JSON.stringify({
  '2026年10月2周': two, '2026年10月3周': three,
}) });

test('deduplicates a competitor shared by stations and sorts material changes', () => {
  const sharedPrior = row('中石油 站', '1.1');
  const sharedNow = row('中石油站', '0.9');
  const data = {
    A: config([sharedPrior, row('小站', '0.8')], [sharedNow, row('小站', '0.85')]),
    B: config([sharedPrior], [sharedNow]),
  };
  const overview = buildCompetitorOverview(data, ['A', 'B'], ['2026年10月2周']);
  assert.equal(overview.week, '2026年10月3周');
  assert.equal(overview.previousWeek, '2026年10月2周');
  assert.equal(overview.falling, 1);
  assert.equal(overview.rising, 1);
  assert.equal(overview.items.length, 2);
  assert.equal(overview.items[0].magnitude, 0.2);
  assert.deepEqual(overview.items[0].stations, ['A', 'B']);
});

test('does not compare across a missing intervening week or mislabel mixed changes', () => {
  const data = { A: { competitorsByWeekJson: JSON.stringify({
    '2026年10月1周': [row('旧站', '1')],
    '2026年10月3周': [row('旧站', '1.1')],
  }) } };
  const unavailable = buildCompetitorOverview(data, ['A'], ['2026年10月1周', '2026年10月2周']);
  assert.equal(unavailable.unavailable, 1);
  assert.equal(unavailable.rising, 0);
  const mixed = buildCompetitorOverview({ A: config([row('双向站', '1', '1')], [row('双向站', '1.1', '0.9')]) }, ['A'], ['2026年10月2周']);
  assert.equal(mixed.mixed, 1);
  assert.equal(mixed.steady, 0);
});

test('conflicting duplicate prices are excluded from change counts', () => {
  const result = buildCompetitorOverview({
    A: config([row('共用站', '1')], [row('共用站', '1.1')]),
    B: config([row('共用站', '1')], [row('共用站', '1.2')]),
  }, ['A', 'B'], ['2026年10月2周']);
  assert.equal(result.conflict, 1);
  assert.equal(result.rising, 0);
});
