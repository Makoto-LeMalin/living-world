/**
 * 预算：角色对话与 WorldDirector 分开记账，总额仍 ≤30/日。
 * 本阶段没有真实 LLM 调用，但提案/高 salience 事件也走同一套配额，
 * 这样 B3 接入模型时不需要改调度器。
 */

import type { World } from "../world/world.ts";
import { dayOf } from "../kernel/clock.ts";
import { provenance } from "../world/world.ts";
import type { LodLevel } from "../types.ts";

export const BUDGET_LIMITS = {
  characterPerDay: 22,
  directorPerDay: 8,
  totalPerDay: 30,
  highSaliencePerPlacePerDay: 3,
  /** 每 tick 最多 K 个角色获得 LLM 注意力（PC 不占这个额度）。 */
  characterConcurrentPerTick: 3,
} as const;

export interface CharacterCallMeta {
  lod: LodLevel;
  npcId: string;
  reason?: string;
}

export class Budget {
  world: World;

  constructor(world: World) {
    this.world = world;
  }

  dayKey(tick = this.world.state.tick): string {
    return `D${dayOf(tick, this.world.state.config.ticksPerDay) + 1}`;
  }

  placeKey(placeId: string, tick = this.world.state.tick): string {
    return `${placeId}:${this.dayKey(tick)}`;
  }

  directorUsed(tick = this.world.state.tick): number {
    return this.world.state.budget.directorCallsByDay[this.dayKey(tick)] ?? 0;
  }

  characterUsed(tick = this.world.state.tick): number {
    return this.world.state.budget.characterCallsByDay[this.dayKey(tick)] ?? 0;
  }

  highSalienceUsed(placeId: string, tick = this.world.state.tick): number {
    return this.world.state.budget.highSalienceByPlaceDay[this.placeKey(placeId, tick)] ?? 0;
  }

  characterUsedForTick(tick = this.world.state.tick): number {
    return this.world.state.budget.characterCallsByTick[String(tick)] ?? 0;
  }

  characterUsedByLod(lod: LodLevel, tick = this.world.state.tick): number {
    return this.world.state.budget.characterCallsByLod[`${lod}:${this.dayKey(tick)}`] ?? 0;
  }

  directorUsedByReason(reason: string, tick = this.world.state.tick): number {
    return this.world.state.budget.directorCallsByReason[`${reason}:${this.dayKey(tick)}`] ?? 0;
  }

  canUseDirector(tick = this.world.state.tick): boolean {
    return (
      this.directorUsed(tick) < BUDGET_LIMITS.directorPerDay &&
      this.characterUsed(tick) + this.directorUsed(tick) < BUDGET_LIMITS.totalPerDay
    );
  }

  canUseCharacter(tick = this.world.state.tick, lod: LodLevel = "focus"): boolean {
    if (lod === "offstage") return false;
    return (
      this.characterUsed(tick) < BUDGET_LIMITS.characterPerDay &&
      this.characterUsed(tick) + this.directorUsed(tick) < BUDGET_LIMITS.totalPerDay &&
      this.characterUsedForTick(tick) < BUDGET_LIMITS.characterConcurrentPerTick
    );
  }

  canUseHighSalience(placeId: string, tick = this.world.state.tick): boolean {
    return this.highSalienceUsed(placeId, tick) < BUDGET_LIMITS.highSaliencePerPlacePerDay;
  }

  consumeDirector(tick = this.world.state.tick, reason = "ambient"): void {
    this.consume("director", this.dayKey(tick), 1, tick, { reason });
  }

  consumeCharacter(
    tick = this.world.state.tick,
    meta: CharacterCallMeta = { lod: "focus", npcId: "unknown" },
  ): void {
    if (meta.lod === "offstage") {
      this.world.state.metrics.offstageCharacterCalls++;
      throw new Error(`offstage 角色不能调用 LLM: ${meta.npcId}`);
    }
    this.consume("character", this.dayKey(tick), 1, tick, {
      lod: meta.lod,
      npcId: meta.npcId,
      reason: meta.reason,
    });
    this.world.state.metrics.llmCalls++;
  }

