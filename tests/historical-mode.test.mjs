import test from 'node:test';
import assert from 'node:assert/strict';
import * as metrics from '../lib/operating-metrics.ts';
test('分类历史日使用当周价格，禁止套用未来规则',()=>{
 const result=metrics.calculateHistoricalModeDay({date:'2026-10-04',charge:10,peak:0,high:4,flat:3,valley:3},{servicePricesJson:JSON.stringify({'2026年10月1周':{peak:'.2',high:'.2',flat:'.2',valley:'.2'},'2026年10月3周':{peak:'9',high:'9',flat:'9',valley:'9'}}),electricityPricesJson:JSON.stringify({'2026年10月1周':{peak:'.7',high:'.7',flat:'.5',valley:'.3'}}),purchaseCostType:'一口价',unifiedPrice:'.4'},{});
 assert.equal(result.serviceRevenue,2);assert.ok(Math.abs(result.electricityRevenue-5.2)<1e-8);assert.ok(Math.abs(result.profit-3.2)<1e-8);
});
test('不完整分时数据不能生成经营金额',()=>{
 const r=metrics.calculateHistoricalModeDay({date:'2026-10-10',charge:10,peak:null,high:null,flat:null,valley:null},{},{});assert.equal(r.profit,null);assert.equal(r.electricityRevenue,null);
});

test('站点级月成本优先于全局成本，跨月不混用',()=>{
 const config={purchaseCostType:'大工业电价',externalPricesJson:JSON.stringify({'2026年9月2周':{peak:'1.2',high:'1.2',flat:'1.2',valley:'1.2'}}),servicePricesJson:JSON.stringify({'2026年9月2周':{peak:'.1',high:'.1',flat:'.1',valley:'.1'}}),monthlyCostsJson:JSON.stringify({'9':{'大工业电价':{peak:'.749315',high:'.749315',flat:'.513997',valley:'.278679'}},'10':{'大工业电价':{peak:'.723618',high:'.723618',flat:'.495329',valley:'.26704'}}})};
 const sep=metrics.calculateHistoricalModeDay({date:'2026-09-26',charge:10,peak:0,high:0,flat:10,valley:0},config,{});
 const oct=metrics.calculateHistoricalModeDay({date:'2026-10-04',charge:10,peak:0,high:0,flat:10,valley:0},config,{});
 assert.ok(Math.abs(sep.profit-6.86003)<1e-8);assert.ok(Math.abs(oct.profit-7.04671)<1e-8);
});
