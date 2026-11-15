/**
 * B3 的可执行检查：CM-1/5/6/7/8 + 预算降级。
 *
 * 这些检查不依赖真实模型；真实 3 天运行由 b3-full.ts 负责。
 */

import type { ChatClient } from "../../../llm/types.ts";
import { buildWorld, defaultConfig, loadCanon } from "./world/canon.ts";
import { World } from "./world/world.ts";
import { runSimulation } from "./sim.ts";
import { npcTick } from "./agents/runtime.ts";
import { NpcRuntime } from "./agents/runtime.ts";
import {
  ScriptedPcRuntime,
  identityHash,
  type CharacterRuntime,
} from "./agents/character.ts";
import { CrowdRuntime, individualizeCrowd, mergeCrowdMember } from "./agents/crowd.ts";
import { forceTier, importanceOf } from "./agents/tiers.ts";
import { Budget, BUDGET_LIMITS } from "./rules/budget.ts";
import { focusDialogue } from "./agents/dialogue.ts";
import type { CharacterRecord, WorldEvent } from "./types.ts";

export interface ContractCheck {
  id: string;
  kind: string;
  pass: boolean;
  checks: string[];
  errors: string[];
}

function runContract(
  world: World,
  runtime: CharacterRuntime,
  tick = 0,
): ContractCheck {
  const checks: string[] = [];
  const errors: string[] = [];
  const ok = (condition: unknown, message: string) => {
    checks.push(message);
    if (!condition) errors.push(message);
  };
  try {
    const perception = runtime.perceive(world, "focus");
    ok(perception.selfId === runtime.id, "perceive.selfId");
    ok(Boolean(world.maybeCharacter(perception.roomId) || world.room(perception.roomId)), "perceive.roomId 可解析");
    ok(perception.kind === runtime.kind, "perceive.kind");
    ok(perception.knownFactIds.length >= 0, "perceive.knownFactIds");

    const intent = runtime.decide(world, {
      tick,
      viewLevel: "focus",
      observerRoomId: world.state.pc.currentRoomId,
    });
    ok(Boolean(intent), "decide 返回 intent");
    if (intent) {
      const result = runtime.act(world, intent, tick);
      ok(result.ok, "act.ok");
      ok(result.intentKind === intent.kind, "act.intentKind");
      ok(Array.isArray(result.eventIds), "act.eventIds");
    }

    const event = world.state.eventLog[world.state.eventLog.length - 1];
    if (event) runtime.onEvent(event);
    const snapshot = runtime.snapshot(world);
    ok(snapshot.id === runtime.id, "snapshot.id");
    ok(snapshot.kind === runtime.kind, "snapshot.kind");
    ok(/^[0-9a-f]{8}$/.test(snapshot.identityHash), "snapshot.identityHash");
    ok(snapshot.detailLevel.length > 0, "snapshot.detailLevel");
    ok(!event || snapshot.lastEventId === event.id, "onEvent 更新 lastEventId");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { id: runtime.id, kind: runtime.kind, pass: errors.length === 0, checks, errors };
}

export function checkCm1(): {
  pass: boolean;
  pc: ContractCheck;
  npc: ContractCheck;
  crowd: ContractCheck;
} {
  const pcWorld = new World(buildWorld(loadCanon(), defaultConfig("7")));
  const pc = runContract(pcWorld, new ScriptedPcRuntime("pc_observer", ["market_square"]));
  const npcWorld = new World(buildWorld(loadCanon(), defaultConfig("7")));
  const npc = runContract(npcWorld, new NpcRuntime(npcWorld.character("npc_merchant")));
  const crowdWorld = new World(buildWorld(loadCanon(), defaultConfig("7")));
  const crowd = runContract(crowdWorld, new CrowdRuntime(crowdWorld.crowd("crowd_market")));
  return { pass: pc.pass && npc.pass && crowd.pass, pc, npc, crowd };
}

export interface Cm6Check {
  pass: boolean;
  cycles: number;
  identityStable: number;
  relationshipsStable: number;
  keyMemoriesRetained: number;
  errors: string[];
}

export function checkCm6(): Cm6Check {
  const result = runSimulation({ seed: "7", days: 3 });
  const world = result.world;
  const merchant = world.character("npc_merchant");
  // 保证至少有一条关键记忆；真实仿真里通常已有，空则注入一条本地事实。
  if (merchant.beliefs.length === 0) {
    world.emit({
      type: "Cm6Seed",
      tick: world.state.tick,
      actorId: merchant.id,
      roomId: merchant.currentRoomId,
      visibility: "private",
      witnesses: [merchant.id],
      facts: [
        {
          kind: "event",
          subjectId: merchant.id,
          placeId: "market",
          detail: { seed: "cm6" },
          salience: 0.8,
          summary: "玛拉记得集市里发生过一件事。",
        },
      ],
      provenance: { source: "system", ruleVersion: "world-b3.0", seed: world.seed },
    });
  }
  world.state.tick = 432;
  const identity = identityHash(merchant);
  const relationships = JSON.stringify(merchant.relationships);
  const errors: string[] = [];
  let identityStable = 0;
  let relationshipsStable = 0;
  let keyMemoriesRetained = 0;
  const cycles = 20;
  for (let cycle = 0; cycle < cycles; cycle++) {
    forceTier(world, merchant.id, "T2", `cm6-demote-${cycle}`);
    const record = merchant.record;
    if (!record) {
      errors.push(`cycle ${cycle}: 降级后没有 CharacterRecord`);
      continue;
    }
    if (record.identityHash === identity) identityStable++;
    if (JSON.stringify(record.relationships) === relationships) relationshipsStable++;
    forceTier(world, merchant.id, "T0", `cm6-promote-${cycle}`);
    if (identityHash(merchant) === identity) identityStable++;
    if (JSON.stringify(merchant.relationships) === relationships) relationshipsStable++;
    const retained = (record.keyMemories ?? []).every((memory) =>
      merchant.beliefs.some((belief) => belief.factId === memory.factId),
    );
    if (retained) keyMemoriesRetained++;
    if (merchant.id !== "npc_merchant" || merchant.name !== "玛拉" || merchant.role !== "面包商") {
      errors.push(`cycle ${cycle}: 身份字段变化`);
    }
  }
  return {
    pass:
      identityStable === cycles * 2 &&
      relationshipsStable === cycles * 2 &&
      keyMemoriesRetained === cycles &&
      errors.length === 0,
    cycles,
    identityStable,
    relationshipsStable,
    keyMemoriesRetained,
    errors,
  };
}

export interface Cm7Check {
  pass: boolean;
  crowdId: string;
  initialSize: number;
  afterIndividualize: number;
  afterMerge: number;
  afterReobserve: number;
  sameIdentity: boolean;
  identityHash?: string;
  keyMemoryIds: string[];
  errors: string[];
}

export function checkCm7(): Cm7Check {
  const world = new World(buildWorld(loadCanon(), defaultConfig("7")));
  const crowd = world.crowd("crowd_market");
  const initialSize = crowd.size;
  const errors: string[] = [];
  const member = individualizeCrowd(world, crowd.id, { reason: "cm7-observe" });
  const afterIndividualize = crowd.size;
  const record = member.record;
  const identity = identityHash(member);
  if (afterIndividualize !== initialSize - 1) errors.push("个体化后群体人数不正确");
  if (!crowd.representativeIds.includes(member.id)) errors.push("群体没有记录代表");
  if (crowd.individualizedCount !== 1) errors.push("个体化计数不正确");
  if (record) errors.push("新个体不应带旧 record");

  // 制造一条关键记忆，验证合并/再观察后仍在。
  world.emit({
    type: "Cm7Memory",
    tick: 0,
    actorId: member.id,
    roomId: member.currentRoomId,
    visibility: "private",
    witnesses: [member.id],
    facts: [
      {
        kind: "event",
        subjectId: member.id,
        placeId: "market",
        detail: { seed: "cm7" },
        salience: 0.9,
        summary: "这个赶集人记得自己看见过什么。",
      },
    ],
    provenance: { source: "system", ruleVersion: "world-b3.0", seed: world.seed },
  });
  const keyMemoryIds = member.beliefs.map((belief) => belief.factId);

  const merged = mergeCrowdMember(world, crowd.id, member.id);
  const afterMerge = crowd.size;
  if (afterMerge !== initialSize) errors.push("合并后群体人数未恢复");
  if (!merged.tombstone) errors.push("合并记录没有 tombstone");
  if (world.maybeCharacter(member.id)) errors.push("合并后成员仍在 characters");

  const again = individualizeCrowd(world, crowd.id, { preferredId: member.id, reason: "cm7-reobserve" });
  const afterReobserve = crowd.size;
  const sameIdentity = again.id === member.id && identityHash(again) === identity;
  if (!sameIdentity) errors.push("再次观察没有复用同一身份");
  if (afterReobserve !== initialSize - 1) errors.push("再观察后群体人数不正确");
  for (const factId of keyMemoryIds) {
    if (!again.beliefs.some((belief) => belief.factId === factId)) {
      errors.push(`再次观察丢关键记忆 ${factId}`);
    }
  }
  return {
    pass: errors.length === 0,
    crowdId: crowd.id,
    initialSize,
    afterIndividualize,
    afterMerge,
    afterReobserve,
    sameIdentity,
    identityHash: identity,
    keyMemoryIds,
    errors,
  };
}

export interface LeakCheck {
  pass: boolean;
  leaks: Array<{ holderId: string; factId: string; eventId: string; reason: string }>;
  checkedBeliefs: number;
}

export function checkCm8(world: World): LeakCheck {
  const byId = new Map(world.state.eventLog.map((event) => [event.id, event]));
  const leaks: LeakCheck["leaks"] = [];
  let checkedBeliefs = 0;
  const checkHolder = (holderId: string, beliefs: Array<{ factId: string; sourceEventId: string; hops: number }>) => {
    for (const belief of beliefs) {
      checkedBeliefs++;
      const event = byId.get(belief.sourceEventId);
      if (!event) {
        leaks.push({ holderId, factId: belief.factId, eventId: belief.sourceEventId, reason: "source event 不存在" });
        continue;
      }
      if (belief.hops > 0) continue;
      if (event.visibility === "public") continue;
      if (event.actorId === holderId || event.witnesses.includes(holderId)) continue;
      leaks.push({
        holderId,
        factId: belief.factId,
        eventId: belief.sourceEventId,
        reason: `hops=0 但 holder 不是 actor/witness（${event.type}）`,
      });
    }
  };
  for (const character of world.state.characters) checkHolder(character.id, character.beliefs);
  checkHolder(world.state.pc.id, world.state.pc.beliefs);
  for (const crowd of world.state.crowds) checkHolder(crowd.id, crowd.beliefs);
  return { pass: leaks.length === 0, leaks, checkedBeliefs };
}

export interface BudgetStressCheck {
  pass: boolean;
  characterCalls: number;
  directorCalls: number;
  total: number;
  fallbackCalls: number;
  degradedEvents: number;
  maxPerTick: number;
  errors: string[];
}

function stubClient(): ChatClient {
  return {
    async chat() {
      return { content: JSON.stringify({ speech: "不该被调用", claims: [], tone: "calm" }), model: "stub" };
    },
  };
}

export async function checkBudgetStressAsync(): Promise<BudgetStressCheck> {
  const world = new World(buildWorld(loadCanon(), defaultConfig("7")));
  const budget = new Budget(world);
  const errors: string[] = [];
  for (let index = 0; index < BUDGET_LIMITS.directorPerDay; index++) {
    budget.consumeDirector(index, "stress");
  }
  for (let index = 0; index < BUDGET_LIMITS.characterPerDay; index++) {
    budget.consumeCharacter(index, { lod: "focus", npcId: `stress_${index}` });
  }
  world.state.tick = 30;
  const merchant = world.character("npc_merchant");
  world.moveCharacter(merchant.id, world.state.pc.currentRoomId, "budget-stress");
  const answer = await focusDialogue(world, merchant.id, "这里发生过什么？", {
    client: stubClient(),
    budget,
    allowAnyNpc: true,
  });
  if (answer.calls !== 0) errors.push("超预算后仍发生角色调用");
  if (answer.source !== "template") errors.push("超预算后没有回退模板");
  const degraded = world.state.eventLog.filter((event) => event.type === "BudgetDegraded").length;
  if (degraded === 0) errors.push("没有 BudgetDegraded 事件");
  if (budget.totals().total > BUDGET_LIMITS.totalPerDay) errors.push("总预算超限");
  return {
    pass: errors.length === 0,
    characterCalls: budget.characterUsed(),
    directorCalls: budget.directorUsed(),
    total: budget.totals().total,
    fallbackCalls: answer.calls,
    degradedEvents: degraded,
    maxPerTick: budget.totals().maxCharacterTick,
    errors,
  };
}

export function maxTierCoverage(world: World): { tiers: string[]; pass: boolean } {
  const tiers = new Set<string>(world.state.characters.map((character) => character.tier));
  for (const crowd of world.state.crowds) tiers.add(crowd.tier);
  return { tiers: [...tiers].sort(), pass: ["T0", "T1", "T2", "T3"].every((tier) => tiers.has(tier)) };
}

export function tierImportanceSample(world: World): Array<{ id: string; tier: string; score: number }> {
  return world.state.characters
    .map((character) => ({
      id: character.id,
      tier: character.tier,
      score: importanceOf(world, character).score,
    }))
    .sort((a, b) => b.score - a.score);
}

export type { CharacterRecord, WorldEvent };
