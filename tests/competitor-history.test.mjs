import assert from 'node:assert/strict';
import test from 'node:test';
import { compareCompetitorWeeks, competitorAdvantageChange, readCompetitorHistory, saveCompetitorWeek } from '../lib/competitor-history.ts';

const row = (name, prices) => ({ name, distance: '300m', guns: '8', ...prices });

test('only the same competitor and recorded periods are compared', () => {
  const prior = [row('甲站', { peak: '1.2', high: '1.0', flat: '0.8', valley: '' })];
  const now = [row('甲站', { peak: '1.3', high: '0.9', flat: '0.8', valley: '0.4' }), row('新站', { flat: '0.5' })];
  const result = compareCompetitorWeeks(now, prior);
  assert.equal(result.comparable, 1);
  assert.equal(result.steady, 1);
  assert.equal(result.changes.get('甲站').periods.peak.toFixed(2), '0.10');
  assert.equal(result.changes.get('甲站').periods.high.toFixed(2), '-0.10');
  assert.equal(result.changes.get('甲站').periods.valley, null);
  assert.equal(result.changes.get('新站').average, null);
});

test('missing week stays missing, while price advantage uses matched periods', () => {
  const prior = [row('甲站', { flat: '0.8' })];
  const now = [row('甲站', { flat: '0.9' })];
  assert.deepEqual(readCompetitorHistory('invalid'), {});
  assert.equal(compareCompetitorWeeks(now).comparable, 0);
  assert.equal(competitorAdvantageChange(now, prior, { flat: '0.7' }, { flat: '0.7' }).toFixed(2), '0.10');
  assert.equal(competitorAdvantageChange(now, prior, { flat: '0.7' }, null), null);
});

test('saving a new week preserves the previous week after serialization', () => {
  const previous = [row('甲站', { flat: '0.8' })];
  const current = [row('甲站', { flat: '0.9' })];
  const stored = saveCompetitorWeek({ '2026年10月1周': previous }, '2026年10月2周', current);
  const reloaded = readCompetitorHistory(JSON.stringify(stored));
  assert.equal(reloaded['2026年10月1周'][0].flat, '0.8');
  assert.equal(reloaded['2026年10月2周'][0].flat, '0.9');
});
