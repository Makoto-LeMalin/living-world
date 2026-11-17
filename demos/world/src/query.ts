/**
 * 查询层：编年史、问 NPC、检查知识边界、指标。
 * 所有答案只读 Belief / EventLog，不读全局真相当成角色知识。
 */

import { dayOf, formatTick } from "./kernel/clock.ts";
import type { Belief, Fact, QueryAnswer, WorldEvent } from "./types.ts";
import type { World } from "./world/world.ts";

export function actorName(world: World, id: string | undefined): string {
  if (!id) return "某人";
  if (id === world.state.pc.id) return world.state.pc.name;
  return world.maybeCharacter(id)?.name ?? world.maybeCrowd(id)?.name ?? id;
}

export function describeEvent(world: World, event: WorldEvent): string {
  if (event.facts.length > 0) return event.facts.map((fact) => fact.summary).join("；");
  switch (event.type) {
    case "Moved": {
      const to = String(event.payload.toRoomId ?? "");
      return `${actorName(world, event.actorId)} 去了 ${world.room(to).name}。`;
    }
    case "Trade":
      return `${actorName(world, event.actorId)} 卖掉一份 ${String(event.payload.commodity)}（${String(event.payload.price)} 文）。`;
    case "RumorTold":
      return `${String(event.payload.speakerName)} 对 ${(event.payload.listenerIds as string[]).map((id) => actorName(world, id)).join("、")} 说：“${String(event.payload.content)}”`;
    case "TheftAttempt":
      return `${actorName(world, event.actorId)} 在面包摊前伸手。`;
    case "Witnessed":
      return `${(event.payload.witnessIds as string[]).map((id) => actorName(world, id)).join("、")} 看见了这一幕。`;
    case "PlanCreated":
      return `计划 ${String(event.payload.plan && (event.payload.plan as { id?: string }).id)} 建立。`;
    case "PlanStateChanged":
      return `计划 ${String(event.payload.planId)}：${String(event.payload.from)} → ${String(event.payload.to)}。`;
    case "BudgetConsumed":
      return `预算记账：${String(event.payload.kind)} ${String(event.payload.key)}。`;
    case "EncounterResolved":
      return `路上遇到 ${String(event.payload.name)}。`;
    case "Spoke":
      return `${actorName(world, event.actorId)} 对 ${actorName(world, String(event.payload.listenerId))} 说：“${String(event.payload.speech)}”`;
    case "PriceChanged":
      return `${String(event.payload.commodity)} 从 ${String(event.payload.from)} 变成 ${String(event.payload.to)}（${String(event.payload.reason)}）。`;
    case "BeliefRevised":
      return `${actorName(world, String(event.payload.holderId))} 改了口供。`;
    default:
      return `${event.type}（${event.roomId}）`;
  }
}

export interface ChronicleOptions {
  includeSystem?: boolean;
  includePrivate?: boolean;
  /** 调试用：把移动/交易/巡逻等 routine 也写出来。 */
  includeRoutine?: boolean;
}

const ROUTINE_TYPES = new Set([
  "Moved",
  "Trade",
  "Patrolled",
  "Drank",
  "Worshipped",
  "Ate",
  "Cased",
  "Helped",
  "BudgetConsumed",
  "PlanCreated",
  "PlanStateChanged",
  "ScheduleDeviation",
]);

const IMPORTANT_TYPES = new Set([
  "TheftAttempt",
  "TheftSucceeded",
  "TheftFailed",
  "Witnessed",
  "ShortageNoticed",
  "PrecautionTaken",
  "Investigated",
  "WitnessStatement",
  "Accused",
  "Jailed",
  "Released",
  "MarketDayStarted",
  "CrackdownStarted",
  "FogRolledIn",
  "FerryDelayed",
  "IllnessReported",
  "StructureDamaged",
  "FireStarted",
  "FireSpread",
  "FireContained",
  "FireDamaged",
  "FireCrowd",
  "SmokeSeen",
  "ReturnObserved",
  "Spoke",
  "BudgetDegraded",
]);

