import test from 'node:test';import assert from 'node:assert/strict';import * as m from '../lib/order-mode-import.ts';
test('订单跨表去重，只统计目录内实际模式，异常分时保留总量',()=>{
 const r={服务交易号:'S1',充电站名称:'雅悦慢充',日期:'2026-10-04',充电模式:'交流',充电总电量:'10',尖时电量:'0',峰时电量:'0',平时电量:'9.9',谷时电量:'0',会员手机:'private'};
 const out=m.aggregateOrderRows([r,r,{...r,服务交易号:'S2',充电站名称:'目录外'}],['雅悦慢充'],{});
 assert.equal(out.rows.length,1);assert.equal(out.rows[0].charge,10);assert.equal(out.rows[0].flat,null);assert.equal(out.rows[0].mode,'slow');assert.equal(out.duplicateOrders,1);assert.equal(out.ignoredEnergy,10);assert.equal(JSON.stringify(out).includes('private'),false);
});
