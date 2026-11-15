/**
 * 世界时钟：把现实时间映射成世界 tick。
 *
 * 设计约束：
 * - 纯函数式映射，不读 Date.now()，由宿主传入 `realMs`；测试/回放可注入任意时间。
 * - 从锚点直接计算，不做增量累加，避免长时间运行后的漂移。
 * - 暂停时世界时间冻结；恢复时平移锚点，暂停时长不会补给世界。
 * - 单次调度有上限，长离线时逐轮补齐，不丢 tick。
 *
 * 开发/回放：`mode = "stepped"`，由测试或 CLI 直接 for 循环推进 tick。
 * 应用：`mode = "realtime"`，宿主按真实时间调用 `dueTicks()`，比例来自 `timeScale`。
 */

import type { ClockMode, ClockSpec } from "../contracts/index.ts";

export const DEFAULT_CLOCK_SPEC: ClockSpec = {
  mode: "stepped",
  tickMinutes: 10,
  ticksPerDay: 144,
  timeScale: 1,
  maxCatchUpTicks: 24,
  advanceWhenEmpty: true,
};

export const DAY_MINUTES = 24 * 60;
/** 世界从 06:00 开始，所以“日”在午夜翻页；tick 0 是 D1 06:00。 */
export const START_HOUR = 6;

const MODES: readonly ClockMode[] = ["stepped", "realtime"];

/** 世界日编号（从 0 开始）；tick 0 是 D1 06:00。 */
export function dayOf(tick: number, ticksPerDay: number): number {
  const calendarMinutes = START_HOUR * 60 + tick * (DAY_MINUTES / ticksPerDay);
  return Math.floor(calendarMinutes / DAY_MINUTES);
}

/** 一天内的 tick 序号，0 = 世界日 06:00。 */
export function tickOfDay(tick: number, ticksPerDay: number): number {
  return ((tick % ticksPerDay) + ticksPerDay) % ticksPerDay;
}

export function formatHourMinute(tick: number, _ticksPerDay: number, tickMinutes: number, startHour: number): string {
  const minutes = (startHour * 60 + tick * tickMinutes) % DAY_MINUTES;
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatTick(tick: number, ticksPerDay: number, tickMinutes: number, startHour: number): string {
  const calendarMinutes = startHour * 60 + tick * tickMinutes;
  const day = Math.floor(calendarMinutes / DAY_MINUTES) + 1;
  return `D${day} ${formatHourMinute(tick, ticksPerDay, tickMinutes, startHour)}`;
}

/** 找到覆盖 `tickOfDay` 的日程块；找不到是调用方的非法状态。 */
export function blockAt<T extends { startTick: number; endTick: number }>(schedule: T[], tickOfDayValue: number): T {
  const block = schedule.find(
    (candidate) => tickOfDayValue >= candidate.startTick && tickOfDayValue < candidate.endTick,
  );
  if (!block) throw new Error(`日程在 tickOfDay=${tickOfDayValue} 没有块`);
  return block;
}

export function isNight(activity: string): boolean {
  return activity === "sleep";
}

function assertPositiveFinite(value: number, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`ClockSpec.${field} 必须是大于 0 的有限数，收到 ${String(value)}`);
  }
}

