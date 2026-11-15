/**
 * B3 CharacterRuntime 契约与角色记录。
 *
 * PC、NPC、群体都实现同一组 perceive → decide → act → onEvent → snapshot。
 * 运行时的差异只来自策略（decision/memory/perception/persistence），
 * 不来自“PC 一套、NPC 另一套”的接口。
 */

import { canonicalJson } from "../../../../engine/json.ts";
import { hashString } from "../../../../engine/rng.ts";
import type {
  Belief,
  Character,
  CharacterRecord,
  DetailLevel,
  LodLevel,
  Mood,
  Needs,
  Relationship,
  ScheduleBlock,
} from "../types.ts";
import type { World } from "../world/world.ts";

export type CharacterKind = "pc" | "npc" | "crowd";

export interface RuntimePerception {
  selfId: string;
  kind: CharacterKind;
  tier: Character["tier"];
  roomId: string;
  placeId: string;
  activity: string;
  light: string;
  presentIds: string[];
  visibleFactIds: string[];
  knownFactIds: string[];
  needs?: Needs;
  mood?: Mood;
  memberCount?: number;
}

export interface DecisionContext {
  tick: number;
  viewLevel: LodLevel;
  /** 观察者/PC 所在位置；用于判断 focus/near/ambient/offstage。 */
  observerRoomId?: string;
  question?: string;
}

export interface RuntimeIntent {
  kind: string;
  targetId?: string;
  targetRoomId?: string;
  reason: string;
  payload?: Record<string, unknown>;
}

export interface RuntimeActionResult {
  ok: boolean;
  intentKind: string;
  eventIds: string[];
  detail: string;
}

export interface CharacterSnapshot {
  id: string;
  name: string;
  kind: CharacterKind;
  tier: Character["tier"];
  identityHash: string;
  roomId: string;
  activity: string;
  relationships: Record<string, Relationship>;
  keyMemories: Belief[];
  needs?: Needs;
  mood?: Mood;
  memberCount?: number;
  detailLevel: DetailLevel;
  lastEventId?: string;
  observed: boolean;
}

export interface CharacterRuntime {
  readonly id: string;
  readonly kind: CharacterKind;
  perceive(world: World, level?: LodLevel): RuntimePerception;
  decide(world: World, context: DecisionContext): RuntimeIntent | null;
  act(world: World, intent: RuntimeIntent, tick: number): RuntimeActionResult;
  onEvent(event: { id: string; type: string; tick: number }): void;
  snapshot(world: World): CharacterSnapshot;
}

export function identityHash(character: Pick<Character, "id" | "name" | "role" | "homeRoomId">): string {
  return hashString(
    canonicalJson({
      id: character.id,
      name: character.name,
      role: character.role,
      homeRoomId: character.homeRoomId,
    }),
  )
    .toString(16)
    .padStart(8, "0");
}

export function topKeyMemories(world: World, character: Character, limit = 5): Belief[] {
  return [...character.beliefs]
    .map((belief) => ({
      belief,
      fact: world.state.facts.find((candidate) => candidate.id === belief.factId),
    }))
    .sort((a, b) => {
      const aScore = (a.fact?.salience ?? 0.2) * a.belief.confidence;
      const bScore = (b.fact?.salience ?? 0.2) * b.belief.confidence;
      return bScore - aScore;
    })
    .slice(0, limit)
    .map(({ belief }) => structuredClone(belief));
}

export function detailForTier(tier: Character["tier"]): DetailLevel {
  switch (tier) {
    case "T0":
      return "full";
    case "T1":
      return "summary";
    case "T2":
      return "index";
    case "T3":
      return "aggregate";
  }
}

/** 压缩成 CharacterRecord；不删除身份，也不丢关键记忆。 */
export function compressCharacter(
  world: World,
  character: Character,
  tick: number,
  lastState = world.currentActivity(character),
): CharacterRecord {
  const keyMemories = topKeyMemories(world, character, 5);
  character.keyMemories = structuredClone(keyMemories);
  return {
    id: character.id,
    name: character.name,
    role: character.role,
    tier: character.tier,
    homeRoomId: character.homeRoomId,
    currentRoomId: character.currentRoomId,
    identityHash: identityHash(character),
    relationships: structuredClone(character.relationships),
    keyMemories,
    needs: { ...character.needs },
    mood: { ...character.mood },
    coins: character.coins,
    schedule: structuredClone(character.schedule),
    lastState,
    lastTick: tick,
    tombstone: false,
    crowdId: character.crowdId,
    observed: character.observed ?? false,
    reusedCount: 0,
  };
}

/** 降级：保留身份/关系/关键记忆，丢掉逐条观察与低权重记忆。 */
export function demoteCharacter(world: World, character: Character, tick: number): CharacterRecord {
  const record = compressCharacter(world, character, tick);
  character.record = record;
  character.detailLevel = "summary";
  character.observed = character.observed ?? false;
  const keyIds = new Set(record.keyMemories.map((belief) => belief.factId));
  character.beliefs = character.beliefs.filter((belief) => keyIds.has(belief.factId));
  character.observations = [];
  return record;
}

