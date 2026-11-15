/**
 * T3 群体：一次判定作用到分布；被观察者点名时个体化，合并时保留身份。
 *
 * 一致性规则：
 * - 个体化：群体 size - 1，生成/复用一个 T1 成员；
 * - 合并：成员从 characters 移除，群体 size + 1，墓碑记录保留；
 * - 再次观察：优先复用墓碑记录，保持同一 id/身份/关系/关键记忆。
 */

import { makeRng } from "../../../../engine/rng.ts";
import { clamp } from "../world/canon.ts";
import { provenance, type World } from "../world/world.ts";
import type {
  Belief,
  Character,
  CharacterRecord,
  Crowd,
  LodLevel,
  Mood,
  Needs,
  Relationship,
  Skills,
} from "../types.ts";
import {
  compressCharacter,
  identityHash,
  perceptionOf,
  snapshotCharacter,
  topKeyMemories,
  type CharacterKind,
  type CharacterRuntime,
  type CharacterSnapshot,
  type DecisionContext,
  type RuntimeActionResult,
  type RuntimeIntent,
  type RuntimePerception,
} from "./character.ts";

const NAMES = ["阿禾", "小石", "阿菱", "满仓", "阿水", "小穗", "石头", "阿杏", "冬生", "阿芦"];
const ROLES = ["赶集人", "码头帮工", "挑担货郎", "洗衣妇", "跑腿孩子"];

function emptyMood(): Mood {
  return { fear: 0.2, anger: 0.1, trust: 0.5, hope: 0.5, suspicion: 0.2 };
}

function sampleMood(crowd: Crowd, rng: () => number): Mood {
  const jitter = () => (rng() - 0.5) * 0.18;
  return {
    fear: clamp(crowd.mood.fear + jitter()),
    anger: clamp(crowd.mood.anger + jitter()),
    trust: clamp(crowd.mood.trust + jitter()),
    hope: clamp(crowd.mood.hope + jitter()),
    suspicion: clamp(crowd.mood.suspicion + jitter()),
  };
}

function sampleSkills(rng: () => number): Skills {
  return {
    theft: Math.round(5 + rng() * 40),
    perception: Math.round(20 + rng() * 55),
    combat: Math.round(5 + rng() * 35),
    persuasion: Math.round(20 + rng() * 50),
    stealth: Math.round(10 + rng() * 45),
  };
}

function sampleNeeds(rng: () => number): Needs {
  return {
    hunger: Math.round(25 + rng() * 55),
    fatigue: Math.round(15 + rng() * 45),
    safety: Math.round(25 + rng() * 50),
    social: Math.round(30 + rng() * 50),
    coin: Math.round(1 + rng() * 20),
  };
}

function mergeBeliefs(into: Belief[], incoming: Belief[]): void {
  for (const belief of incoming) {
    const existing = into.find((candidate) => candidate.factId === belief.factId);
    if (!existing) {
      into.push(structuredClone(belief));
    } else if (belief.confidence > existing.confidence + 0.02) {
      Object.assign(existing, structuredClone(belief));
    }
  }
}

function defaultSchedule(roomId: string, ticksPerDay: number): Character["schedule"] {
  return [{ startTick: 0, endTick: ticksPerDay, activity: "trade", roomId, priority: 1 }];
}

export interface IndividualizeOptions {
  preferredId?: string;
  roomId?: string;
  reason?: string;
}