  consumeHighSalience(placeId: string, tick = this.world.state.tick): void {
    this.consume("high-salience", this.placeKey(placeId, tick), 1, tick);
  }

  /** 预算耗尽时写明确事件，而不是静默跳过。 */
  degrade(
    reason: string,
    detail: { kind: "director" | "character"; lod?: LodLevel; npcId?: string; eventType?: string },
    tick = this.world.state.tick,
  ): void {
    this.world.emit({
      type: "BudgetDegraded",
      tick,
      visibility: "private",
      payload: { reason, ...detail },
      provenance: provenance("system", { ruleVersion: "world-b3.0" }),
    });
  }

  private consume(
    kind: string,
    key: string,
    amount: number,
    tick: number,
    meta: Record<string, unknown> = {},
  ): void {
    this.world.emit({
      type: "BudgetConsumed",
      tick,
      visibility: "private",
      payload: { kind, key, amount, ...meta },
      provenance: provenance("system", { ruleVersion: "world-b3.0" }),
    });
  }

  summary(tick = this.world.state.tick): {
    director: number;
    character: number;
    total: number;
    remaining: number;
    callsThisTick: number;
    byLod: Record<string, number>;
  } {
    const director = this.directorUsed(tick);
    const character = this.characterUsed(tick);
    const byLod: Record<string, number> = {};
    for (const lod of ["focus", "near", "ambient", "offstage"] as const) {
      byLod[lod] = this.characterUsedByLod(lod, tick);
    }
    return {
      director,
      character,
      total: director + character,
      remaining: BUDGET_LIMITS.totalPerDay - director - character,
      callsThisTick: this.characterUsedForTick(tick),
      byLod,
    };
  }

  /** 整个场景的累计值；日报表用 summary(tick)，总账用 totals()。 */
  totals(): {
    director: number;
    character: number;
    total: number;
    offstageCharacterCalls: number;
    byDay: { director: Record<string, number>; character: Record<string, number> };
    byLod: Record<string, number>;
    byNpc: Record<string, number>;
    byTick: Record<string, number>;
    byDirectorReason: Record<string, number>;
    degraded: Record<string, number>;
    maxDirectorDay: number;
    maxCharacterDay: number;
    maxCharacterTick: number;
    maxTotalDay: number;
  } {
    const director = Object.values(this.world.state.budget.directorCallsByDay).reduce((sum, value) => sum + value, 0);
    const character = Object.values(this.world.state.budget.characterCallsByDay).reduce((sum, value) => sum + value, 0);
    const days = new Set([
      ...Object.keys(this.world.state.budget.directorCallsByDay),
      ...Object.keys(this.world.state.budget.characterCallsByDay),
    ]);
    const totalsByDay = [...days].map(
      (day) =>
        (this.world.state.budget.directorCallsByDay[day] ?? 0) +
        (this.world.state.budget.characterCallsByDay[day] ?? 0),
    );
    return {
      director,
      character,
      total: director + character,
      offstageCharacterCalls: this.world.state.metrics.offstageCharacterCalls,
      byDay: {
        director: { ...this.world.state.budget.directorCallsByDay },
        character: { ...this.world.state.budget.characterCallsByDay },
      },
      byLod: { ...this.world.state.budget.characterCallsByLod },
      byNpc: { ...this.world.state.budget.characterCallsByNpc },
      byTick: { ...this.world.state.budget.characterCallsByTick },
      byDirectorReason: { ...this.world.state.budget.directorCallsByReason },
      degraded: { ...this.world.state.budget.degradedByReason },
      maxDirectorDay: Math.max(0, ...Object.values(this.world.state.budget.directorCallsByDay)),
      maxCharacterDay: Math.max(0, ...Object.values(this.world.state.budget.characterCallsByDay)),
      maxCharacterTick: Math.max(0, ...Object.values(this.world.state.budget.characterCallsByTick)),
      maxTotalDay: Math.max(0, ...totalsByDay),
    };
  }
}
