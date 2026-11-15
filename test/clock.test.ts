import test from "node:test";
import assert from "node:assert/strict";

import type { ClockSpec } from "../src/contracts/index.ts";
import {
  DEFAULT_CLOCK_SPEC,
  WorldClock,
  realMsPerTick,
  validateClockSpec,
} from "../src/kernel/clock.ts";

const T0 = 1_700_000_000_000;
const MINUTE = 60_000;
const TICK_MS = 10 * MINUTE;

function spec(overrides: Partial<ClockSpec> = {}): ClockSpec {
  return { ...DEFAULT_CLOCK_SPEC, mode: "realtime", ...overrides };
}

function at(minutes: number): number {
  return T0 + minutes * MINUTE;
}

test("默认时钟合法：10 世界分/tick，144 tick/日", () => {
  validateClockSpec(DEFAULT_CLOCK_SPEC);
  assert.equal(DEFAULT_CLOCK_SPEC.tickMinutes * DEFAULT_CLOCK_SPEC.ticksPerDay, 1440);
  assert.equal(realMsPerTick(DEFAULT_CLOCK_SPEC), TICK_MS);
});

test("tick 边界：不足一个 tick 不推进，恰好到点推进", () => {
  const clock = new WorldClock(spec(), { epochRealMs: T0 });
  assert.equal(clock.tickAt(T0), 0);
  assert.equal(clock.tickAt(T0 - 1), 0);
  assert.equal(clock.tickAt(T0 + TICK_MS - 1), 0);
  assert.equal(clock.tickAt(T0 + TICK_MS), 1);
  assert.equal(clock.tickAt(T0 + 2 * TICK_MS - 1), 1);
  assert.equal(clock.tickAt(T0 + 2 * TICK_MS), 2);
});

test("1:1 比例：现实 10 分钟 = 世界 10 分钟 = 1 tick", () => {
  const clock = new WorldClock(spec({ timeScale: 1 }), { epochRealMs: T0 });
  assert.equal(clock.tickAt(at(10)), 1);
  assert.equal(clock.tickAt(at(60)), 6);
  assert.equal(clock.tickAt(at(24 * 60)), 144);
});

test("60x 比例：现实 1 分钟 = 世界 1 小时 = 6 tick", () => {
  const clock = new WorldClock(spec({ timeScale: 60 }), { epochRealMs: T0 });
  assert.equal(realMsPerTick(spec({ timeScale: 60 })), 10_000);
  assert.equal(clock.tickAt(at(1)), 6);
  assert.equal(clock.tickAt(at(24)), 144);
  // 3 个世界日 = 72 世界小时 = 现实 72 分钟。
  assert.equal(clock.tickAt(at(72)), 432);
});

test("0.5x 比例：现实 20 分钟才推进 1 tick", () => {
  const clock = new WorldClock(spec({ timeScale: 0.5 }), { epochRealMs: T0 });
  assert.equal(clock.tickAt(at(19)), 0);
  assert.equal(clock.tickAt(at(20)), 1);
});

test("已追上返回 null；非法 afterTick 直接失败", () => {
  const clock = new WorldClock(spec(), { epochRealMs: T0 });
  assert.equal(clock.dueTicks(at(10), 1), null);
  assert.equal(clock.dueTicks(at(9), 1), null);
  assert.throws(() => clock.dueTicks(at(10), -1), /afterTick/);
  assert.throws(() => clock.dueTicks(at(10), 1.5), /afterTick/);
});

test("长离线按上限逐轮补齐，不跳 tick", () => {
  const clock = new WorldClock(spec({ maxCatchUpTicks: 24 }), { epochRealMs: T0 });
  const first = clock.dueTicks(at(100 * 10), 0);
  assert.deepEqual(first, { fromTick: 1, toTick: 24, targetTick: 100, backlog: 76 });

  const second = clock.dueTicks(at(100 * 10), 24);
  assert.deepEqual(second, { fromTick: 25, toTick: 48, targetTick: 100, backlog: 52 });

  const seen: number[] = [];
  let after = 0;
  let window = clock.dueTicks(at(100 * 10), after);
  while (window) {
    for (let tick = window.fromTick; tick <= window.toTick; tick++) seen.push(tick);
    after = window.toTick;
    window = clock.dueTicks(at(100 * 10), after);
  }
  assert.equal(seen.length, 100);
  assert.deepEqual(seen, Array.from({ length: 100 }, (_, index) => index + 1));
});