/** 从群体采样一个成员；如果该群体有墓碑记录，优先复用旧身份。 */
export function individualizeCrowd(
  world: World,
  crowdId: string,
  options: IndividualizeOptions = {},
): Character {
  const crowd = world.crowd(crowdId);
  if (crowd.size <= 0) throw new Error(`群体 ${crowdId} 没有成员可个体化`);
  const rng = makeRng(`${world.seed}:crowd:${crowdId}:${world.state.nextIndividualId}`);
  const next = () => rng.next();

  const reusable = world.state.individuals
    .filter((record) => record.crowdId === crowdId && record.tombstone)
    .sort((a, b) => a.reusedCount - b.reusedCount || a.lastTick - b.lastTick);
  const record = options.preferredId
    ? world.state.individuals.find((candidate) => candidate.id === options.preferredId && candidate.crowdId === crowdId)
    : reusable[0];

  const memberId = record?.id ?? `npc_${crowdId}_m${String(world.state.nextIndividualId++).padStart(3, "0")}`;
  const existing = world.maybeCharacter(memberId);
  if (existing) return existing;

  const name = record?.name ?? NAMES[(world.state.nextIndividualId + crowd.size) % NAMES.length];
  const role = record?.role ?? ROLES[(world.state.nextIndividualId + crowd.size) % ROLES.length];
  const mood = record?.mood ? { ...record.mood } : sampleMood(crowd, next);
  const needs = record?.needs ? { ...record.needs } : sampleNeeds(next);
  const roomId = options.roomId ?? record?.currentRoomId ?? crowd.roomId;
  const relationships: Record<string, Relationship> = record
    ? structuredClone(record.relationships)
    : {
        pc_observer: { trust: clamp(0.2 + next() * 0.5), affinity: clamp(next() * 0.4), fear: clamp(next() * 0.3) },
      };

  const character: Character = {
    id: memberId,
    name,
    role,
    tier: "T1",
    homeRoomId: roomId,
    currentRoomId: roomId,
    attention: clamp(0.35 + next() * 0.4),
    skills: sampleSkills(next),
    needs,
    mood,
    coins: needs.coin,
    relationships,
    schedule: record?.schedule ? structuredClone(record.schedule) : defaultSchedule(roomId, world.state.config.ticksPerDay),
    beliefs: record?.keyMemories ? structuredClone(record.keyMemories) : [],
    observations: [],
    jailed: false,
    deviations: 0,
    detailLevel: "summary",
    lastTierChangeTick: -999,
    lastTierEvalTick: -999,
    observed: true,
    crowdId,
    keyMemories: record?.keyMemories ? structuredClone(record.keyMemories) : [],
  };

  world.state.characters.push(character);
  crowd.size = Math.max(0, crowd.size - 1);
  crowd.representativeIds.push(memberId);
  crowd.individualizedCount++;
  crowd.mood.fear = clamp(crowd.mood.fear + 0.01);
  world.state.metrics.crowdIndividualizations++;

  if (record) {
    record.tombstone = false;
    record.reusedCount++;
    record.currentRoomId = roomId;
    record.lastState = "individualized";
  } else {
    world.state.individuals.push({
      id: memberId,
      name,
      role,
      tier: "T1",
      homeRoomId: roomId,
      currentRoomId: roomId,
      identityHash: identityHash(character),
      relationships: structuredClone(relationships),
      keyMemories: topKeyMemories(world, character, 5),
      needs: { ...needs },
      mood: { ...mood },
      coins: character.coins,
      schedule: structuredClone(character.schedule),
      lastState: "individualized",
      lastTick: world.state.tick,
      tombstone: false,
      crowdId,
      observed: true,
      reusedCount: 0,
    });
  }

  world.emit({
    type: "CrowdIndividualized",
    tick: world.state.tick,
    actorId: memberId,
    roomId,
    visibility: "room",
    witnesses: [world.state.pc.id],
    payload: {
      crowdId,
      memberId,
      remaining: crowd.size,
      name,
      role,
      reused: Boolean(record),
      reason: options.reason ?? "observed",
    },
    provenance: provenance("system", { seed: world.seed, ruleVersion: "world-b3.0" }),
  });
  return character;
}