function isImportant(world: World, event: WorldEvent, rumorCounts: Map<string, number>, day: number): boolean {
  if (ROUTINE_TYPES.has(event.type)) return false;
  if (event.type === "RumorTold") {
    const fact = world.state.facts.find((candidate) => candidate.id === event.payload.factId);
    if (!fact || fact.salience < 0.6) return false;
    const listeners = (event.payload.listenerIds as string[] | undefined) ?? [];
    if (Number(event.payload.hops) > 2 && !listeners.includes(world.state.pc.id)) return false;
    const key = `${day}:${fact.id}`;
    const count = rumorCounts.get(key) ?? 0;
    if (count >= 2) return false;
    rumorCounts.set(key, count + 1);
    return true;
  }
  if (event.type === "PriceChanged") {
    return Number(event.payload.changeRatio ?? 0) >= 0.08;
  }
  if (event.type === "EncounterResolved") {
    if (event.actorId !== world.state.pc.id) return false;
    return Boolean(event.payload.factId);
  }
  if (IMPORTANT_TYPES.has(event.type)) return true;
  return event.facts.some((fact) => fact.salience >= 0.5);
}

export function chronicle(world: World, options: ChronicleOptions = {}): string[] {
  const lines: string[] = [];
  let currentDay = -1;
  const rumorCounts = new Map<string, number>();
  for (const event of world.state.eventLog) {
    if (!options.includeSystem && event.provenance.source === "system") continue;
    if (!options.includePrivate && event.visibility === "private" && event.type !== "RumorTold" && event.type !== "ReturnObserved" && event.type !== "Spoke") continue;
    const day = dayOf(event.tick, world.state.config.ticksPerDay) + 1;
    if (!options.includeRoutine && !isImportant(world, event, rumorCounts, day)) continue;
    if (day !== currentDay) {
      currentDay = day;
      lines.push("");
      lines.push(`## 第 ${day} 天`);
    }
    const time = formatTick(
      event.tick,
      world.state.config.ticksPerDay,
      world.state.config.tickMinutes,
      6,
    );
    lines.push(`- ${time} [${event.provenance.source}/${event.type}] ${describeEvent(world, event)}`);
  }
  return lines;
}

function relevantFacts(world: World, beliefs: Belief[], question: string): Array<{ belief: Belief; fact: Fact }> {
  const wantsTheft = /偷|面包|乞丐|贼|抓|拘|关/.test(question);
  const wantsFire = /火|烧|烟|仓库|损失/.test(question);
  const wantsPrice = /价|贵|粮|鱼|钱/.test(question);
  const wantsAll = /发生|这里|怎么|什么/.test(question);
  const seen = new Set<string>();
  return beliefs
    .map((belief) => ({ belief, fact: world.state.facts.find((candidate) => candidate.id === belief.factId) }))
    .filter((entry): entry is { belief: Belief; fact: Fact } => Boolean(entry.fact))
    .filter(({ fact }) => {
      if (wantsTheft && ["crime", "law", "testimony", "suspicion"].includes(fact.kind)) return true;
      if (wantsFire && (fact.kind === "fire" || fact.kind === "event" || fact.kind === "trade")) return true;
      if (wantsPrice && fact.kind === "trade") return true;
      if (wantsAll) return true;
      return false;
    })
    .filter(({ fact }) => {
      if (seen.has(fact.id)) return false;
      seen.add(fact.id);
      return true;
    })
    .sort((a, b) => b.fact.salience * b.belief.confidence - a.fact.salience * a.belief.confidence);
}