/** 校验世界级时钟配置；非法配置在装配时失败，而不是运行到一半才偏。 */
export function validateClockSpec(spec: ClockSpec): void {
  if (!spec || typeof spec !== "object") throw new Error("ClockSpec 必须是对象");
  if (!MODES.includes(spec.mode)) {
    throw new Error(`ClockSpec.mode 必须是 ${MODES.join(" / ")}，收到 ${String(spec.mode)}`);
  }
  assertPositiveFinite(spec.tickMinutes, "tickMinutes");
  if (!Number.isInteger(spec.ticksPerDay) || spec.ticksPerDay <= 0) {
    throw new Error(`ClockSpec.ticksPerDay 必须是正整数，收到 ${String(spec.ticksPerDay)}`);
  }
  assertPositiveFinite(spec.timeScale, "timeScale");
  if (!Number.isInteger(spec.maxCatchUpTicks) || spec.maxCatchUpTicks < 0) {
    throw new Error(`ClockSpec.maxCatchUpTicks 必须是 >= 0 的整数，收到 ${String(spec.maxCatchUpTicks)}`);
  }
  if (typeof spec.advanceWhenEmpty !== "boolean") {
    throw new Error("ClockSpec.advanceWhenEmpty 必须是布尔值");
  }
  const dayMinutes = spec.tickMinutes * spec.ticksPerDay;
  if (Math.abs(dayMinutes - DAY_MINUTES) > 1e-9) {
    throw new Error(
      `ClockSpec 的一天必须是 ${DAY_MINUTES} 世界分钟，当前 tickMinutes * ticksPerDay = ${dayMinutes}`,
    );
  }
}

/** 一个 tick 对应的现实毫秒数；`timeScale` 越大，世界推进越快。 */
export function realMsPerTick(spec: Pick<ClockSpec, "tickMinutes" | "timeScale">): number {
  assertPositiveFinite(spec.tickMinutes, "tickMinutes");
  assertPositiveFinite(spec.timeScale, "timeScale");
  return (spec.tickMinutes * 60_000) / spec.timeScale;
}

export interface ClockAnchor {
  /** 锚点现实时间（Unix epoch ms）。 */
  epochRealMs: number;
  /** 锚点对应的世界 tick；默认 0。 */
  epochTick?: number;
}

export interface DueTicks {
  /** 本轮第一个应处理的 tick（含）。 */
  fromTick: number;
  /** 本轮最后一个应处理的 tick（含）。 */
  toTick: number;
  /** 现实时间目前对应的 tick；与 toTick 的差是 backlog。 */
  targetTick: number;
  /** 超出本轮上限、留给下一轮的 tick 数。 */
  backlog: number;
}

export interface SerializedWorldClock {
  spec: ClockSpec;
  epochRealMs: number;
  epochTick: number;
  paused: boolean;
  pausedAtMs: number | null;
  tickAtPause: number | null;
}

/**
 * 由 Scheduler 独占推进的世界时钟。它不是事件来源，也不写世界：
 * 它只回答“现在应该跑到哪个 tick”。
 */
export class WorldClock {
  readonly spec: ClockSpec;
  #epochRealMs: number;
  #epochTick: number;
  #paused = false;
  #pausedAtMs: number | null = null;
  #tickAtPause: number | null = null;

  constructor(spec: ClockSpec, anchor: ClockAnchor) {
    validateClockSpec(spec);
    if (!Number.isFinite(anchor.epochRealMs)) {
      throw new Error(`ClockAnchor.epochRealMs 必须是有限数，收到 ${String(anchor.epochRealMs)}`);
    }
    const epochTick = anchor.epochTick ?? 0;
    if (!Number.isInteger(epochTick) || epochTick < 0) {
      throw new Error(`ClockAnchor.epochTick 必须是 >= 0 的整数，收到 ${String(epochTick)}`);
    }
    this.spec = Object.freeze({ ...spec });
    this.#epochRealMs = anchor.epochRealMs;
    this.#epochTick = epochTick;
  }

  get epochRealMs(): number {
    return this.#epochRealMs;
  }

  get epochTick(): number {
    return this.#epochTick;
  }

  get paused(): boolean {
    return this.#paused;
  }