/** 成员回到群体：回写心情/信念/人数，身份记录保留为 tombstone。 */
export function mergeCrowdMember(world: World, crowdId: string, memberId: string): CharacterRecord {
  const crowd = world.crowd(crowdId);
  const character = world.character(memberId);
  if (character.crowdId !== crowdId) throw new Error(`${memberId} 不属于群体 ${crowdId}`);
  if (character.jailed) throw new Error(`${memberId} 被拘禁，不能合并回群体`);

  const total = crowd.size + 1;
  for (const key of Object.keys(crowd.mood) as Array<keyof Mood>) {
    crowd.mood[key] = clamp((crowd.mood[key] * crowd.size + character.mood[key]) / total);
  }
  mergeBeliefs(crowd.beliefs, character.beliefs);
  crowd.size = total;
  crowd.representativeIds = crowd.representativeIds.filter((id) => id !== memberId);
  crowd.mergedCount++;
  crowd.cohesion = clamp(crowd.cohesion + 0.02);

  const record = compressCharacter(world, character, world.state.tick, "merged");
  record.tombstone = true;
  record.crowdId = crowdId;
  record.observed = true;
  const index = world.state.individuals.findIndex((candidate) => candidate.id === memberId);
  if (index >= 0) world.state.individuals[index] = record;
  else world.state.individuals.push(record);

  const charIndex = world.state.characters.findIndex((candidate) => candidate.id === memberId);
  if (charIndex >= 0) world.state.characters.splice(charIndex, 1);
  world.state.metrics.crowdMerges++;

  world.emit({
    type: "CrowdMerged",
    tick: world.state.tick,
    actorId: memberId,
    roomId: crowd.roomId,
    visibility: "room",
    witnesses: [world.state.pc.id],
    payload: {
      crowdId,
      memberId,
      size: crowd.size,
      name: character.name,
      keyMemories: record.keyMemories.map((belief) => belief.factId),
    },
    provenance: provenance("system", { seed: world.seed, ruleVersion: "world-b3.0" }),
  });
  return record;
}

export class CrowdRuntime implements CharacterRuntime {
  readonly id: string;
  readonly kind: CharacterKind = "crowd";
  private readonly crowd: Crowd;
  private lastEventId?: string;

  constructor(crowd: Crowd) {
    this.crowd = crowd;
    this.id = crowd.id;
  }

  perceive(world: World, level: LodLevel = "ambient"): RuntimePerception {
    const room = world.room(this.crowd.roomId);
    return {
      selfId: this.crowd.id,
      kind: "crowd",
      tier: "T3",
      roomId: room.id,
      placeId: room.placeId,
      activity: "collective",
      light: room.light,
      presentIds: level === "offstage" ? [] : world.occupants(room.id).filter((id) => id !== this.crowd.id),
      visibleFactIds: this.crowd.beliefs.map((belief) => belief.factId).slice(-8),
      knownFactIds: this.crowd.beliefs.map((belief) => belief.factId),
      mood: { ...this.crowd.mood },
      memberCount: this.crowd.size,
    };
  }

  decide(_world: World, _context: DecisionContext): RuntimeIntent | null {
    if (this.crowd.size <= 0) return null;
    if (this.crowd.mood.fear > 0.6) {
      return { kind: "crowd-recoil", reason: "恐惧超过阈值，人群后退" };
    }
    if (this.crowd.mood.anger > 0.7) {
      return { kind: "crowd-press", reason: "愤怒超过阈值，人群向前施压" };
    }
    return { kind: "crowd-mill", reason: "人群照常聚集/散开" };
  }

  act(world: World, intent: RuntimeIntent, tick: number): RuntimeActionResult {
    const event = world.emit({
      type: "CrowdActed",
      tick,
      actorId: this.crowd.id,
      roomId: this.crowd.roomId,
      visibility: "place",
      payload: {
        crowdId: this.crowd.id,
        intent: intent.kind,
        size: this.crowd.size,
        mood: { ...this.crowd.mood },
        reason: intent.reason,
      },
      provenance: provenance("actor", { seed: world.seed, ruleVersion: "world-b3.0" }),
    });
    this.lastEventId = event.id;
    return { ok: true, intentKind: intent.kind, eventIds: [event.id], detail: `${this.crowd.name} ${intent.kind}` };
  }

  onEvent(event: { id: string }): void {
    this.lastEventId = event.id;
  }

  snapshot(world: World): CharacterSnapshot {
    const room = world.room(this.crowd.roomId);
    return {
      id: this.crowd.id,
      name: this.crowd.name,
      kind: "crowd",
      tier: "T3",
      identityHash: identityHash({
        id: this.crowd.id,
        name: this.crowd.name,
        role: "crowd",
        homeRoomId: room.id,
      }),
      roomId: room.id,
      activity: "collective",
      relationships: {},
      keyMemories: [...this.crowd.beliefs].slice(-5).map((belief) => structuredClone(belief)),
      mood: { ...this.crowd.mood },
      memberCount: this.crowd.size,
      detailLevel: "aggregate",
      lastEventId: this.lastEventId,
      observed: true,
    };
  }
}

export { emptyMood, mergeBeliefs, sampleMood };
