/**
 * B3 注意力层：importance → T0/T1/T2，滞回 + 1 世界日冷却。
 *
 * T3 是群体，不通过具名角色晋升得到；群体由 CrowdRuntime 维护。
 * 每次层级变化都写 CharacterTierChanged 事件，降级保留 CharacterRecord。
 */

import { clamp } from "../world/canon.ts";
import { provenance, type World } from "../world/world.ts";
import type { Character } from "../types.ts";
import { compressCharacter, demoteCharacter, detailForTier, promoteCharacter } from "./character.ts";

export const TIER_THRESHOLDS = {
  promote: 0.7,
  demote: 0.4,
  cooldownTicks: 144,
  evalIntervalTicks: 6,
} as const;

const TIER_RANK: Record<Character["tier"], number> = { T0: 0, T1: 1, T2: 2, T3: 3 };

export interface ImportanceParts {
  plotRelevance: number;
  relationshipToPC: number;
  proximity: number;
  recency: number;
  playerAttention: number;
}

export interface ImportanceScore {
  score: number;
  parts: ImportanceParts;
}

function lastInteractionTick(world: World, characterId: string): number {
  let last = -999;
  for (const event of world.state.eventLog) {
    if (event.actorId === characterId || event.witnesses.includes(characterId)) last = event.tick;
  }
  return last;
}

function relationshipToPc(character: Character): number {
  const relationship = character.relationships["pc_observer"];
  if (!relationship) return 0;
  return clamp((relationship.trust + relationship.affinity) / 2);
}

export function importanceOf(world: World, character: Character, tick = world.state.tick): ImportanceScore {
  const roleBase = character.tier === "T0" ? 0.8 : character.tier === "T1" ? 0.65 : 0.25;
  const activeFactIds = new Set(world.activeFacts().map((fact) => fact.id));
  const implicated = world.state.facts.filter(
    (fact) =>
      activeFactIds.has(fact.id) &&
      (fact.subjectId === character.id || fact.objectId === character.id || fact.detail.culpritId === character.id),
  ).length;
  const planned = world.state.plans.some(
    (plan) => plan.actorIds.includes(character.id) && ["scheduled", "pending", "resolving"].includes(plan.state),
  );
  const plotRelevance = clamp(roleBase + Math.min(0.25, implicated * 0.08) + (planned ? 0.1 : 0));
  const relationshipToPC = relationshipToPc(character);
  const pcRoom = world.state.pc.currentRoomId;
  const proximity =
    character.currentRoomId === pcRoom
      ? 1
      : world.placeOfRoom(character.currentRoomId) === world.placeOfRoom(pcRoom)
        ? 0.6
        : 0.1;
  const since = tick - lastInteractionTick(world, character.id);
  const recency = since <= 24 ? 1 : since <= 72 ? 0.5 : since <= 144 ? 0.25 : 0.1;
  const playerAttention = character.observed
    ? 0.9
    : proximity === 1
      ? 0.6
      : character.tier === "T0"
        ? 0.3
        : 0.15;
  const parts = { plotRelevance, relationshipToPC, proximity, recency, playerAttention };
  const score =
    0.3 * plotRelevance +
    0.25 * relationshipToPC +
    0.2 * proximity +
    0.15 * recency +
    0.1 * playerAttention;
  return { score: Math.round(score * 10000) / 10000, parts };
}

function desiredTier(current: Character["tier"], score: number): Character["tier"] {
  if (current === "T0") return score <= TIER_THRESHOLDS.demote ? "T1" : current;
  if (current === "T1") {
    if (score >= TIER_THRESHOLDS.promote) return "T0";
    if (score <= TIER_THRESHOLDS.demote) return "T2";
    return current;
  }
  if (current === "T2") return score >= TIER_THRESHOLDS.promote ? "T1" : current;
  return current;
}

export interface TierChangeOptions {
  force?: boolean;
  importance?: number;
  reason: string;
}

export function applyTier(
  world: World,
  character: Character,
  nextTier: Character["tier"],
  options: TierChangeOptions,
): boolean {
  if (character.tier === nextTier) return false;
  if (nextTier === "T3") throw new Error("具名角色不能通过 importance 晋升为 T3；T3 是群体");
  const tick = world.state.tick;
  if (!options.force) {
    if (tick - (character.lastTierChangeTick ?? -999) < TIER_THRESHOLDS.cooldownTicks) return false;
  }
  const from = character.tier;
  const promoted = TIER_RANK[nextTier] < TIER_RANK[from];
  character.tier = nextTier;
  character.lastTierChangeTick = tick;
  character.tierReason = options.reason;
  character.detailLevel = detailForTier(nextTier);
  if (promoted) {
    promoteCharacter(world, character, tick);
    world.state.metrics.promotions++;
  } else {
    demoteCharacter(world, character, tick);
    character.detailLevel = detailForTier(nextTier);
    world.state.metrics.demotions++;
  }
  world.state.metrics.tierChanges++;
  world.emit({
    type: "CharacterTierChanged",
    tick,
    actorId: character.id,
    roomId: character.currentRoomId,
    visibility: "private",
    payload: {
      characterId: character.id,
      from,
      to: nextTier,
      importance: options.importance ?? null,
      reason: options.reason,
      forced: Boolean(options.force),
      keyMemories: character.keyMemories?.map((belief) => belief.factId) ?? [],
    },
    provenance: provenance("system", { seed: world.seed, ruleVersion: "world-b3.0" }),
  });
  return true;
}

/** 每小时（6 tick）重算一次 importance；不每 tick 抖动。 */
export function maybeUpdateTiers(world: World, tick = world.state.tick): Character[] {
  if (tick % TIER_THRESHOLDS.evalIntervalTicks !== 0) return [];
  const changed: Character[] = [];
  for (const character of world.state.characters) {
    if (character.crowdId) continue;
    if (tick - (character.lastTierEvalTick ?? -999) < TIER_THRESHOLDS.evalIntervalTicks) continue;
    character.lastTierEvalTick = tick;
    const importance = importanceOf(world, character, tick);
    const next = desiredTier(character.tier, importance.score);
    if (next === character.tier) continue;
    if (applyTier(world, character, next, {
      importance: importance.score,
      reason: `importance=${importance.score.toFixed(3)}`,
    })) {
      changed.push(character);
    }
  }
  return changed;
}

/** 测试/演示用：绕过冷却和滞回，强制一次层级变化。 */
export function forceTier(
  world: World,
  characterId: string,
  nextTier: Character["tier"],
  reason = "forced",
): Character {
  const character = world.character(characterId);
  applyTier(world, character, nextTier, { force: true, reason });
  return character;
}

/** 20 次降级→晋升连续性测试用。 */
export function demoteToRecord(world: World, characterId: string): Character {
  return forceTier(world, characterId, "T2", "cm6-demote");
}

export function promoteFromRecord(world: World, characterId: string): Character {
  return forceTier(world, characterId, "T0", "cm6-promote");
}

export function tierSnapshot(world: World, characterId: string) {
  const character = world.character(characterId);
  return {
    id: character.id,
    name: character.name,
    role: character.role,
    tier: character.tier,
    identityHash: character.record?.identityHash ?? "",
    relationships: structuredClone(character.relationships),
    keyMemories: (character.keyMemories ?? []).map((belief) => belief.factId),
    record: character.record ? compressCharacter(world, character, world.state.tick) : undefined,
  };
}
