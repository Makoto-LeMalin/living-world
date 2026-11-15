import type { ScheduleBlock } from "../types.ts";

export const DAY_MINUTES = 24 * 60;
/** 世界从 06:00 开始，所以“日”在午夜翻页；tick 0 是 D1 06:00。 */
export const START_HOUR = 6;

export function dayOf(tick: number, ticksPerDay: number): number {
  const calendarMinutes = START_HOUR * 60 + tick * (DAY_MINUTES / ticksPerDay);
  return Math.floor(calendarMinutes / DAY_MINUTES);
}

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

export function blockAt(schedule: ScheduleBlock[], tickOfDayValue: number): ScheduleBlock {
  const block = schedule.find(
    (candidate) => tickOfDayValue >= candidate.startTick && tickOfDayValue < candidate.endTick,
  );
  if (!block) throw new Error(`日程在 tickOfDay=${tickOfDayValue} 没有块`);
  return block;
}

export function isNight(activity: string): boolean {
  return activity === "sleep";
}
