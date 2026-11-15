import test from "node:test";
import assert from "node:assert/strict";

import { runParity } from "../src/parity.ts";

const report = runParity("test");

test("parity 覆盖 7 身体 × 12 动作", () => {
  assert.equal(report.rows.length, 84);
  assert.equal(report.byVariant.length, 7);
});

test("硬约束可行性 100% 一致", () => {
  assert.equal(report.overall.feasibleAgreement, 1);
  assert.equal(report.failures.length, 0, report.failures.join("\n"));
});

test("基线 C 与 v0 对齐", () => {
  assert.ok(report.baseline.meanCDiff <= 2, `C 平均差 ${report.baseline.meanCDiff}`);
  assert.equal(report.baseline.outcomeAgreement, 1);
});

test("总体结果一致率 ≥ 80%", () => {
  assert.ok(report.overall.outcomeAgreement >= 0.8, `${report.overall.outcomeAgreement}`);
});

test("蒙眼/缺手出现可解释的瓶颈差异", () => {
  assert.ok(report.expectedDivergences.length >= 1);
});