  /** 现实时间对应的 tick；暂停时冻结在暂停点，早于锚点按锚点算。 */
  tickAt(realMs: number): number {
    if (!Number.isFinite(realMs)) throw new Error(`realMs 必须是有限数，收到 ${String(realMs)}`);
    if (this.#paused) return this.#tickAtPause as number;
    return this.#tickAtUnpaused(realMs);
  }

  /**
   * 本轮应处理的 tick 窗口。已经追上返回 null。
   * 有 backlog 时不会跳 tick：下一轮从 `toTick + 1` 继续。
   */
  dueTicks(realMs: number, afterTick: number): DueTicks | null {
    if (!Number.isInteger(afterTick) || afterTick < 0) {
      throw new Error(`afterTick 必须是 >= 0 的整数，收到 ${String(afterTick)}`);
    }
    const targetTick = this.tickAt(realMs);
    if (targetTick <= afterTick) return null;
    const fromTick = afterTick + 1;
    const limit = this.spec.maxCatchUpTicks;
    const toTick = limit > 0 ? Math.min(targetTick, afterTick + limit) : targetTick;
    return { fromTick, toTick, targetTick, backlog: targetTick - toTick };
  }

  /** 暂停世界时间；重复调用无副作用。 */
  pause(realMs: number): void {
    if (this.#paused) return;
    this.#tickAtPause = this.#tickAtUnpaused(realMs);
    this.#pausedAtMs = realMs;
    this.#paused = true;
  }

  /** 恢复世界时间；暂停期间不计入世界时间，恢复后比例不变。 */
  resume(realMs: number): void {
    if (!this.#paused) return;
    if (!Number.isFinite(realMs)) throw new Error(`realMs 必须是有限数，收到 ${String(realMs)}`);
    const pausedAtMs = this.#pausedAtMs as number;
    if (realMs < pausedAtMs) {
      throw new Error(`resume 的 realMs 不能早于暂停点：${realMs} < ${pausedAtMs}`);
    }
    this.#epochRealMs += realMs - pausedAtMs;
    this.#paused = false;
    this.#pausedAtMs = null;
    this.#tickAtPause = null;
  }

  toJSON(): SerializedWorldClock {
    return {
      spec: { ...this.spec },
      epochRealMs: this.#epochRealMs,
      epochTick: this.#epochTick,
      paused: this.#paused,
      pausedAtMs: this.#pausedAtMs,
      tickAtPause: this.#tickAtPause,
    };
  }

  /** 从持久化记录恢复；暂停状态必须自洽。 */
  static fromJSON(raw: unknown): WorldClock {
    if (!raw || typeof raw !== "object") throw new Error("WorldClock 记录必须是对象");
    const record = raw as Partial<SerializedWorldClock>;
    if (!record.spec) throw new Error("WorldClock 记录缺少 spec");
    if (typeof record.epochRealMs !== "number") throw new Error("WorldClock 记录缺少 epochRealMs");
    if (typeof record.epochTick !== "number") throw new Error("WorldClock 记录缺少 epochTick");

    const clock = new WorldClock(record.spec as ClockSpec, {
      epochRealMs: record.epochRealMs,
      epochTick: record.epochTick,
    });
    if (record.paused === true) {
      if (typeof record.pausedAtMs !== "number" || typeof record.tickAtPause !== "number") {
        throw new Error("暂停中的 WorldClock 必须带 pausedAtMs/tickAtPause");
      }
      if (!Number.isFinite(record.pausedAtMs)) {
        throw new Error("WorldClock.pausedAtMs 必须是有限数");
      }
      if (!Number.isInteger(record.tickAtPause) || record.tickAtPause < 0) {
        throw new Error("WorldClock.tickAtPause 必须是 >= 0 的整数");
      }
      clock.#paused = true;
      clock.#pausedAtMs = record.pausedAtMs;
      clock.#tickAtPause = record.tickAtPause;
    } else if (record.paused !== false && record.paused !== undefined) {
      throw new Error("WorldClock.paused 必须是布尔值");
    }
    return clock;
  }

  #tickAtUnpaused(realMs: number): number {
    if (!Number.isFinite(realMs)) throw new Error(`realMs 必须是有限数，收到 ${String(realMs)}`);
    if (realMs <= this.#epochRealMs) return this.#epochTick;
    const elapsedMs = realMs - this.#epochRealMs;
    const ticks = (elapsedMs * this.spec.timeScale) / (this.spec.tickMinutes * 60_000);
    return this.#epochTick + Math.floor(ticks);
  }
}