/** 晋升：恢复关键记忆，保留同一 id/关系/身份。 */
export function promoteCharacter(world: World, character: Character, tick: number): void {
  const record = character.record;
  if (!record) {
    character.detailLevel = detailForTier(character.tier);
    return;
  }
  const existing = new Set(character.beliefs.map((belief) => belief.factId));
  for (const memory of record.keyMemories) {
    if (!existing.has(memory.factId)) {
      character.beliefs.push(structuredClone(memory));
      existing.add(memory.factId);
    }
  }
  character.keyMemories = structuredClone(record.keyMemories);
  character.record = {
    ...record,
    tier: character.tier,
    currentRoomId: character.currentRoomId,
    lastState: world.currentActivity(character),
    lastTick: tick,
  };
  character.detailLevel = detailForTier(character.tier);
}

export function snapshotCharacter(
  world: World,
  character: Character,
  lastEventId?: string,
): CharacterSnapshot {
  return {
    id: character.id,
    name: character.name,
    kind: "npc",
    tier: character.tier,
    identityHash: identityHash(character),
    roomId: character.currentRoomId,
    activity: world.currentActivity(character),
    relationships: structuredClone(character.relationships),
    keyMemories: topKeyMemories(world, character, 5),
    needs: { ...character.needs },
    mood: { ...character.mood },
    detailLevel: character.detailLevel ?? detailForTier(character.tier),
    lastEventId,
    observed: character.observed ?? false,
  };
}

export function perceptionOf(
  world: World,
  character: Character,
  kind: CharacterKind,
  level: LodLevel = "near",
): RuntimePerception {
  const room = world.room(character.currentRoomId);
  const presentIds = level === "offstage" ? [] : world.occupants(room.id).filter((id) => id !== character.id);
  const visibleFactIds =
    level === "offstage"
      ? []
      : world.state.facts
          .filter(
            (fact) =>
              fact.status === "active" &&
              fact.placeId === room.placeId &&
              character.beliefs.some((belief) => belief.factId === fact.id),
          )
          .map((fact) => fact.id);
  return {
    selfId: character.id,
    kind,
    tier: character.tier,
    roomId: room.id,
    placeId: room.placeId,
    activity: world.currentActivity(character),
    light: room.light,
    presentIds,
    visibleFactIds,
    knownFactIds: character.beliefs.map((belief) => belief.factId),
    needs: { ...character.needs },
    mood: { ...character.mood },
  };
}

/**
 * PC 的脚本替身。它和 NPC 共用同一个契约；区别只是 decide 来自脚本队列。
 * 这样 CM-1 的 contract test 可以原样跑在 PC 与 NPC 上。
 */
export class ScriptedPcRuntime implements CharacterRuntime {
  readonly id: string;
  readonly kind: CharacterKind = "pc";
  private readonly moves: string[];
  private lastEventId?: string;

  constructor(id = "pc_observer", moves: string[] = []) {
    this.id = id;
    this.moves = [...moves];
  }

  perceive(world: World, level: LodLevel = "focus"): RuntimePerception {
    const pc = world.state.pc;
    const room = world.room(pc.currentRoomId);
    return {
      selfId: pc.id,
      kind: "pc",
      tier: "T0",
      roomId: room.id,
      placeId: room.placeId,
      activity: pc.status,
      light: room.light,
      presentIds: level === "offstage" ? [] : world.occupants(room.id).filter((id) => id !== pc.id),
      visibleFactIds: pc.beliefs
        .map((belief) => belief.factId)
        .filter((factId) => world.state.facts.find((fact) => fact.id === factId)?.placeId === room.placeId),
      knownFactIds: pc.beliefs.map((belief) => belief.factId),
    };
  }

  decide(_world: World, _context: DecisionContext): RuntimeIntent | null {
    const next = this.moves.shift();
    if (!next) return { kind: "observe", reason: "脚本没有下一步；观察" };
    return { kind: "move", targetRoomId: next, reason: "脚本移动" };
  }

  act(world: World, intent: RuntimeIntent, tick: number): RuntimeActionResult {
    if (intent.kind === "move" && intent.targetRoomId) {
      const event = world.movePc(intent.targetRoomId, intent.reason, tick);
      return { ok: true, intentKind: intent.kind, eventIds: [event.id], detail: `PC 移动到 ${intent.targetRoomId}` };
    }
    return { ok: true, intentKind: intent.kind, eventIds: [], detail: "PC 观察，无状态变更" };
  }

  onEvent(event: { id: string }): void {
    this.lastEventId = event.id;
  }

  snapshot(world: World): CharacterSnapshot {
    const pc = world.state.pc;
    const room = world.room(pc.currentRoomId);
    return {
      id: pc.id,
      name: pc.name,
      kind: "pc",
      tier: "T0",
      identityHash: hashString(canonicalJson({ id: pc.id, name: pc.name }))
        .toString(16)
        .padStart(8, "0"),
      roomId: room.id,
      activity: pc.status,
      relationships: {},
      keyMemories: [...pc.beliefs].slice(-5).map((belief) => structuredClone(belief)),
      detailLevel: "full",
      lastEventId: this.lastEventId,
      observed: true,
    };
  }
}
