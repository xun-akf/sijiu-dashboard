import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDiscountedPeriods, deriveActivityComponents } from '../app/market-discount.ts';

const totals = { peak: '', high: '1.1043', flat: '0.8113', valley: '0.5139' };
const services = { peak: '', high: '0.1190', flat: '0.1190', valley: '0.1369' };

test('discount changes only service fee and preserves original electricity', () => {
  const result = calculateDiscountedPeriods(totals, services, 70);
  assert.equal(result.electricity.high, '0.9853');
  assert.equal(result.service.high, '0.0833');
  assert.equal(result.total.high, '1.0686');
  assert.equal(result.electricity.flat, '0.6923');
  assert.equal(result.total.valley, '0.4728');
  assert.equal(totals.high, '1.1043');
  assert.equal(services.high, '0.1190');
});

test('missing original service fee does not infer breakdown from settlement', () => {
  const result = calculateDiscountedPeriods(totals, { ...services, high: '' }, 70);
  assert.equal(result.electricity.high, '');
  assert.equal(result.service.high, '');
  assert.equal(result.total.high, '');
  assert.equal(result.total.flat, '0.7756');
});

test('rejects out-of-range discounts', () => {
  assert.throws(() => calculateDiscountedPeriods(totals, services, -1));
  assert.throws(() => calculateDiscountedPeriods(totals, services, 101));
});

test('shows imported activity split only when original components support it', () => {
  const imported = { peak: '', high: '1.0533', flat: '0.7603', valley: '0.4553' };
  const result = deriveActivityComponents(totals, services, imported);
  assert.equal(result.electricity.high, '0.9853');
  assert.equal(result.service.high, '0.0680');
  assert.equal(result.total.high, '1.0533');
  const invalid = deriveActivityComponents(totals, services, { ...imported, high: '0.9000' });
  assert.equal(invalid.service.high, '');
  assert.equal(invalid.total.high, '0.9000');
});
