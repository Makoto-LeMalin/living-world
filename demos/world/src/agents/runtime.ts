/**
 * NPC 运行时：日程是强先验，需求/事件可以偏离。
 * 动作选择 100% 规则；本文件不调用 LLM。
 *
 * B3：npcTick 现在只是 NpcRuntime 的薄适配器。
 * PC/NPC 共用同一组 perceive → decide → act → onEvent → snapshot 契约。
 */

import { clamp } from "../world/canon.ts";
import { provenance, type World } from "../world/world.ts";
import { tickOfDay } from "../../../../src/kernel/clock.ts";
import { changeCoins, changeStock, tryTrade } from "../rules/economy.ts";
import { gossip } from "../rules/rumor.ts";
import type { Character, LodLevel, ScheduleBlock } from "../types.ts";
import {
  perceptionOf,
  snapshotCharacter,
  type CharacterKind,
  type CharacterRuntime,
  type CharacterSnapshot,
  type DecisionContext,
  type RuntimeActionResult,
  type RuntimeIntent,
  type RuntimePerception,
} from "./character.ts";

export function nextRoomToward(world: World, fromRoomId: string, toRoomId: string): string | undefined {
  if (fromRoomId === toRoomId) return undefined;
  const queue: Array<{ roomId: string; path: string[] }> = [{ roomId: fromRoomId, path: [] }];
  const seen = new Set<string>([fromRoomId]);
  while (queue.length > 0) {
    const current = queue.shift() as { roomId: string; path: string[] };
    const room = world.room(current.roomId);
    for (const exit of room.exits) {
      if (seen.has(exit)) continue;
      const path = [...current.path, exit];
      if (exit === toRoomId) return path[0];
      seen.add(exit);
      queue.push({ roomId: exit, path });
    }
  }
  return undefined;
}

export function updateNeeds(world: World, character: Character, sleeping: boolean): void {
  const needs = character.needs;
  needs.hunger = clamp(needs.hunger + (sleeping ? 0.01 : 0.035), 0, 100);
  needs.fatigue = clamp(needs.fatigue + (sleeping ? -0.45 : 0.02), 0, 100);
  needs.social = clamp(needs.social - (sleeping ? 0.002 : 0.012), 0, 100);
  needs.safety = clamp(needs.safety + (character.mood.fear > 0.6 ? -0.02 : 0.005), 0, 100);
  needs.coin = character.coins;
}

function maybeEat(world: World, character: Character, tick: number): void {
  if (character.needs.hunger < 68) return;
  const roomStocks = world.state.stocks[character.currentRoomId] ?? {};
  const commodity = (["bread", "fish", "grain"] as const).find((candidate) => (roomStocks[candidate] ?? 0) > 0);
  if (!commodity) return;
  const price = world.state.prices[commodity];
  if (character.coins < price) return;
  changeStock(world, character.currentRoomId, commodity, -1, "eaten", character.id);
  changeCoins(world, character.id, -Math.round(price), "meal");
  character.needs.hunger = clamp(character.needs.hunger - 38, 0, 100);
  character.needs.social = clamp(character.needs.social + 3, 0, 100);
  world.emit({
    type: "Ate",
    tick,
    actorId: character.id,
    roomId: character.currentRoomId,
    visibility: "room",
    payload: { commodity, price },
    provenance: provenance("actor", { seed: world.seed }),
  });
}

function patrol(world: World, character: Character, tick: number): void {
  if (tick - (character.lastActTick ?? -999) < 12) return;
  character.lastActTick = tick;
  const crimePressure = world.state.facts.some((fact) => fact.kind === "crime" && fact.status === "active");
  world.emit({
    type: "Patrolled",
    tick,
    actorId: character.id,
    roomId: character.currentRoomId,
    visibility: "place",
    payload: { crimePressure, roomId: character.currentRoomId },
    provenance: provenance("actor", { seed: world.seed }),
  });
  character.needs.safety = clamp(character.needs.safety + 2, 0, 100);
}

function drink(world: World, character: Character, tick: number): void {
  if (tick - (character.lastActTick ?? -999) < 18) return;
  character.lastActTick = tick;
  const price = world.state.prices.bread;
  if (character.coins < 1) return;
  changeCoins(world, character.id, -1, "drink");
  character.needs.social = clamp(character.needs.social + 6, 0, 100);
  character.mood.fear = clamp(character.mood.fear - 0.02);
  world.emit({
    type: "Drank",
    tick,
    actorId: character.id,
    roomId: character.currentRoomId,
    visibility: "room",
    payload: { price },
    provenance: provenance("actor", { seed: world.seed }),
  });
}

