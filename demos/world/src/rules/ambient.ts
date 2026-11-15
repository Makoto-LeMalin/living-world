/**
 * 自然事件：按地区/类别算 hazard，高 salience 交给 WorldDirector 提方向，
 * 低 salience 走模板；两者都经过 EventValidator。
 */

import { clamp, round2 } from "../world/canon.ts";
import { provenance, type World } from "../world/world.ts";
import { createPlan, planFromProposal, validateProposal } from "./plans.ts";
import { Budget } from "./budget.ts";
import { TemplateWorldDirector, type AsyncWorldDirector, type DirectorContext } from "../world/director.ts";
import { adjustPrice } from "./economy.ts";
import { resolveFireStart } from "./fire.ts";
import type { EventPlan } from "../types.ts";

export type AmbientType = "fog" | "ferry_delay" | "illness" | "structural" | "fire";

interface HazardSpec {
  type: AmbientType;
  base: number;
  salience: number;
  high: boolean;
}

const HAZARDS: HazardSpec[] = [
  { type: "fog", base: 0.025, salience: 0.3, high: false },
  { type: "ferry_delay", base: 0.03, salience: 0.4, high: false },
  { type: "illness", base: 0.01, salience: 0.55, high: true },
  { type: "structural", base: 0.02, salience: 0.5, high: true },
  { type: "fire", base: 0.004, salience: 0.8, high: true },
];

export function lodFor(world: World, placeId: string): "fine" | "coarse" | "cold" {
  const pcPlace = world.placeOfRoom(world.state.pc.currentRoomId);
  if (pcPlace === placeId) return "fine";
  if (placeId === "road") return "coarse";
  return "coarse";
}

export function lodFactor(lod: "fine" | "coarse" | "cold"): number {
  return lod === "fine" ? 1 : lod === "coarse" ? 0.6 : 0.3;
}

export function eventPressure(world: World): number {
  let pressure = 1;
  if (world.state.facts.some((fact) => fact.kind === "crime" && fact.status === "active")) pressure += 0.2;
  if (world.state.facts.some((fact) => fact.kind === "fire" && fact.status === "active")) pressure += 0.5;
  if (world.state.facts.some((fact) => fact.kind === "law" && fact.detail.reason === "theft")) pressure += 0.3;
  const climate = world.state.climate[world.placeOfRoom(world.state.pc.currentRoomId)];
  if (climate) pressure += climate.fear * 0.25 + climate.anger * 0.15;
  return pressure;
}

export function hazardProbability(world: World, placeId: string, spec: HazardSpec, dtHours = 1): number {
  const lod = lodFor(world, placeId);
  const lambda = spec.base * eventPressure(world) * lodFactor(lod);
  return 1 - Math.exp(-lambda * dtHours);
}

function roomFor(world: World, placeId: string, type: AmbientType): string {
  if (type === "fire") return placeId === "wharf" ? "warehouse" : "market_square";
  if (type === "ferry_delay") return placeId === "wharf" ? "wharf" : "market_square";
  if (type === "structural") return placeId === "wharf" ? "wharf" : "market_square";
  if (type === "illness") return placeId === "wharf" ? "inn" : "market_square";
  return placeId === "wharf" ? "wharf" : "market_square";
}

export function directorContext(
  world: World,
  placeId: string,
  type: AmbientType,
  tick: number,
): DirectorContext {
  const lod = lodFor(world, placeId);
  return {
    tick,
    placeId,
    roomId: roomFor(world, placeId, type),
    type,
    lod,
    pressure: round2(eventPressure(world)),
    reason: `place=${placeId}, lod=${lod}, pressure=${round2(eventPressure(world))}, day=${world.day() + 1}`,
  };
}

function recentlyPlanned(world: World, placeId: string, type: string, tick: number): boolean {
  return world.state.plans.some(
    (plan) =>
      plan.placeId === placeId &&
      plan.type === type &&
      plan.createdAtTick > tick - 24 &&
      plan.state !== "aborted",
  );
}

function cooldownActive(world: World, placeId: string, type: string, tick: number): boolean {
  return world.state.eventLog.some(
    (event) =>
      event.placeId === placeId &&
      event.type.toLowerCase().includes(type) &&
      event.tick > tick - 24,
  );
}

function fallbackPlan(
  world: World,
  proposal: ReturnType<TemplateWorldDirector["propose"]>[number],
  reason: string,
): EventPlan {
  return createPlan(world, {
    source: "ambient",
    type: proposal.type,
    placeId: proposal.placeId,
    roomId: proposal.roomId,
    actorIds: [],
    targetIds: [],
    timeWindow: proposal.timeWindow,
    direction: proposal.direction,
    stakes: proposal.stakes,
    preconditions: proposal.preconditions,
    branches: proposal.branches,
    visibility: proposal.visibility,
    createdBy: "rule",
    payload: { fallback: true, reason },
  });
}

