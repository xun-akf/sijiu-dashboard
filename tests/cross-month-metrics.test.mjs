import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateOperatingMetrics } from '../lib/operating-metrics.ts';

test('a single cross-month week sums metrics using each calendar month cost', () => {
  const record = {
    week: '2026年9月5周', charge: 20, peak: 0, high: 0, flat: 20, valley: 0,
    weeklySegments: [
      { week: '2026年9月5周', charge: 10, peak: 0, high: 0, flat: 10, valley: 0 },
      { week: '2026年10月1周', charge: 10, peak: 0, high: 0, flat: 10, valley: 0 },
    ],
  };
  const config = {
    purchaseCostType: '售电价',
    servicePricesJson: JSON.stringify({ '2026年9月5周': { high: '0.2', flat: '0.2', valley: '0.2' }, '2026年10月1周': { high: '0.3', flat: '0.3', valley: '0.3' } }),
    externalPricesJson: JSON.stringify({ '2026年9月5周': { high: '1', flat: '1', valley: '1' }, '2026年10月1周': { high: '1.2', flat: '1.2', valley: '1.2' } }),
  };
  const monthly = {
    monthlyCostsJson: JSON.stringify({ '9': { '售电价': { high: '0.4', flat: '0.4', valley: '0.4' } }, '10': { '售电价': { high: '0.5', flat: '0.5', valley: '0.5' } } }),
    gridFeesJson: JSON.stringify({ '9': '0.1', '10': '0.2' }),
  };
  const result = calculateOperatingMetrics(record, config, monthly);
  assert.equal(result.serviceRevenue, 5);
  assert.equal(result.profit, 10);
});

test('corrected October cost overrides a station copy of the old monthly template', () => {
  const config = {
    billingType: '大工业电价',
    monthlyCostsJson: JSON.stringify({ '10': { '大工业电价': { peak: '0.8', high: '0.7', flat: '0.723618', valley: '0.2' } } }),
    servicePricesJson: JSON.stringify({ '2026年10月2周': { peak: '0.2', high: '0.2', flat: '0.2', valley: '0.2' } }),
    electricityPricesJson: JSON.stringify({ '2026年10月2周': { peak: '0.55', high: '0.55', flat: '0.55', valley: '0.55' } }),
  };
  const monthly = {
    monthlyCostsJson: JSON.stringify({ '2026-10': { '大工业电价': { peak: '0.845373', high: '0.723618', flat: '0.495329', valley: '0.26704' } } }),
  };
  const result = calculateOperatingMetrics({ week: '2026年10月2周', charge: 10623, peak: 0, high: 0, flat: 10623, valley: 0 }, config, monthly);
  assert.ok(Math.abs(result.profit - 10623 * (0.75 - 0.495329)) < 1e-8);
});