function worship(world: World, character: Character, tick: number): void {
  if (tick - (character.lastActTick ?? -999) < 24) return;
  character.lastActTick = tick;
  world.emit({
    type: "Worshipped",
    tick,
    actorId: character.id,
    roomId: character.currentRoomId,
    visibility: "room",
    payload: { deity: "河神" },
    provenance: provenance("actor", { seed: world.seed }),
  });
  character.mood.hope = clamp(character.mood.hope + 0.03);
}

function help(world: World, character: Character, tick: number): void {
  if (character.role !== "祭司" && character.role !== "寡妇") return;
  if (tick - (character.lastActTick ?? -999) < 24) return;
  const target = world.state.characters.find(
    (candidate) =>
      candidate.id !== character.id &&
      candidate.currentRoomId === character.currentRoomId &&
      !candidate.jailed &&
      (candidate.needs.hunger > 75 || candidate.mood.fear > 0.65),
  );
  if (!target) return;
  character.lastActTick = tick;
  target.mood.fear = clamp(target.mood.fear - 0.06);
  target.mood.trust = clamp(target.mood.trust + 0.04);
  character.relationships[target.id] ??= { trust: 0.4, affinity: 0.2, fear: 0 };
  character.relationships[target.id].trust = clamp(character.relationships[target.id].trust + 0.03);
  world.emit({
    type: "Helped",
    tick,
    actorId: character.id,
    roomId: character.currentRoomId,
    visibility: "room",
    payload: { targetId: target.id, reason: "needs" },
    facts: [
      {
        kind: "relationship",
        subjectId: character.id,
        objectId: target.id,
        placeId: world.placeOfRoom(character.currentRoomId),
        detail: { helperId: character.id, targetId: target.id, reason: "needs" },
        salience: 0.22,
        summary: `${character.name} 帮了 ${target.name} 一把。`,
      },
    ],
    provenance: provenance("actor", { seed: world.seed }),
  });
}

function caseTarget(world: World, character: Character, tick: number): void {
  if (character.role !== "船夫的儿子") return;
  if (tick - (character.lastActTick ?? -999) < 24) return;
  character.lastActTick = tick;
  world.emit({
    type: "Cased",
    tick,
    actorId: character.id,
    roomId: character.currentRoomId,
    visibility: "private",
    payload: { target: "market_square" },
    provenance: provenance("actor", { seed: world.seed }),
  });
}

export function lodForCharacter(world: World, character: Character): LodLevel {
  const pcRoom = world.state.pc.currentRoomId;
  if (pcRoom === character.currentRoomId) return "focus";
  if (world.placeOfRoom(pcRoom) === world.placeOfRoom(character.currentRoomId)) return "near";
  if (character.tier === "T0") return "ambient";
  return "offstage";
}

interface NpcTickPayload {
  block: ScheduleBlock;
  sleeping: boolean;
  actions: string[];
  jailed: boolean;
  detour: boolean;
}

export class NpcRuntime implements CharacterRuntime {
  readonly id: string;
  readonly kind: CharacterKind = "npc";
  private readonly character: Character;
  private lastEventId?: string;

  constructor(character: Character) {
    this.character = character;
    this.id = character.id;
  }

  perceive(world: World, level: LodLevel = lodForCharacter(world, this.character)): RuntimePerception {
    return perceptionOf(world, this.character, "npc", level);
  }

  decide(world: World, context: DecisionContext): RuntimeIntent {
    const character = this.character;
    const block = character.schedule.find(
      (candidate) =>
        tickOfDay(context.tick, world.state.config.ticksPerDay) >= candidate.startTick &&
        tickOfDay(context.tick, world.state.config.ticksPerDay) < candidate.endTick,
    );
    if (!block) throw new Error(`${character.id} 没有当前日程块`);
    const sleeping = block.activity === "sleep";
    const jailed = character.jailed;
    const detour = Boolean(character.detour && context.tick < character.detour.untilTick);
    const actions: string[] = [];

    if (!jailed && !detour && !sleeping) {
      if (character.currentRoomId !== block.roomId) {
        const next = nextRoomToward(world, character.currentRoomId, block.roomId);
        if (next) {
          return {
            kind: "move",
            targetRoomId: next,
            reason: `schedule:${block.activity}`,
            payload: { block, sleeping, actions: [], jailed, detour } as unknown as Record<string, unknown>,
          };
        }
      }
      actions.push("eat");
      if (character.role === "面包商" || character.role === "店主" || character.role === "船夫") {
        actions.push("trade");
      }
      if (block.activity === "patrol") actions.push("patrol");
      if (block.activity === "drink") actions.push("drink");
      if (block.activity === "worship") actions.push("worship");
      if (block.activity === "case") actions.push("case");
      if (block.activity === "play" || block.activity === "beg" || block.activity === "trade") {
        actions.push("gossip");
      }
      if (character.role === "祭司" || character.role === "寡妇") actions.push("help");
    }

    const payload: NpcTickPayload = { block, sleeping, actions, jailed, detour };
    const raw = payload as unknown as Record<string, unknown>;
    if (jailed) return { kind: "jailed", reason: "被拘禁，日程暂停", payload: raw };
    if (detour) return { kind: "detour", reason: character.detour?.reason ?? "临时偏离", payload: raw };
    if (sleeping) return { kind: "sleep", reason: "日程：睡觉", payload: raw };
    return { kind: actions.length > 0 ? "routine" : "idle", reason: `日程：${block.activity}`, payload: raw };
  }

