import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeCompetitorWeek, parseCompetitorRows, proposeCompetitorMatches, weekFromCompetitorFilename } from '../lib/competitor-import.ts';

const price = (name, high, distance = '') => ({ name, distance, guns: '', peak: '', high, flat: '', valley: '',
  electricity: { peak: '', high, flat: '', valley: '' },
  service: { peak: '', high: '0.2', flat: '', valley: '' },
  total: { peak: '', high: high === '' ? '' : String(Number(high) + 0.2), flat: '', valley: '' } });

test('reads station blocks, splits price, converts meters, and ignores placeholders', () => {
  const sites = parseCompetitorRows([{ name: '慢充', rows: [
    { A: '本站', B: '周边竞站数据', D: '本站', E: '竞站甲', G: '竞站ID' },
    {}, { B: '直流设备数量', E: '3' }, { B: '距离（m）', E: '2900' },
    { B: '电费', C: '尖段' }, { C: '峰段', E: '0.8' }, { C: '平段' }, { C: '谷段' },
    { B: '服务费', C: '尖段' }, { C: '峰段', E: '0.2' }, { C: '平段' }, { C: '谷段' },
  ] }]);
  assert.equal(weekFromCompetitorFilename('10月3周-周边竞站价格表.xlsx'), '2026年10月3周');
  assert.equal(sites[0].competitors.length, 1);
  assert.equal(sites[0].competitors[0].distance, '2900m');
  assert.equal(sites[0].competitors[0].total.high, '1');
  assert.equal(sites[0].competitors[0].total.peak, '');
});

test('same-week reimport keeps nonblank fields and other weeks; explicit clear removes blanks', () => {
  const old = price('竞站甲', '0.8', '0.9km');
  const history = { '2026年10月2周': [old], '2026年10月3周': [old] };
  const incoming = price('竞站甲', '', '');
  const decisions = proposeCompetitorMatches('本站', [incoming], history['2026年10月3周']);
  const retained = mergeCompetitorWeek(history, '2026年10月3周', decisions);
  assert.equal(retained['2026年10月3周'][0].distance, '900m');
  assert.equal(retained['2026年10月3周'][0].total.high, '1');
  assert.deepEqual(retained['2026年10月2周'], [old]);
  const cleared = mergeCompetitorWeek(history, '2026年10月3周', decisions, true);
  assert.equal(cleared['2026年10月3周'][0].distance, '');
  assert.equal(cleared['2026年10月3周'][0].total.high, '');
});

test('similar competitor name requires confirmation, while new name can be added', () => {
  const choices = proposeCompetitorMatches('本站',
    [price('某商场东门超充站', '0.7'), price('另一座充电站', '0.7')],
    [price('某商场东门充电站', '0.8')]);
  assert.deepEqual(choices.map((choice) => choice.kind), ['pending', 'new']);
  const saved = mergeCompetitorWeek({}, '2026年10月3周', choices);
  assert.equal(saved['2026年10月3周'].length, 1);
});

test('own station is never imported as a competitor', () => {
  const sites = parseCompetitorRows([{ name: '周报', rows: [
    { A: '本站', B: '周边竞站数据', D: '本站', E: '本站', G: '竞站甲' },
    {}, { B: '直流设备数量', E: '4', G: '6' }, { B: '距离（m）', G: '500' },
    { B: '电费', C: '尖段' }, { C: '峰段', E: '0.9', G: '0.8' }, { C: '平段' }, { C: '谷段' },
    { B: '服务费', C: '尖段' }, { C: '峰段', E: '0.1', G: '0.2' }, { C: '平段' }, { C: '谷段' },
  ] }]);
  assert.deepEqual(sites[0].competitors.map((row) => row.name), ['竞站甲']);
  assert.deepEqual(proposeCompetitorMatches('本站', [price('本站', '0.9'), price('竞站甲', '0.8')], [] ).map((row) => row.targetName), ['竞站甲']);
  const malicious = [{ site: '本站', source: price('本站', '0.9'), targetName: '本站', kind: 'new' }];
  assert.deepEqual(mergeCompetitorWeek({}, '2026年10月3周', malicious)['2026年10月3周'], []);
});