export function maybeGenerateAmbient(world: World, budget: Budget, tick: number): EventPlan[] {
  if (tick % 6 !== 0) return [];
  const director = new TemplateWorldDirector();
  const created: EventPlan[] = [];
  const places = [...new Set(world.state.rooms.map((room) => room.placeId))].filter((place) => place !== "road");

  for (const placeId of places) {
    for (const spec of HAZARDS) {
      if ((spec.type === "ferry_delay" || spec.type === "structural") && placeId !== "wharf") continue;
      if (recentlyPlanned(world, placeId, spec.type, tick)) continue;
      if (cooldownActive(world, placeId, spec.type, tick)) continue;
      const probability = hazardProbability(world, placeId, spec, 1);
      const draw = world.rng("ambient-hazard", tick, placeId, spec.type).next();
      if (draw >= probability) continue;

      if (spec.high) {
        if (!budget.canUseDirector(tick) || !budget.canUseHighSalience(placeId, tick)) {
          // 预算不足：高 salience 事件延迟，不静默生成。
          world.emit({
            type: "BudgetDegraded",
            tick,
            roomId: roomFor(world, placeId, spec.type),
            placeId,
            visibility: "private",
            payload: { eventType: spec.type, reason: "budget", action: "deferred" },
            provenance: provenance("system", { seed: world.seed }),
          });
          continue;
        }
        budget.consumeDirector(tick);
        budget.consumeHighSalience(placeId, tick);
        world.state.metrics.directorProposals++;
        const proposals = director.propose(directorContext(world, placeId, spec.type, tick));
        for (const proposal of proposals) {
          const validation = validateProposal(world, proposal);
          if (!validation.ok) {
            created.push(fallbackPlan(world, proposal, validation.errors.join("; ")));
            continue;
          }
          const plan = planFromProposal(world, proposal);
          if (plan.state === "aborted") {
            created.push(fallbackPlan(world, proposal, "director plan aborted"));
          } else {
            created.push(plan);
          }
          break;
        }
      } else {
        const proposal = director.propose(directorContext(world, placeId, spec.type, tick))[0];
        if (!proposal) continue;
        created.push(fallbackPlan(world, proposal, "low-salience template"));
      }
    }
  }
  return created;
}

/** 演示用：在自然 hazard 没触发时，强制一次 WorldDirector 路径，证明高 salience 提案可走通。 */
/**
 * B3 的异步版本：高 salience 走 LLM/异步 Director；低 salience 仍走模板。
 * LLM 失败/非法 → 同类型模板计划，并保留 BudgetConsumed 记录。
 */
export async function maybeGenerateAmbientAsync(
  world: World,
  budget: Budget,
  tick: number,
  director: AsyncWorldDirector,
): Promise<EventPlan[]> {
  if (tick % 6 !== 0) return [];
  const template = new TemplateWorldDirector();
  const created: EventPlan[] = [];
  const places = [...new Set(world.state.rooms.map((room) => room.placeId))].filter((place) => place !== "road");

  for (const placeId of places) {
    for (const spec of HAZARDS) {
      if ((spec.type === "ferry_delay" || spec.type === "structural") && placeId !== "wharf") continue;
      if (recentlyPlanned(world, placeId, spec.type, tick)) continue;
      if (cooldownActive(world, placeId, spec.type, tick)) continue;
      const probability = hazardProbability(world, placeId, spec, 1);
      const draw = world.rng("ambient-hazard", tick, placeId, spec.type).next();
      if (draw >= probability) continue;

      if (!spec.high) {
        const proposal = template.propose(directorContext(world, placeId, spec.type, tick))[0];
        if (proposal) created.push(fallbackPlan(world, proposal, "low-salience template"));
        continue;
      }

      if (!budget.canUseDirector(tick) || !budget.canUseHighSalience(placeId, tick)) {
        world.emit({
          type: "BudgetDegraded",
          tick,
          roomId: roomFor(world, placeId, spec.type),
          placeId,
          visibility: "private",
          payload: { eventType: spec.type, reason: "budget", action: "deferred" },
          provenance: provenance("system", { seed: world.seed }),
        });
        continue;
      }

      budget.consumeDirector(tick);
      budget.consumeHighSalience(placeId, tick);
      world.state.metrics.directorProposals++;
      const context = {
        ...directorContext(world, placeId, spec.type, tick),
        allowedTypes: [spec.type],
      };
      try {
        const proposals = await director.propose(context);
        const proposal = proposals[0];
        if (!proposal) throw new Error("director returned no proposal");
        const validation = validateProposal(world, proposal);
        if (!validation.ok) throw new Error(validation.errors.join("; "));
        const plan = planFromProposal(world, proposal);
        if (plan.state === "aborted") throw new Error("director plan aborted");
        created.push(plan);
      } catch (error) {
        const proposal = template.propose(context)[0];
        if (proposal) {
          created.push(fallbackPlan(world, proposal, `llm fallback: ${String(error)}`));
        }
      }
    }
  }
  return created;
}

