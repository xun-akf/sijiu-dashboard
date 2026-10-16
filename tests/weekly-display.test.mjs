import test from 'node:test';
import assert from 'node:assert/strict';
import { displayedModeMetric, sumAvailableMetrics, operatorChoices, scopedStationNames, reportingStationNames } from '../lib/weekly-display.ts';

const prior = { charge: 121.01, serviceRevenue: 12.1, electricityRevenue: 45.3, profit: 19.4 };

test('全部周报优先显示已保存的真实经营结果，分类筛选不能继承总量', () => {
  assert.equal(displayedModeMetric('all', 'week', prior, null, 'serviceRevenue'), 12.1);
  assert.equal(displayedModeMetric('all', 'week', prior, null, 'profit'), 19.4);
  assert.equal(displayedModeMetric('fast', 'week', prior, null, 'profit'), null);
  assert.equal(displayedModeMetric('all', 'month', prior, null, 'profit'), null);
  assert.equal(displayedModeMetric('slow', 'week', prior, 3.25, 'profit'), 3.25);
});

test('部分场站缺金额时仍显示可核算小计及覆盖数，不把空值当零', () => {
  assert.deepEqual(sumAvailableMetrics([19.4, null, 0, 3.25]), {value:22.65, available:3, total:4});
  assert.deepEqual(sumAvailableMetrics([null, null]), {value:null, available:0, total:2});
});

test('运营商选项只来自授权站，并保留数据库归属优先于目录归属', () => {
  const names=['A','B','C'];
  const catalog={A:'四九实业',B:'蔚铭充',C:'四川飞凡',D:'阳充充电'};
  const database={B:'阳充充电'};
  assert.deepEqual(operatorChoices(names,catalog,database),['四川飞凡','四九实业','阳充充电'].sort((a,b)=>a.localeCompare(b,'zh-CN')));
  assert.deepEqual(scopedStationNames(names,'阳充充电',catalog,database),['B']);
  assert.deepEqual(scopedStationNames(names,'全部运营商',catalog,database),names);
});

test('未录入经营周次的档案不进入经营汇总，月度按该月所有周查找', () => {
  const stations=[
    {name:'旧站',records:[{week:'2026年9月1周'},{week:'2026年10月1周'}]},
    {name:'新增站',records:[{week:'2026年9月2周'}]},
    {name:'待上线',records:[]},
  ];
  assert.deepEqual(reportingStationNames(stations,'2026年9月1周','week'),['旧站']);
  assert.deepEqual(reportingStationNames(stations,'2026年9月1周','month'),['旧站','新增站']);
});
