/**
 * 三日集市的 headless 仿真。
 *
 * 当前脚本只保留观察者行程和“起火点”概率种子；
 * 盗窃由 npc_thief 的饥饿/机会规则触发，执法按守卫知识/冷却推进，
 * 商人反应由事实触发，PC 出发/返回由盗窃事实触发。
 * 是否成功、谁看见、传多远、抓谁、价格怎么变，全部由规则和种子决定。
 */

import { buildWorld, defaultConfig, loadCanon } from "./world/canon.ts";
import { World, provenance } from "./world/world.ts";
import { Budget } from "./rules/budget.ts";
import { createPlan } from "./rules/plans.ts";
import { maybeGenerateAmbient, maybeGenerateAmbientAsync, resolveAmbient } from "./rules/ambient.ts";
import { TemplateWorldDirector, type AsyncWorldDirector } from "./world/director.ts";
import { resolveFireDamage, resolveFirePrice, resolveFireSpread, resolveFireStart, scheduleFire } from "./rules/fire.ts";
import { scheduleTheft, resolveTheft, type TheftResolution } from "./rules/theft.ts";
import { runLawChain } from "./rules/law.ts";
import { institutionPulse, spreadRumor, tellDirectly } from "./rules/rumor.ts";
import { tryEncounter } from "./rules/travel.ts";
import { computeReturnDiff, snapshotPlace } from "./rules/return.ts";
import { npcTick, scheduleAdherence, lodForCharacter } from "./agents/runtime.ts";
import { maybeUpdateTiers, importanceOf } from "./agents/tiers.ts";
import { CrowdRuntime, individualizeCrowd, mergeCrowdMember } from "./agents/crowd.ts";
import { characterDialogue, type DialogueResult } from "./agents/dialogue.ts";
import { adjustPrice } from "./rules/economy.ts";
import { ask, forwardChain, inspect, type InspectView } from "./query.ts";
import { checkWorldInvariants, terminalPlans, type InvariantReport } from "./world/invariants.ts";
import type { ChatClient } from "../../../llm/types.ts";
import type {
  CanonFile,
  DepartureSnapshot,
  EventPlan,
  Fact,
  LodLevel,
  QueryAnswer,
  ReturnDiff,
  WorldConfig,
  WorldEvent,
} from "./types.ts";

export interface SimulationOptions {
  seed?: string;
  days?: number;
  observer?: boolean;
  /** B3：异步 WorldDirector（LLM 或 stub）；不传则用模板。 */
  director?: AsyncWorldDirector;
  /** 需要绑定到实际 World 的 director（例如 LlmWorldDirector）。 */
  directorFactory?: (world: World) => AsyncWorldDirector;
  /** B3 完整运行时：T0–T3 调度、群体、focus 对话。 */
  b3?: boolean;
  /** 角色对话客户端；只有 b3=true 时使用。 */
  dialogueClient?: ChatClient;
  /** B3 每多少 tick 尝试一次同房间对话。 */
  dialogueInterval?: number;
  /** 每个世界日最多触发多少次对话场景。 */
  maxDialoguesPerDay?: number;
}

interface ScenarioContext {
  departure?: DepartureSnapshot;
  returnDiff?: ReturnDiff;
  theft?: TheftResolution;
  fireEventId?: string;
  theftPlanId?: string;
  theftTick?: number;
  queries: Record<string, QueryAnswer>;
  inspect: Record<string, InspectView>;
  errors: string[];
  pcPath: string[];
  knownShareAt12h?: number;
  pcPhase: "temple" | "market" | "toB" | "atB" | "toA" | "done";
  pcTravel?: { path: string[]; index: number; direction: "toB" | "toA" };
  bArrivalTick?: number;
  departureTick?: number;
  returnTick?: number;
  lastCourierTick?: number;
  lastFireCheckTick?: number;
  fireScheduled?: boolean;
  b3Dialogues: DialogueResult[];
  dialogueDay?: number;
  dialogueToday: number;
  talkedToday: Set<string>;
  crowdActions: number;
  individualizedMemberId?: string;
  mergeCrowdAtTick?: number;
}

export interface RuntimeSummary {
  tierChanges: number;
  promotions: number;
  demotions: number;
  crowdIndividualizations: number;
  crowdMerges: number;
  crowdActions: number;
  offstageCharacterCalls: number;
  dialogues: DialogueResult[];
  dialogueCalls: number;
  dialogueByLod: Record<string, number>;
  dialogueByNpc: Record<string, number>;
  maxCallsPerTick: number;
}

export interface SimulationResult {
  world: World;
  config: WorldConfig;
  departure?: DepartureSnapshot;
  returnDiff?: ReturnDiff;
  theft?: TheftResolution;
  fireEventId?: string;
  queries: Record<string, QueryAnswer>;
  inspect: Record<string, InspectView>;
  schedule: ReturnType<typeof scheduleAdherence>;
  budget: ReturnType<Budget["totals"]>;
  knownShareAt12h: number;
  invariants: InvariantReport;
  plansTerminal: boolean;
  errors: string[];
  eventsBySource: Record<string, number>;
  fireChain: string[];
  theftChain: string[];
  runtime?: RuntimeSummary;
}