export function ask(world: World, npcId: string, question: string): QueryAnswer {
  const beliefs = world.beliefsOf(npcId);
  const relevant = relevantFacts(world, beliefs, question).slice(0, 4);
  if (relevant.length === 0) {
    return {
      npcId,
      question,
      answer: "我不知道。",
      claims: [],
      confidence: 0,
      sourceEventIds: [],
      unknown: true,
    };
  }

  const pieces: string[] = [];
  const claims: string[] = [];
  const sourceEventIds: string[] = [];
  let confidence = 0;
  for (const { belief, fact } of relevant) {
    const lead = belief.hops > 0 ? "听说" : "我知道";
    pieces.push(`${lead}：${belief.content}`);
    claims.push(fact.id);
    sourceEventIds.push(belief.sourceEventId);
    confidence = Math.max(confidence, belief.confidence);
  }
  return {
    npcId,
    question,
    answer: pieces.join(" "),
    claims: [...new Set(claims)],
    confidence: Math.round(confidence * 100) / 100,
    sourceEventIds: [...new Set(sourceEventIds)],
    unknown: false,
  };
}

export interface InspectView {
  id: string;
  name: string;
  role?: string;
  roomId: string;
  activity: string;
  jailed: boolean;
  mood?: Record<string, number>;
  beliefs: Array<{
    factId: string;
    content: string;
    confidence: number;
    hops: number;
    sourceEventId: string;
  }>;
  observations: number;
}

export function inspect(world: World, npcId: string): InspectView {
  if (npcId === world.state.pc.id) {
    return {
      id: npcId,
      name: world.state.pc.name,
      roomId: world.state.pc.currentRoomId,
      activity: world.state.pc.status,
      jailed: false,
      beliefs: world.state.pc.beliefs.map((belief) => ({
        factId: belief.factId,
        content: belief.content,
        confidence: belief.confidence,
        hops: belief.hops,
        sourceEventId: belief.sourceEventId,
      })),
      observations: world.state.pc.observations.length,
    };
  }
  const character = world.maybeCharacter(npcId);
  if (!character) throw new Error(`未知角色: ${npcId}`);
  return {
    id: character.id,
    name: character.name,
    role: character.role,
    roomId: character.currentRoomId,
    activity: world.currentActivity(character),
    jailed: character.jailed,
    mood: { ...character.mood },
    beliefs: character.beliefs.map((belief) => ({
      factId: belief.factId,
      content: belief.content,
      confidence: belief.confidence,
      hops: belief.hops,
      sourceEventId: belief.sourceEventId,
    })),
    observations: character.observations.length,
  };
}

export function chainFrom(world: World, rootEventId: string): WorldEvent[] {
  const byId = new Map(world.state.eventLog.map((event) => [event.id, event]));
  const root = byId.get(rootEventId);
  if (!root) return [];
  const seen = new Set<string>();
  const out: WorldEvent[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const event = queue.shift() as WorldEvent;
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
    for (const id of event.sourceEventIds) {
      const parent = byId.get(id);
      if (parent) queue.push(parent);
    }
  }
  return out;
}

/** 正向链：从根事件出发，找所有直接/间接引用它的事件。 */
export function forwardChain(world: World, rootEventId: string): WorldEvent[] {
  const root = world.state.eventLog.find((event) => event.id === rootEventId);
  if (!root) return [];
  const seen = new Set<string>([root.id]);
  const out: WorldEvent[] = [root];
  let cursor = 0;
  while (cursor < out.length) {
    const current = out[cursor++];
    for (const event of world.state.eventLog) {
      if (seen.has(event.id)) continue;
      if (event.sourceEventIds.includes(current.id)) {
        seen.add(event.id);
        out.push(event);
      }
    }
  }
  return out;
}

export function metricsSnapshot(world: World): Record<string, unknown> {
  return {
    ...world.state.metrics,
    budget: world.state.budget,
    calls: {
      character: world.state.metrics.llmCalls,
      director: world.state.metrics.directorProposals,
      total: world.state.metrics.llmCalls + world.state.metrics.directorProposals,
    },
  };
}
