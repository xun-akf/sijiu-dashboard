import test from "node:test";
import assert from "node:assert/strict";
import { modeKeys, selectModeNumber, scopedModeSummary } from "../lib/mode-view.ts";

test("单模式筛选只返回对应分类字段", () => {
  assert.deepEqual(modeKeys("fast"), ["fast"]);
  assert.deepEqual(modeKeys("slow"), ["slow"]);
  assert.deepEqual(modeKeys("all"), ["fast", "slow"]);
});

test("混合站在全部模式合计一次，单模式不夹带另一模式", () => {
  assert.equal(selectModeNumber("all", 10, 4), 14);
  assert.equal(selectModeNumber("fast", 10, 4), 10);
  assert.equal(selectModeNumber("slow", 10, 4), 4);
});

test("模式汇总保留缺失状态，不把无数据转成零", () => {
  assert.deepEqual(scopedModeSummary("fast", { value: 12, available: true }, { value: 8, available: true }), { value: 12, available: true });
  assert.deepEqual(scopedModeSummary("slow", { value: 12, available: true }, { value: 0, available: false }), { value: null, available: false });
  assert.deepEqual(scopedModeSummary("all", { value: 12, available: true }, { value: 0, available: false }), { value: 12, available: true });
  assert.deepEqual(scopedModeSummary("all", { value: 0, available: false }, { value: 0, available: false }), { value: null, available: false });
});