test("maxCatchUpTicks = 0 表示不限，一次补齐", () => {
  const clock = new WorldClock(spec({ maxCatchUpTicks: 0 }), { epochRealMs: T0 });
  assert.deepEqual(clock.dueTicks(at(100 * 10), 0), {
    fromTick: 1,
    toTick: 100,
    targetTick: 100,
    backlog: 0,
  });
});

test("暂停冻结世界时间，恢复后不补暂停时长且比例不变", () => {
  const clock = new WorldClock(spec({ timeScale: 60 }), { epochRealMs: T0 });
  clock.pause(at(5));
  assert.equal(clock.paused, true);
  assert.equal(clock.tickAt(at(5)), 30);
  assert.equal(clock.tickAt(at(500)), 30);
  assert.equal(clock.dueTicks(at(500), 30), null);

  clock.resume(at(500));
  assert.equal(clock.paused, false);
  assert.equal(clock.epochRealMs, T0 + 495 * MINUTE);
  assert.equal(clock.tickAt(at(500)), 30);
  assert.equal(clock.tickAt(at(501)), 36);
});

test("长时间逐毫秒采样与直接计算一致，无累加漂移", () => {
  const clock = new WorldClock(spec({ timeScale: 37 }), { epochRealMs: T0 });
  const stepMs = 7_000;
  const totalMs = 2 * 24 * 60 * MINUTE;
  for (let elapsed = 0; elapsed <= totalMs; elapsed += stepMs) {
    const expected = Math.floor((elapsed * 37) / TICK_MS);
    assert.equal(clock.tickAt(T0 + elapsed), expected, `elapsed=${elapsed}`);
  }
});

test("WorldClock 可序列化/恢复，暂停状态保持自洽", () => {
  const clock = new WorldClock(spec({ timeScale: 12 }), { epochRealMs: T0, epochTick: 500 });
  clock.pause(at(10));

  const restored = WorldClock.fromJSON(JSON.parse(JSON.stringify(clock)));
  assert.equal(restored.epochRealMs, clock.epochRealMs);
  assert.equal(restored.epochTick, 500);
  assert.equal(restored.paused, true);
  assert.equal(restored.tickAt(at(999)), clock.tickAt(at(999)));

  restored.resume(at(20));
  assert.equal(restored.paused, false);
  assert.equal(restored.tickAt(at(20)), clock.tickAt(at(10)));

  const running = new WorldClock(spec(), { epochRealMs: T0 });
  const runningRestored = WorldClock.fromJSON(JSON.parse(JSON.stringify(running)));
  assert.equal(runningRestored.tickAt(at(60)), 6);
});

test("非法世界级时钟配置在装配时失败", () => {
  assert.throws(() => validateClockSpec(spec({ mode: "fast" as ClockSpec["mode"] })), /mode/);
  assert.throws(() => validateClockSpec(spec({ tickMinutes: 0 })), /tickMinutes/);
  assert.throws(() => validateClockSpec(spec({ tickMinutes: 15, ticksPerDay: 144 })), /1440/);
  assert.throws(() => validateClockSpec(spec({ ticksPerDay: 0 })), /ticksPerDay/);
  assert.throws(() => validateClockSpec(spec({ timeScale: 0 })), /timeScale/);
  assert.throws(() => validateClockSpec(spec({ maxCatchUpTicks: -1 })), /maxCatchUpTicks/);
  assert.throws(() => WorldClock.fromJSON({ spec: DEFAULT_CLOCK_SPEC }), /epochRealMs/);
  assert.throws(
    () =>
      WorldClock.fromJSON({
        spec: DEFAULT_CLOCK_SPEC,
        epochRealMs: T0,
        epochTick: 0,
        paused: true,
        pausedAtMs: Number.NaN,
        tickAtPause: 0,
      }),
    /pausedAtMs/,
  );
});