function setPcStatus(world: World, status: "active" | "traveling" | "resting"): void {
  world.state.pc.status = status;
}

function movePcStep(
  world: World,
  to: string,
  reason: string,
  tick: number,
  excludeFactKinds: Array<Fact["kind"]> = [],
): void {
  const from = world.state.pc.currentRoomId;
  world.movePc(to, reason, tick);
  tryEncounter(world, world.state.pc.id, from, to, tick, { excludeFactKinds });
}

function maybeNpcTheft(world: World, context: ScenarioContext, tick: number): void {
  if (context.theft) return;
  if (context.theftPlanId) {
    const existing = world.plan(context.theftPlanId);
    if (existing && existing.state !== "aborted") return;
    context.theftPlanId = undefined;
  }
  const actor = world.maybeCharacter("npc_thief");
  const target = world.maybeCharacter("npc_merchant");
  if (!actor || !target) return;
  if (world.scheduleActivity(actor) === "sleep" || world.scheduleActivity(target) === "sleep") return;
  if (actor.currentRoomId !== "market_square" || target.currentRoomId !== "market_square") return;
  if (actor.needs.hunger < 80) return;
  if ((world.state.stocks.market_square?.bread ?? 0) <= 0) return;
  if (tick % 6 !== 0) return;

  const guardPresent = world.occupants("market_square").includes("npc_guard");
  const crowdPresent = world.occupants("market_square").includes("crowd_market");
  const chance = 0.55 + (crowdPresent ? 0.12 : 0) - (guardPresent ? 0.2 : 0);
  if (world.rng("npc-theft", tick, "opportunity").next() >= chance) return;

  const plan = scheduleTheft(world, actor.id, target.id, "bread", 2, tick + 2);
  context.theftPlanId = plan.id;
  if (plan.state === "aborted") context.errors.push(`盗窃计划被校验拒绝: ${plan.id}`);
}

function merchantReaction(world: World, context: ScenarioContext, tick: number): void {
  const merchant = world.maybeCharacter("npc_merchant");
  if (!merchant) return;
  const crime = [...world.state.facts].reverse().find((fact) => fact.kind === "crime");
  if (!crime) return;
  const success = Boolean(crime.detail.success);
  if (merchant.currentRoomId !== "market_square" || world.scheduleActivity(merchant) === "sleep") return;

  const shortage = world.state.facts.find(
    (fact) => fact.kind === "trade" && typeof fact.detail.shortage === "boolean",
  );
  if (!shortage && tick - crime.validFromTick >= 4) {
    const stock = world.state.stocks.market_square?.bread ?? 0;
    world.emit({
      type: "ShortageNoticed",
      tick,
      actorId: merchant.id,
      roomId: "market_square",
      visibility: "room",
      sourceEventIds: [crime.sourceEventId],
      payload: { commodity: "bread", stock, success },
      facts: [
        {
          kind: "trade",
          subjectId: merchant.id,
          objectId: "bread",
          placeId: "market",
          detail: { commodity: "bread", stock, shortage: success },
          salience: 0.5,
          summary: success ? "玛拉盘点面包，发现少了两块，开始骂人。" : "玛拉发现面包摊被人动过，但东西没少。",
        },
      ],
      provenance: provenance("actor", { seed: world.seed }),
    });
    return;
  }

  const theftPrice = world.state.facts.find(
    (fact) => fact.kind === "trade" && fact.detail.reason === "集市失窃，面包供给变紧",
  );
  if (success && shortage && !theftPrice && tick - shortage.validFromTick >= 2) {
    adjustPrice(world, "bread", 1.18, "集市失窃，面包供给变紧", [crime.sourceEventId]);
    return;
  }

  const precaution = world.state.facts.find(
    (fact) => fact.kind === "trade" && fact.detail.precaution === "new-lock",
  );
  if (!precaution && tick - crime.validFromTick >= 12) {
    world.emit({
      type: "PrecautionTaken",
      tick,
      actorId: merchant.id,
      roomId: "market_square",
      visibility: "room",
      sourceEventIds: [crime.sourceEventId],
      payload: { precaution: "new-lock", sourceFactId: crime.id },
      facts: [
        {
          kind: "trade",
          subjectId: merchant.id,
          objectId: "bread",
          placeId: "market",
          detail: { precaution: "new-lock", sourceFactId: crime.id },
          salience: 0.42,
          summary: "玛拉给面包箱换了新锁，钥匙挂在围裙里。",
        },
      ],
      traces: [
        {
          kind: "lock",
          roomId: "market_square",
          description: "面包箱上多了一把新锁，锁鼻还亮。",
        },
      ],
      provenance: provenance("actor", { seed: world.seed }),
    });
  }
}

function guardHearsRumor(world: World, tick: number): void {
  const guard = world.maybeCharacter("npc_guard");
  const crowd = world.maybeCrowd("crowd_market");
  if (!guard || !crowd) return;
  if (guard.currentRoomId !== "market_square") return;
  if (guard.beliefs.some((belief) => world.state.facts.find((fact) => fact.id === belief.factId)?.kind === "crime")) {
    return;
  }
  const belief = crowd.beliefs.find((candidate) => world.state.facts.find((fact) => fact.id === candidate.factId)?.kind === "crime");
  if (!belief) return;
  tellDirectly(world, crowd.id, guard.id, belief, tick, "听说是集市那个乞丐干的。");
}

