import test from "node:test";
import assert from "node:assert/strict";

import type { CheckLogEntry } from "../src/log.ts";
import { replayLog } from "../src/log.ts";
import { runTabletNight } from "../src/scenario.ts";

function check(run: ReturnType<typeof runTabletNight>, beatId: string): CheckLogEntry {
  const entry = run.entries.find((e) => e.kind === "check" && e.beatId === beatId);
  assert.ok(entry && entry.kind === "check", `missing check beat ${beatId}`);
  return entry as CheckLogEntry;
}

test("泥板之夜：反绑时手动动作不可尝试，松绑后可尝试", () => {
  const run = runTabletNight("42");

  assert.equal(check(run, "take-stylus-bound").result.feasible, false);
  assert.equal(check(run, "take-stylus-bound").result.reason?.includes("反绑"), true);
  assert.equal(check(run, "move-door").result.feasible, false);
  assert.equal(check(run, "take-stylus").result.feasible, true);
  assert.ok((check(run, "take-stylus").result.capability ?? 0) > 50);
});

test("同一 seed 完全复现", () => {
  const a = runTabletNight("42");
  const b = runTabletNight("42");
  assert.deepEqual(a.entries, b.entries);
  assert.equal(a.transcript, b.transcript);
});

test("不同 seed 掷骰不同", () => {
  const a = runTabletNight("1");
  const b = runTabletNight("2");
  assert.notEqual(check(a, "speak-guard").result.roll, check(b, "speak-guard").result.roll);
});

test("场景日志可完整回放", () => {
  const run = runTabletNight("42");
  const report = replayLog(run.entries);
  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.ok(report.checks >= 8, `checks = ${report.checks}`);
});

test("场景包含信道事件与天亮事件", () => {
  const run = runTabletNight("42");
  const events = run.entries.filter((e) => e.kind === "event");
  assert.ok(events.some((e) => e.beatId === "channel-1"));
  assert.ok(events.some((e) => e.beatId === "dawn"));
});
