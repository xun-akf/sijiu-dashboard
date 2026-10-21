import test from "node:test";
import assert from "node:assert/strict";
import { upsertModeFacts, summarizeMode, modeFactsInRange, reconcileModes, calendarMonthRange, sundaySaturdayRange, classifyDayOperatingMetrics } from "../lib/charging-mode.ts";

test("本周分类金额只能使用本周日期，不能沿用上周快充记录", () => {
  const facts = [sample("2026-10-10", "fast", 100), sample("2026-10-12", "slow", 20)];
  assert.deepEqual(modeFactsInRange(facts, "fast", "2026-10-11", "2026-10-17"), []);
  assert.equal(modeFactsInRange(facts, "slow", "2026-10-11", "2026-10-17").length, 1);
});

const sample = (date, mode, charge, extra = {}) => ({
  stationName: "测试站", date, mode, deviceId: null,
  charge, peak: null, high: null, flat: null, valley: null, orders: null, ...extra,
});

test("重复导入同站同日同模式覆盖，且另一设备不会被覆盖", () => {
  const first = sample("2026-10-18", "fast", 100);
  const updated = sample("2026-10-18", "fast", 120);
  const other = sample("2026-10-18", "fast", 40, { deviceId: "枪02" });
  const result = upsertModeFacts([first], [updated, other]);
  assert.equal(result.length, 2);
  assert.equal(summarizeMode(result, "2026-10-18", "2026-10-18", "fast").charge, 160);
});

test("自然月只取本月真实日期，缺少分时保留空值", () => {
  const facts = [
    sample("2026-09-30", "slow", 50),
    sample("2026-10-01", "slow", 20),
    sample("2026-10-31", "slow", 30),
  ];
  const range = calendarMonthRange(2026, 10);
  assert.deepEqual(range, { start: "2026-10-01", end: "2026-10-31" });
  assert.deepEqual(summarizeMode(facts, range.start, range.end, "slow"), {
    charge: 50, peak: null, high: null, flat: null, valley: null,
    orders: null, days: 2, rows: 2,
  });
});

test("未分类电量只算差额，分类超过总量明确报错差", () => {
  const fast = summarizeMode([sample("2026-10-18", "fast", 60)], "2026-10-18", "2026-10-18", "fast");
  const slow = summarizeMode([sample("2026-10-18", "slow", 20)], "2026-10-18", "2026-10-18", "slow");
  assert.deepEqual(reconcileModes(100, fast, slow), { fast: 60, slow: 20, unclassified: 20, excess: 0 });
  assert.deepEqual(reconcileModes(70, fast, slow), { fast: 60, slow: 20, unclassified: null, excess: 10 });
});

test("分类分时不平衡拒绝写入", () => {
  assert.throws(() => upsertModeFacts([], [sample("2026-10-18", "fast", 10, { peak: 2, high: 2, flat: 2, valley: 2 })]), /不一致/);
});

test("10月1周及跨月周按真实周日周六，不挪用自然月", () => {
  assert.deepEqual(sundaySaturdayRange("2026年10月1周"), {start:"2026-10-04",end:"2026-10-10"});
  assert.deepEqual(sundaySaturdayRange("2026年9月5周"), {start:"2026-09-27",end:"2026-10-03"});
});

test("按日生效价格与当月购电成本算分类收入，旧日不回套新价", () => {
  const fact=sample("2026-10-18","fast",10,{peak:0,high:4,flat:3,valley:3});
  const windows=[
    {start:"00:00",end:"08:00",period:"谷",electricity:.3,service:.2},
    {start:"08:00",end:"12:00",period:"峰",electricity:.7,service:.2},
    {start:"12:00",end:"24:00",period:"平",electricity:.5,service:.2},
  ];
  const tariff=[{station_name:"测试站",charging_mode:"fast",effective_from:"2026-10-18",effective_until:null,windows}];
  const monthly={monthlyCostsJson:JSON.stringify({"2026-10":{"大工业电价":{peak:"0.6",high:"0.6",flat:"0.4",valley:"0.2"}}})};
  const result=classifyDayOperatingMetrics(fact,tariff,{},monthly);
  assert.ok(Math.abs(result.electricityRevenue-5.2)<1e-9);
  assert.equal(result.serviceRevenue,2);
  assert.ok(Math.abs(result.profit-3.0)<1e-9);
  assert.deepEqual(classifyDayOperatingMetrics({...fact,date:"2026-10-17"},tariff,{},monthly),{electricityRevenue:null,serviceRevenue:null,profit:null});
});

test("分类利润使用当年修正成本，不被场站旧月份模板覆盖", () => {
  const fact=sample("2026-10-18","fast",10,{peak:0,high:0,flat:10,valley:0});
  const tariff=[{station_name:"测试站",charging_mode:"fast",effective_from:"2026-10-18",effective_until:null,windows:[{start:"00:00",end:"24:00",period:"平",electricity:0.55,service:0.2}]}];
  const station={billingType:"大工业电价",monthlyCostsJson:JSON.stringify({"10":{"大工业电价":{flat:"0.723618"}}})};
  const monthly={monthlyCostsJson:JSON.stringify({"2026-10":{"大工业电价":{flat:"0.495329"}}})};
  const result=classifyDayOperatingMetrics(fact,tariff,station,monthly);
  assert.ok(Math.abs(result.profit-10*(0.75-0.495329))<1e-9);
});