function maybeAgendaPlan(world: World): void {
  const jailFact = world.state.facts.find(
    (fact) => fact.kind === "law" && fact.detail.reason === "theft" && fact.detail.suspectId,
  );
  if (!jailFact) return;
  const existing = world.state.plans.find((plan) => plan.type === "crackdown" && plan.state !== "aborted");
  if (existing) return;
  createPlan(world, {
    source: "special",
    type: "crackdown",
    placeId: "market",
    roomId: "market_square",
    actorIds: ["npc_guard"],
    targetIds: [],
    factionIds: ["f_law"],
    timeWindow: { startTick: world.state.tick + 2, endTick: world.state.tick + 12 },
    direction: "守卫在集市和城门盘查陌生人，回应失窃后的不安。",
    stakes: 0.6,
    preconditions: [],
    branches: {
      onSuccess: "盘查让集市安静下来，也让外来者更紧张。",
      onFailure: "没有人配合，盘查草草结束。",
    },
    visibility: "public",
    createdBy: "rule",
    payload: { agenda: "law", sourceFactId: jailFact.id },
  });
}

function resolveMarketDay(world: World, plan: EventPlan): string {
  const marketCrowd = world.maybeCrowd("crowd_market");
  if (marketCrowd) {
    marketCrowd.size += 12;
    marketCrowd.mood.hope = Math.min(1, marketCrowd.mood.hope + 0.1);
    marketCrowd.mood.fear = Math.max(0, marketCrowd.mood.fear - 0.04);
  }
  adjustPrice(world, "bread", 1.03, "集市日需求增加");
  adjustPrice(world, "fish", 1.04, "集市日需求增加");
  const event = world.emit({
    type: "MarketDayStarted",
    roomId: plan.roomId,
    placeId: plan.placeId,
    visibility: "public",
    payload: { planId: plan.id, crowdSize: marketCrowd?.size ?? 0 },
    facts: [
      {
        kind: "event",
        subjectId: "market_square",
        placeId: "market",
        detail: { marketDay: true, crowdSize: marketCrowd?.size ?? 0 },
        salience: 0.4,
        summary: "集市日，摊位延长到傍晚，人群比平时多。",
      },
    ],
    traces: [
      {
        kind: "decoration",
        roomId: "market_square",
        description: "摊位之间挂起了褪色的布条，是集市日才有的装饰。",
      },
    ],
    provenance: provenance("special", { planId: plan.id, seed: world.seed }),
  });
  world.refreshClimate("market", "集市日");
  world.setPlanState(plan.id, "resolved", "market day resolved");
  return event.id;
}

function resolveCrackdown(world: World, plan: EventPlan): string {
  const guard = world.maybeCharacter("npc_guard");
  if (guard && guard.currentRoomId !== plan.roomId) {
    world.moveCharacter(guard.id, plan.roomId, "crackdown patrol");
  }
  if (guard) guard.mood.anger = Math.min(1, guard.mood.anger + 0.08);
  const event = world.emit({
    type: "CrackdownStarted",
    actorId: guard?.id,
    roomId: plan.roomId,
    placeId: plan.placeId,
    visibility: "public",
    payload: { planId: plan.id, agenda: plan.payload.agenda },
    facts: [
      {
        kind: "law",
        subjectId: guard?.id ?? "npc_guard",
        objectId: "market_square",
        placeId: "market",
        detail: { crackdown: true, reason: "theft" },
        salience: 0.7,
        summary: "守卫在集市和城门盘查陌生人，气氛比平时紧。",
      },
    ],
    traces: [
      {
        kind: "notice",
        roomId: "gate",
        description: "城门告示板上多了一张“盘查陌生人”的告示。",
      },
    ],
    provenance: provenance("special", { planId: plan.id, seed: world.seed }),
  });
  for (const crowd of world.state.crowds) {
    crowd.mood.fear = Math.min(1, crowd.mood.fear + 0.12);
    crowd.mood.suspicion = Math.min(1, crowd.mood.suspicion + 0.1);
  }
  world.refreshClimate("market", "守卫在盘查陌生人");
  world.setPlanState(plan.id, "resolved", "crackdown resolved");
  return event.id;
}

function preconditionsHold(world: World, plan: EventPlan): boolean {
  for (const precondition of plan.preconditions) {
    if (precondition === "actor present") {
      for (const actorId of plan.actorIds) {
        const character = world.maybeCharacter(actorId);
        if (!character || character.currentRoomId !== plan.roomId || character.jailed) return false;
      }
    } else if (precondition === "target stock > 0") {
      const stock = world.state.stocks[plan.roomId]?.bread ?? 0;
      if (stock <= 0) return false;
    } else if (precondition === "room has flammable stock") {
      const stocks = world.state.stocks[plan.roomId] ?? {};
      if (!Object.values(stocks).some((amount) => (amount ?? 0) > 0)) return false;
    } else if (precondition === "fire still active") {
      if (!world.state.facts.some((fact) => fact.kind === "fire" && fact.status === "active")) return false;
    }
  }
  return true;
}