  act(world: World, intent: RuntimeIntent, tick: number): RuntimeActionResult {
    const payload = intent.payload as unknown as NpcTickPayload;
    world.state.metrics.schedule.npcTicks++;
    world.state.metrics.runtimeDecisions++;
    const events: string[] = [];
    const before = world.state.eventLog.length;

    if (payload.jailed) {
      world.state.metrics.schedule.excused++;
      updateNeeds(world, this.character, false);
      return { ok: true, intentKind: intent.kind, eventIds: [], detail: "被拘禁，仅推进需求" };
    }

    if (payload.detour) {
      world.state.metrics.schedule.transit++;
      updateNeeds(world, this.character, false);
      return { ok: true, intentKind: intent.kind, eventIds: [], detail: "临时偏离，保留日程计数" };
    }
    if (this.character.detour && tick >= this.character.detour.untilTick) {
      this.character.detour = undefined;
    }

    updateNeeds(world, this.character, payload.sleeping);

    if (intent.kind === "move" && intent.targetRoomId) {
      const event = world.moveCharacter(this.character.id, intent.targetRoomId, intent.reason);
      events.push(event.id);
      world.state.metrics.schedule.transit++;
      return {
        ok: true,
        intentKind: intent.kind,
        eventIds: events,
        detail: `移动到 ${intent.targetRoomId}`,
      };
    }

    world.state.metrics.schedule.adhered++;
    if (payload.sleeping) {
      return { ok: true, intentKind: intent.kind, eventIds: [], detail: "睡觉" };
    }

    for (const action of payload.actions) {
      switch (action) {
        case "eat":
          maybeEat(world, this.character, tick);
          break;
        case "trade":
          tryTrade(world, this.character.id, tick);
          break;
        case "patrol":
          patrol(world, this.character, tick);
          break;
        case "drink":
          drink(world, this.character, tick);
          break;
        case "worship":
          worship(world, this.character, tick);
          break;
        case "case":
          caseTarget(world, this.character, tick);
          break;
        case "gossip":
          gossip(world, this.character, tick);
          break;
        case "help":
          help(world, this.character, tick);
          break;
        default:
          break;
      }
    }

    const after = world.state.eventLog.length;
    for (let index = before; index < after; index++) events.push(world.state.eventLog[index].id);
    return {
      ok: true,
      intentKind: intent.kind,
      eventIds: events,
      detail: payload.actions.length > 0 ? `执行 ${payload.actions.join("/")}` : "无动作",
    };
  }

  onEvent(event: { id: string }): void {
    this.lastEventId = event.id;
  }

  snapshot(world: World): CharacterSnapshot {
    return snapshotCharacter(world, this.character, this.lastEventId);
  }
}

export interface NpcTickResult {
  scheduled: ScheduleBlock;
  moved: boolean;
  transit: boolean;
}

export function npcTick(world: World, character: Character, tick: number): NpcTickResult {
  const runtime = new NpcRuntime(character);
  const intent = runtime.decide(world, {
    tick,
    viewLevel: lodForCharacter(world, character),
    observerRoomId: world.state.pc.currentRoomId,
  });
  const result = runtime.act(world, intent, tick);
  const payload = intent.payload as unknown as NpcTickPayload;
  return {
    scheduled: payload.block,
    moved: result.eventIds.some((id) => world.state.eventLog.find((event) => event.id === id)?.type === "Moved"),
    transit: result.intentKind === "move" || result.intentKind === "detour",
  };
}

export function scheduleAdherence(world: World): {
  npcTicks: number;
  adhered: number;
  transit: number;
  excused: number;
  violations: number;
  ratio: number;
} {
  const schedule = world.state.metrics.schedule;
  const denominator = schedule.adhered + schedule.violations;
  return {
    ...schedule,
    ratio: denominator === 0 ? 1 : schedule.adhered / denominator,
  };
}