export function resolveAmbient(world: World, plan: EventPlan): string {
  switch (plan.type) {
    case "fire":
      return resolveFireStart(world, plan);
    case "fog": {
      const event = world.emit({
        type: "FogRolledIn",
        roomId: plan.roomId,
        placeId: plan.placeId,
        visibility: "place",
        payload: { planId: plan.id, severity: 0.4 },
        facts: [
          {
            kind: "weather",
            subjectId: plan.placeId,
            placeId: plan.placeId,
            detail: { fog: true, severity: 0.4 },
            salience: 0.28,
            summary: "河面起雾，渡船慢了下来，路上的人缩着脖子。",
          },
        ],
        provenance: provenance("ambient", { planId: plan.id, seed: world.seed }),
      });
      adjustPrice(world, "bread", 1.02, "雾天运输变慢");
      world.refreshClimate(plan.placeId, "河面起雾");
      world.setPlanState(plan.id, "resolved", "fog resolved");
      return event.id;
    }
    case "ferry_delay": {
      const event = world.emit({
        type: "FerryDelayed",
        roomId: plan.roomId,
        placeId: plan.placeId,
        visibility: "place",
        payload: { planId: plan.id, delayTicks: 6 },
        facts: [
          {
            kind: "event",
            subjectId: plan.roomId,
            placeId: plan.placeId,
            detail: { ferryDelayed: true, delayTicks: 6 },
            salience: 0.38,
            summary: "渡船晚了，等船的人挤在码头的棚子下。",
          },
        ],
        provenance: provenance("ambient", { planId: plan.id, seed: world.seed }),
      });
      adjustPrice(world, "fish", 1.05, "渡船晚点，鱼货变少", [event.id]);
      world.refreshClimate(plan.placeId, "渡船晚点");
      world.setPlanState(plan.id, "resolved", "ferry delay resolved");
      return event.id;
    }
    case "illness": {
      const event = world.emit({
        type: "IllnessReported",
        roomId: plan.roomId,
        placeId: plan.placeId,
        visibility: "place",
        payload: { planId: plan.id, cases: 3 },
        facts: [
          {
            kind: "event",
            subjectId: plan.roomId,
            placeId: plan.placeId,
            detail: { illness: true, cases: 3 },
            salience: 0.55,
            summary: "客栈里有人发热咳嗽，塞拉让人先别去集市。",
          },
        ],
        provenance: provenance("ambient", { planId: plan.id, seed: world.seed }),
      });
      for (const crowd of world.state.crowds) {
        if (world.placeOfRoom(crowd.roomId) !== plan.placeId) continue;
        crowd.mood.fear = clamp(crowd.mood.fear + 0.12);
      }
      world.refreshClimate(plan.placeId, "有人发热");
      world.setPlanState(plan.id, "resolved", "illness resolved");
      return event.id;
    }
    case "structural": {
      const event = world.emit({
        type: "StructureDamaged",
        roomId: plan.roomId,
        placeId: plan.placeId,
        visibility: "place",
        payload: { planId: plan.id, structure: "wharf-plank" },
        facts: [
          {
            kind: "event",
            subjectId: plan.roomId,
            placeId: plan.placeId,
            detail: { structure: "wharf-plank", loose: true },
            salience: 0.45,
            summary: "码头栈桥的一块木板松了，走上去会晃。",
          },
        ],
        traces: [
          {
            kind: "damage",
            roomId: plan.roomId,
            description: "栈桥第三块木板翘起，钉子露在外面。",
          },
        ],
        provenance: provenance("ambient", { planId: plan.id, seed: world.seed }),
      });
      world.refreshClimate(plan.placeId, "栈桥松了");
      world.setPlanState(plan.id, "resolved", "structural resolved");
      return event.id;
    }
    default:
      world.setPlanState(plan.id, "aborted", `unknown ambient type ${plan.type}`);
      return "";
  }
}