function resolvePlan(world: World, plan: EventPlan): void {
  switch (plan.type) {
    case "theft":
      resolveTheft(world, plan);
      return;
    case "fire":
      resolveFireStart(world, plan);
      return;
    case "fire_spread":
      resolveFireSpread(world, plan);
      return;
    case "fire_damage":
      resolveFireDamage(world, plan);
      return;
    case "fire_price":
      resolveFirePrice(world, plan);
      return;
    case "market_day":
      resolveMarketDay(world, plan);
      return;
    case "crackdown":
      resolveCrackdown(world, plan);
      return;
    case "fog":
    case "ferry_delay":
    case "illness":
    case "structural":
      resolveAmbient(world, plan);
      return;
    default:
      world.setPlanState(plan.id, "aborted", `no resolver for ${plan.type}`);
  }
}

export function processDuePlans(world: World, tick: number, context?: ScenarioContext): void {
  const due = world.state.plans.filter(
    (plan) => plan.state === "scheduled" && plan.timeWindow.startTick <= tick,
  );
  for (const plan of due) {
    if (plan.state !== "scheduled") continue;
    if (plan.timeWindow.endTick < tick) {
      world.setPlanState(plan.id, "aborted", "plan window missed");
      continue;
    }
    world.setPlanState(plan.id, "pending", "window open");
    if (!preconditionsHold(world, plan)) {
      world.setPlanState(plan.id, "aborted", "preconditions failed");
      continue;
    }
    world.setPlanState(plan.id, "resolving", "resolving");
    try {
      resolvePlan(world, plan);
      if (world.plan(plan.id)?.state === "resolving") {
        world.setPlanState(plan.id, "resolved", "resolver completed");
      }
    } catch (error) {
      context?.errors.push(`plan ${plan.id}: ${String(error)}`);
      if (world.plan(plan.id)?.state === "resolving") {
        world.setPlanState(plan.id, "aborted", `resolver error: ${String(error)}`);
      }
    }
  }
}

function startJourney(
  world: World,
  context: ScenarioContext,
  tick: number,
  direction: "toB" | "toA",
): void {
  const path = direction === "toB"
    ? ["alley", "gate", "wharf", "inn"]
    : ["wharf", "gate", "alley", "market_square"];
  if (direction === "toB") {
    context.departure = snapshotPlace(world, "market", tick);
    context.departureTick = tick;
    context.pcPhase = "toB";
  } else {
    context.pcPhase = "toA";
  }
  context.pcTravel = { path, index: 0, direction };
  setPcStatus(world, "traveling");
  movePcTravel(world, context, tick);
}

function movePcTravel(world: World, context: ScenarioContext, tick: number): void {
  const travel = context.pcTravel;
  if (!travel) return;
  if (travel.index >= travel.path.length) return;
  const to = travel.path[travel.index];
  const exclude: Array<Fact["kind"]> = travel.direction === "toB" ? ["crime", "law"] : [];
  movePcStep(world, to, travel.direction === "toB" ? "travel A->B" : "travel B->A", tick, exclude);
  travel.index++;
  if (travel.index < travel.path.length) return;

  if (travel.direction === "toB") {
    context.pcPhase = "atB";
    context.bArrivalTick = tick;
    setPcStatus(world, "resting");
  } else {
    context.pcPhase = "done";
    context.returnTick = tick;
    setPcStatus(world, "active");
    if (context.departure) observeReturn(world, context, tick);
  }
}

function maybeInnkeeperTellsPc(world: World, tick: number): void {
  const pc = world.state.pc;
  if (pc.currentRoomId !== "inn") return;
  const innkeeper = world.maybeCharacter("npc_innkeeper");
  if (!innkeeper || innkeeper.currentRoomId !== "inn") return;
  const belief = innkeeper.beliefs.find(
    (candidate) => world.state.facts.find((fact) => fact.id === candidate.factId)?.kind === "crime",
  );
  if (!belief) return;
  if (pc.beliefs.some((candidate) => candidate.factId === belief.factId)) return;
  tellDirectly(world, innkeeper.id, pc.id, belief, tick, belief.content);
}

function maybeRumorCourier(world: World, context: ScenarioContext, tick: number): void {
  if (tick % 6 !== 0) return;
  const crime = world.state.facts.find((fact) => fact.kind === "crime" && fact.status === "active");
  if (!crime) return;
  const innkeeper = world.maybeCharacter("npc_innkeeper");
  if (!innkeeper) return;
  if (innkeeper.beliefs.some((belief) => belief.factId === crime.id)) return;
  if (tick - crime.validFromTick < 6) return;
  if (context.lastCourierTick !== undefined && tick - context.lastCourierTick < 12) return;
  context.lastCourierTick = tick;

  const content = "听说是集市那个乞丐干的。";
  world.emit({
    type: "EncounterResolved",
    tick,
    roomId: "inn",
    placeId: "wharf",
    visibility: "room",
    witnesses: ["npc_innkeeper"],
    sourceEventIds: [crime.sourceEventId],
    payload: {
      encounterId: `courier_${tick}`,
      routeId: "r_gate_wharf",
      kind: "courier",
      name: "从集市来的信使",
      factId: crime.id,
      content,
    },
    facts: [
      {
        kind: "event",
        subjectId: "inn",
        placeId: "wharf",
        detail: { courier: true, sourceFactId: crime.id },
        salience: 0.3,
        summary: "一个从集市来的信使进了渡口客栈，和店主低声说话。",
      },
    ],
    provenance: provenance("ambient", { seed: world.seed }),
  });
  const belief = {
    factId: crime.id,
    content,
    confidence: 0.55,
    sourceEventId: crime.sourceEventId,
    learnedAtTick: tick,
    version: 1,
    hops: 1,
    originPlaceId: "market",
    suspectId: "npc_beggar",
  };
  spreadRumor(world, `courier_${tick}`, [innkeeper.id], belief, { tick, content, confidence: 0.55 });
}

function maybeSeedFire(world: World, context: ScenarioContext, tick: number): void {
  if (context.fireScheduled) return;
  if (world.state.facts.some((fact) => fact.kind === "fire")) return;
  if (world.state.plans.some((plan) => plan.type === "fire" && plan.state !== "aborted")) return;
  if (tick % 6 !== 0) return;
  const crime = world.state.facts.find((fact) => fact.kind === "crime");
  if (!crime) return;
  const jail = world.state.facts.find((fact) => fact.kind === "law" && fact.detail.reason === "theft");
  const since = jail?.validFromTick ?? crime.validFromTick;
  if (tick - since < 24) return;
  const climate = world.state.climate.wharf;
  const chance = 0.3 + (climate?.fear ?? 0) * 0.25;
  if (world.rng("ignition", tick).next() >= chance) return;
  scheduleFire(world, "warehouse", tick + 2, "oil lamp in chaff");
  context.fireScheduled = true;
}

function observeReturn(world: World, context: ScenarioContext, tick: number): void {
  if (!context.departure || context.returnDiff) return;
  context.returnDiff = computeReturnDiff(world, context.departure, tick);
  world.emit({
    type: "ReturnObserved",
    tick,
    actorId: world.state.pc.id,
    roomId: "market_square",
    visibility: "private",
    witnesses: [world.state.pc.id],
    payload: {
      stable: context.returnDiff.stableIds.length,
      changed: context.returnDiff.changed.length,
      added: context.returnDiff.addedIds.length,
      removed: context.returnDiff.removedIds.length,
      echoes: context.returnDiff.echoes.length,
    },
    provenance: provenance("actor", { seed: world.seed }),
    facts: [
      {
        kind: "event",
        subjectId: "market_square",
        placeId: "market",
        detail: {
          stable: context.returnDiff.stableIds.length,
          changed: context.returnDiff.changed.length,
          echoes: context.returnDiff.echoes.length,
        },
        salience: 0.3,
        summary: `观察者回到集市：${context.returnDiff.changed.length} 处变化，${context.returnDiff.stableIds.length} 处仍然可辨认。`,
      },
    ],
  });
}

function maybePcScript(world: World, context: ScenarioContext, tick: number): void {
  const crime = world.state.facts.find((fact) => fact.kind === "crime" && fact.status === "active");
  if (context.pcPhase === "temple") {
    if (crime && tick >= crime.validFromTick + 2) {
      movePcStep(world, "market_square", "observer returns to market", tick);
      context.pcPhase = "market";
      setPcStatus(world, "active");
    } else if (!crime && tick >= 320) {
      movePcStep(world, "market_square", "observer gives up waiting", tick);
      context.pcPhase = "market";
      setPcStatus(world, "active");
    }
    return;
  }

  if (context.pcPhase === "market") {
    const readyTick = crime ? crime.validFromTick + 8 : 200;
    if (tick >= readyTick && !context.departure) startJourney(world, context, tick, "toB");
    return;
  }

  if (context.pcPhase === "toB" || context.pcPhase === "toA") {
    if (context.pcPhase === "toA") forceReturnWoman(world, tick);
    movePcTravel(world, context, tick);
    return;
  }

  if (context.pcPhase === "atB") {
    maybeInnkeeperTellsPc(world, tick);
    if (context.bArrivalTick !== undefined && tick - context.bArrivalTick >= 36) {
      startJourney(world, context, tick, "toA");
    }
  }
}

function forceReturnWoman(world: World, tick: number): void {
  const pc = world.state.pc;
  const arrest = [...world.state.facts]
    .reverse()
    .find((fact) => fact.kind === "law" && fact.detail.reason === "theft" && fact.status === "active");
  if (!arrest) return;
  if (pc.beliefs.some((belief) => belief.factId === arrest.id)) return;
  const content = "乞丐还关着，可东西没找回来。";
  world.emit({
    type: "EncounterResolved",
    tick,
    actorId: pc.id,
    roomId: pc.currentRoomId,
    visibility: "room",
    witnesses: [pc.id],
    sourceEventIds: [arrest.sourceEventId],
    payload: {
      encounterId: `enc_return_woman_${tick}`,
      routeId: "r_alley_gate",
      kind: "traveller",
      name: "赶集的妇人",
      reason: "return rumor",
      factId: arrest.id,
      content,
    },
    provenance: provenance("ambient", { seed: world.seed }),
  });
  const belief = {
    factId: arrest.id,
    content,
    confidence: 0.55,
    sourceEventId: arrest.sourceEventId,
    learnedAtTick: tick,
    version: 1,
    hops: 0,
    originPlaceId: "market",
    suspectId: "npc_beggar",
  };
  spreadRumor(world, `enc_return_woman_${tick}`, [pc.id], belief, { tick, content, confidence: 0.55 });
}

function scenarioPre(world: World, context: ScenarioContext, tick: number): void {
  maybeNpcTheft(world, context, tick);
  maybeRumorCourier(world, context, tick);
  maybePcScript(world, context, tick);
  maybeSeedFire(world, context, tick);
}

function scenarioPost(world: World, context: ScenarioContext, tick: number): void {
  merchantReaction(world, context, tick);
  guardHearsRumor(world, tick);
  runLawChain(world, tick);
  maybeAgendaPlan(world);
  if (context.pcPhase === "done" && context.departure && !context.returnDiff) {
    observeReturn(world, context, tick);
  }
}

export function runSimulation(options: SimulationOptions = {}): SimulationResult {
  const canon = loadCanon();
  const config = defaultConfig(options.seed ?? "7", options.days ?? 3);
  config.observer.enabled = options.observer ?? true;
  const world = new World(buildWorld(canon, config));
  const budget = new Budget(world);
  const context: ScenarioContext = {
    queries: {},
    inspect: {},
    errors: [],
    pcPath: [],
    pcPhase: "temple",
    b3Dialogues: [],
    dialogueToday: 0,
    talkedToday: new Set<string>(),
    crowdActions: 0,
  };

  world.emit({
    type: "WorldBuilt",
    tick: 0,
    roomId: "market_square",
    visibility: "private",
    payload: { canon: canon.id, seed: config.worldSeed },
    provenance: provenance("system", { seed: config.worldSeed }),
  });

  const endTick = config.days * config.ticksPerDay;
  for (let tick = 0; tick < endTick; tick++) {
    world.state.tick = tick;
    world.state.metrics.ticks = tick + 1;

    for (const character of world.state.characters) {
      npcTick(world, character, tick);
    }

    scenarioPre(world, context, tick);
    maybeGenerateAmbient(world, budget, tick);
    processDuePlans(world, tick, context);
    scenarioPost(world, context, tick);
    institutionPulse(world, tick);
    if (context.theftTick === undefined) {
      const crime = world.state.facts.find((fact) => fact.kind === "crime");
      if (crime) context.theftTick = crime.validFromTick;
    }
    if (context.theftTick !== undefined && tick === context.theftTick + 72) {
      const crime = world.state.facts.find((fact) => fact.kind === "crime");
      if (crime) {
        const relevant = ["npc_merchant", "npc_child", "npc_guard", "npc_beggar", "npc_innkeeper", "npc_drunk", "npc_thief", "npc_ferryman"];
        const known = relevant.filter((id) =>
          world.state.characters.find((character) => character.id === id)?.beliefs.some((belief) => belief.factId === crime.id),
        );
        context.knownShareAt12h = known.length / relevant.length;
      }
    }

    if (tick % 6 === 0) {
      world.refreshClimate("market", world.state.climate.market?.dominantNarrative ?? "日常");
      world.refreshClimate("wharf", world.state.climate.wharf?.dominantNarrative ?? "日常");
    }

    const theft = world.state.plans.find((plan) => plan.type === "theft" && plan.state === "resolved");
    if (theft && !context.theft) {
      const fact = world.state.facts.find((candidate) => candidate.kind === "crime");
      if (fact) {
        context.theft = {
          planId: theft.id,
          eventId: fact.sourceEventId,
          success: Boolean(fact.detail.success),
          chance: Number(fact.detail.chance ?? 0),
          roll: Number(fact.detail.roll ?? 0),
          capability: 0,
          difficulty: Number(fact.detail.difficulty ?? 0),
          factId: fact.id,
        };
      }
    }
  }

  world.state.tick = endTick;
  world.state.metrics.ticks = endTick;
  return finalizeSimulation(world, config, context, budget, endTick);
}

function finalizeSimulation(
  world: World,
  config: WorldConfig,
  context: ScenarioContext,
  budget: Budget,
  endTick: number,
  runtime?: RuntimeSummary,
): SimulationResult {
  world.state.tick = endTick;
  world.state.metrics.ticks = endTick;
  const fireEvents = world.state.eventLog.filter((event) => event.type === "FireStarted");
  context.fireEventId = fireEvents[0]?.id;

  context.queries["merchant"] = ask(world, "npc_merchant", "这里发生过什么？");
  context.queries["child"] = ask(world, "npc_child", "谁偷了面包？");
  context.queries["guard"] = ask(world, "npc_guard", "你们抓了谁？");
  context.queries["priest"] = ask(world, "npc_priest", "谁偷了面包？");
  context.queries["ferryman"] = ask(world, "npc_ferryman", "谁偷了面包？");
  context.inspect["guard"] = inspect(world, "npc_guard");
  context.inspect["child"] = inspect(world, "npc_child");

  const schedule = scheduleAdherence(world);
  const invariants = checkWorldInvariants(world);
  const fireRoot = context.fireEventId;
  const fireChain = fireRoot ? forwardChain(world, fireRoot).map((event) => event.id) : [];
  const crimeFact = world.state.facts.find((fact) => fact.kind === "crime");
  const theftAttempt = world.state.eventLog.find(
    (event) => event.type === "TheftAttempt" && event.payload.planId === context.theft?.planId,
  );
  const theftRoot = theftAttempt?.id ?? crimeFact?.sourceEventId;
  const theftChain = theftRoot ? forwardChain(world, theftRoot).map((event) => event.id) : [];

  return {
    world,
    config,
    departure: context.departure,
    returnDiff: context.returnDiff,
    theft: context.theft,
    fireEventId: context.fireEventId,
    queries: context.queries,
    inspect: context.inspect,
    schedule: { ...schedule, ratio: Math.round(schedule.ratio * 10000) / 10000 },
    budget: budget.totals(),
    knownShareAt12h: context.knownShareAt12h ?? 0,
    invariants,
    plansTerminal: terminalPlans(world),
    errors: context.errors,
    eventsBySource: world.state.metrics.eventsBySource as unknown as Record<string, number>,
    fireChain,
    theftChain,
    runtime,
  };
}

function dialogueQuestion(world: World): string {
  if (world.state.facts.some((fact) => fact.kind === "fire" && fact.status === "active")) {
    return "你看到火光了吗？这里发生了什么？";
  }
  if (world.state.facts.some((fact) => fact.kind === "crime" && fact.status === "active")) {
    return "这里发生过什么？";
  }
  return "今天集市怎么样？";
}

/**
 * B3 focus 场景：只选观察者同房间的 NPC，每 tick 最多 K=3，且每人每天最多一次。
 * 这是“NPC 像主角一样说话”的入口，但动作仍由规则选，LLM 只填 speech。
 */
async function maybeDialogueScenes(
  world: World,
  context: ScenarioContext,
  tick: number,
  options: SimulationOptions,
  force = false,
): Promise<void> {
  if (!options.b3 || !options.dialogueClient) return;
  const interval = options.dialogueInterval ?? 12;
  if (!force && tick % interval !== 0) return;
  const day = world.day();
  if (context.dialogueDay !== day) {
    context.dialogueDay = day;
    context.dialogueToday = 0;
    context.talkedToday.clear();
  }
  const limit = options.maxDialoguesPerDay ?? 8;
  if (context.dialogueToday >= limit) return;

  const pcRoom = world.state.pc.currentRoomId;
  const candidates = world.state.characters
    .filter(
      (character) =>
        character.currentRoomId === pcRoom &&
        !character.jailed &&
        !context.talkedToday.has(character.id) &&
        character.tier !== "T2",
    )
    .map((character) => ({ character, importance: importanceOf(world, character, tick).score }))
    .sort((a, b) => b.importance - a.importance);

  if (candidates.length === 0) return;
  const budget = new Budget(world);
  const slots = Math.min(
    3 - budget.characterUsedForTick(tick),
    limit - context.dialogueToday,
    candidates.length,
  );
  if (slots <= 0) return;

  const question = dialogueQuestion(world);
  for (const candidate of candidates.slice(0, slots)) {
    const result = await characterDialogue(world, candidate.character.id, question, {
      client: options.dialogueClient,
      budget,
      reason: force ? "final-debrief" : "runtime-scene",
    });
    context.b3Dialogues.push(result);
    context.talkedToday.add(candidate.character.id);
    if (result.calls === 0) break;
    context.dialogueToday++;
  }
}

function crowdPulse(world: World, context: ScenarioContext, tick: number): void {
  if (tick % 12 !== 0) return;
  for (const crowd of world.state.crowds) {
    const runtime = new CrowdRuntime(crowd);
    const intent = runtime.decide(world, {
      tick,
      viewLevel: "ambient",
      observerRoomId: world.state.pc.currentRoomId,
    });
    if (!intent) continue;
    if (intent.kind === "crowd-mill" && tick % 24 !== 0) continue;
    runtime.act(world, intent, tick);
    context.crowdActions++;
  }
}

/**
 * 观察者点名一个群体成员 → 个体化 → 24 tick 后回到群体。
 * 只在 B3 模式触发；用来验证“个体身份保留、群体统计回写”在真实 3 天里成立。
 */
function maybeCrowdObservation(world: World, context: ScenarioContext, tick: number): void {
  if (context.individualizedMemberId) {
    if (context.mergeCrowdAtTick !== undefined && tick >= context.mergeCrowdAtTick) {
      const member = world.maybeCharacter(context.individualizedMemberId);
      const crowd = member?.crowdId ? world.maybeCrowd(member.crowdId) : undefined;
      if (member && crowd && !member.jailed && member.currentRoomId === crowd.roomId) {
        mergeCrowdMember(world, crowd.id, member.id);
      }
      context.individualizedMemberId = undefined;
      context.mergeCrowdAtTick = undefined;
    }
    return;
  }
  if (tick !== 288) return;
  const crowd = world.state.crowds.find((candidate) => candidate.roomId === world.state.pc.currentRoomId);
  if (!crowd || crowd.size <= 0) return;
  const member = individualizeCrowd(world, crowd.id, { reason: "observer notices a face" });
  context.individualizedMemberId = member.id;
  context.mergeCrowdAtTick = tick + 24;
}

function runtimeSummary(world: World, context: ScenarioContext, budget: Budget): RuntimeSummary {
  const totals = budget.totals();
  const byLod: Record<string, number> = {};
  for (const [key, value] of Object.entries(totals.byLod)) {
    const lod = key.split(":")[0] as LodLevel;
    byLod[lod] = (byLod[lod] ?? 0) + value;
  }
  const byNpc: Record<string, number> = {};
  for (const [key, value] of Object.entries(totals.byNpc)) {
    const npc = key.split(":")[0];
    byNpc[npc] = (byNpc[npc] ?? 0) + value;
  }
  return {
    tierChanges: world.state.metrics.tierChanges,
    promotions: world.state.metrics.promotions,
    demotions: world.state.metrics.demotions,
    crowdIndividualizations: world.state.metrics.crowdIndividualizations,
    crowdMerges: world.state.metrics.crowdMerges,
    crowdActions: context.crowdActions,
    offstageCharacterCalls: totals.offstageCharacterCalls,
    dialogues: context.b3Dialogues,
    dialogueCalls: context.b3Dialogues.reduce((sum, result) => sum + result.calls, 0),
    dialogueByLod: byLod,
    dialogueByNpc: byNpc,
    maxCallsPerTick: totals.maxCharacterTick,
  };
}

export async function runSimulationAsync(options: SimulationOptions = {}): Promise<SimulationResult> {
  const canon = loadCanon();
  const config = defaultConfig(options.seed ?? "7", options.days ?? 3);
  config.observer.enabled = options.observer ?? true;
  const world = new World(buildWorld(canon, config));
  const budget = new Budget(world);
  const context: ScenarioContext = {
    queries: {},
    inspect: {},
    errors: [],
    pcPath: [],
    pcPhase: "temple",
    b3Dialogues: [],
    dialogueToday: 0,
    talkedToday: new Set<string>(),
    crowdActions: 0,
  };
  const director: AsyncWorldDirector =
    options.director ??
    (options.directorFactory ? options.directorFactory(world) : {
      propose: async (ctx) => new TemplateWorldDirector().propose(ctx),
    });

  world.emit({
    type: "WorldBuilt",
    tick: 0,
    roomId: "market_square",
    visibility: "private",
    payload: { canon: canon.id, seed: config.worldSeed, director: options.director || options.directorFactory ? "async" : "template" },
    provenance: provenance("system", { seed: config.worldSeed }),
  });

  const endTick = config.days * config.ticksPerDay;
  for (let tick = 0; tick < endTick; tick++) {
    world.state.tick = tick;
    world.state.metrics.ticks = tick + 1;

    for (const character of world.state.characters) {
      npcTick(world, character, tick);
    }
    if (options.b3) {
      maybeUpdateTiers(world, tick);
      crowdPulse(world, context, tick);
      maybeCrowdObservation(world, context, tick);
    }

    scenarioPre(world, context, tick);
    await maybeGenerateAmbientAsync(world, budget, tick, director);
    processDuePlans(world, tick, context);
    scenarioPost(world, context, tick);
    if (options.b3) await maybeDialogueScenes(world, context, tick, options);
    institutionPulse(world, tick);
    if (context.theftTick === undefined) {
      const crime = world.state.facts.find((fact) => fact.kind === "crime");
      if (crime) context.theftTick = crime.validFromTick;
    }
    if (context.theftTick !== undefined && tick === context.theftTick + 72) {
      const crime = world.state.facts.find((fact) => fact.kind === "crime");
      if (crime) {
        const relevant = ["npc_merchant", "npc_child", "npc_guard", "npc_beggar", "npc_innkeeper", "npc_drunk", "npc_thief", "npc_ferryman"];
        const known = relevant.filter((id) =>
          world.state.characters.find((character) => character.id === id)?.beliefs.some((belief) => belief.factId === crime.id),
        );
        context.knownShareAt12h = known.length / relevant.length;
      }
    }

    if (tick % 6 === 0) {
      world.refreshClimate("market", world.state.climate.market?.dominantNarrative ?? "日常");
      world.refreshClimate("wharf", world.state.climate.wharf?.dominantNarrative ?? "日常");
    }

    const theft = world.state.plans.find((plan) => plan.type === "theft" && plan.state === "resolved");
    if (theft && !context.theft) {
      const fact = world.state.facts.find((candidate) => candidate.kind === "crime");
      if (fact) {
        context.theft = {
          planId: theft.id,
          eventId: fact.sourceEventId,
          success: Boolean(fact.detail.success),
          chance: Number(fact.detail.chance ?? 0),
          roll: Number(fact.detail.roll ?? 0),
          capability: 0,
          difficulty: Number(fact.detail.difficulty ?? 0),
          factId: fact.id,
        };
      }
    }
  }

  world.state.tick = endTick;
  world.state.metrics.ticks = endTick;
  if (options.b3 && options.dialogueClient) {
    await maybeDialogueScenes(world, context, endTick, options, true);
  }
  return finalizeSimulation(
    world,
    config,
    context,
    budget,
    endTick,
    options.b3 ? runtimeSummary(world, context, budget) : undefined,
  );
}

export { loadCanon, buildWorld, defaultConfig };
