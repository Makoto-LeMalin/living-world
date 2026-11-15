/**
 * 火灾链：起火 → 蔓延 → 损伤 → 价格/人群。
 * 脚本只注入“起火点”；是否蔓延、损失多少、价格涨多少由规则与种子决定。
 */

import { clamp, round2 } from "../world/canon.ts";
import { provenance, type World } from "../world/world.ts";
import { createPlan } from "./plans.ts";
import { adjustPrice, changeStock } from "./economy.ts";
import { stream } from "../../../../src/kernel/rng.ts";
import type { Commodity, EventPlan } from "../types.ts";

export function scheduleFire(world: World, roomId: string, atTick: number, cause: string): EventPlan {
  return createPlan(world, {
    source: "ambient",
    type: "fire",
    placeId: world.placeOfRoom(roomId),
    roomId,
    timeWindow: { startTick: atTick, endTick: atTick },
    direction: "仓库里的谷壳被引燃，火从门缝和木梁之间蔓延。",
    stakes: 0.8,
    preconditions: ["room has flammable stock"],
    branches: {
      onSuccess: "火势扩大，仓库受损，价格和人群情绪发生变化。",
      onFailure: "火被及时扑灭，只留下烟痕。",
    },
    visibility: "place",
    createdBy: "rule",
    payload: { injected: true, cause, severity: 0.65 },
  });
}

function followUp(
  world: World,
  parent: EventPlan,
  type: string,
  atTick: number,
  direction: string,
  payload: Record<string, unknown>,
): EventPlan {
  return createPlan(world, {
    source: "ambient",
    type,
    placeId: parent.placeId,
    roomId: parent.roomId,
    timeWindow: { startTick: atTick, endTick: atTick },
    direction,
    stakes: 0.7,
    preconditions: ["fire still active"],
    branches: {
      onSuccess: "按火势继续结算。",
      onFailure: "火势被控制。",
    },
    visibility: "place",
    createdBy: "rule",
    parentPlanId: parent.id,
    payload,
  });
}

export function resolveFireStart(world: World, plan: EventPlan): string {
  const start = world.emit({
    type: "FireStarted",
    roomId: plan.roomId,
    placeId: plan.placeId,
    visibility: "place",
    payload: {
      planId: plan.id,
      cause: plan.payload.cause,
      severity: plan.payload.severity,
      injected: true,
    },
    facts: [
      {
        kind: "fire",
        subjectId: plan.roomId,
        placeId: plan.placeId,
        detail: { cause: String(plan.payload.cause ?? "unknown"), severity: Number(plan.payload.severity ?? 0.6) },
        salience: 0.9,
        summary: "仓库里起火，黑烟从门缝里冒出来。",
      },
    ],
    traces: [
      {
        kind: "burn",
        roomId: plan.roomId,
        description: "仓库门框被熏黑，谷壳灰一直撒到门槛外。",
      },
    ],
    provenance: provenance("ambient", {
      planId: plan.id,
      seed: world.seed,
      injected: true,
    }),
  });

  // 市场隔着一个场区，仍能看到烟；这不是全局知识，只是可见迹象。
  world.emit({
    type: "SmokeSeen",
    roomId: "market_square",
    placeId: "market",
    visibility: "place",
    sourceEventIds: [start.id],
    payload: { fromPlaceId: plan.placeId, smoke: true },
    facts: [
      {
        kind: "event",
        subjectId: "wharf",
        placeId: "market",
        detail: { smokeFrom: "wharf", sourceFireEventId: start.id },
        salience: 0.55,
        summary: "码头方向升起黑烟，集市上的人开始张望。",
      },
    ],
    provenance: provenance("ambient", { planId: plan.id, seed: world.seed }),
  });

  const startRng = stream(world.seed, "fire-spread", plan.id);
  const spreads = startRng.next() < 0.78;
  const spreadPlan = followUp(
    world,
    plan,
    "fire_spread",
    plan.timeWindow.startTick + 4,
    "火沿着木梁和谷壳蔓延到仓库深处。",
    { spreads, parent: plan.id, fireEventId: start.id },
  );
  plan.payload.spreadPlanId = spreadPlan.id;
  plan.payload.fireEventId = start.id;
  world.setPlanState(plan.id, "resolved", "fire started");
  return start.id;
}

export function resolveFireSpread(world: World, plan: EventPlan): string {
  const spreads = Boolean(plan.payload.spreads);
  const event = world.emit({
    type: spreads ? "FireSpread" : "FireContained",
    roomId: plan.roomId,
    placeId: plan.placeId,
    visibility: "place",
    sourceEventIds: [String(plan.payload.fireEventId)],
    payload: { planId: plan.id, spreads, parentPlanId: plan.parentPlanId },
    facts: [
      {
        kind: "fire",
        subjectId: plan.roomId,
        placeId: plan.placeId,
        detail: { spreads, sourceFireEventId: String(plan.payload.fireEventId) },
        salience: spreads ? 0.82 : 0.5,
        summary: spreads ? "火势蔓延到仓库深处，木梁开始塌。" : "守卫和船夫把火压住了，仓库只熏黑了一角。",
      },
    ],
    provenance: provenance("ambient", { planId: plan.id, seed: world.seed }),
  });

  const damagePlan = followUp(
    world,
    plan,
    "fire_damage",
    plan.timeWindow.startTick + 4,
    "清点火势造成的损失。",
    { parent: plan.id, spreadEventId: event.id, spreads },
  );
  plan.payload.damagePlanId = damagePlan.id;
  world.setPlanState(plan.id, "resolved", spreads ? "fire spread" : "fire contained");
  return event.id;
}

export function resolveFireDamage(world: World, plan: EventPlan): string {
  const spreads = Boolean(plan.payload.spreads);
  const rng = stream(world.seed, "fire-damage", plan.id);
  const grainLoss = spreads ? 20 + Math.floor(rng.next() * 40) : 4;
  const fishLoss = spreads ? 10 + Math.floor(rng.next() * 25) : 2;
  const lossDetail: Record<string, number> = { grainLoss, fishLoss };

  const event = world.emit({
    type: "FireDamaged",
    roomId: plan.roomId,
    placeId: plan.placeId,
    visibility: "place",
    sourceEventIds: [String(plan.payload.spreadEventId)],
    payload: { planId: plan.id, ...lossDetail, parentPlanId: plan.parentPlanId },
    facts: [
      {
        kind: "fire",
        subjectId: "warehouse",
        placeId: plan.placeId,
        detail: { ...lossDetail, spreads, sourceFireEventId: String(plan.payload.spreadEventId) },
        salience: 0.86,
        summary: `仓库损失了 ${grainLoss} 袋粮和 ${fishLoss} 筐鱼，烧痕留在门框上。`,
      },
    ],
    traces: [
      {
        kind: "burn",
        roomId: plan.roomId,
        description: "仓库门槛焦黑，地上混着谷壳和鱼的灰。",
      },
    ],
    provenance: provenance("ambient", { planId: plan.id, seed: world.seed }),
  });

  if (spreads) {
    changeStock(world, "warehouse", "grain", -grainLoss, "fire");
    changeStock(world, "warehouse", "fish", -fishLoss, "fire");
  }

  const pricePlan = followUp(
    world,
    plan,
    "fire_price",
    plan.timeWindow.startTick + 4,
    "供给减少，集市重新定价。",
    { parent: plan.id, damageEventId: event.id, spreads },
  );
  plan.payload.pricePlanId = pricePlan.id;
  world.setPlanState(plan.id, "resolved", "fire damaged");
  return event.id;
}

export function resolveFirePrice(world: World, plan: EventPlan): string {
  const spreads = Boolean(plan.payload.spreads);
  const before = { ...world.state.prices };
  const grain = adjustPrice(world, "grain", spreads ? 1.28 : 1.06, "火灾后供给减少", [String(plan.payload.damageEventId)]);
  const fish = adjustPrice(world, "fish", spreads ? 1.16 : 1.03, "火灾后供给减少", [String(plan.payload.damageEventId)]);
  const priceEvent = world.state.eventLog[world.state.eventLog.length - 1];

  const event = world.emit({
    type: "FireCrowd",
    roomId: "wharf",
    placeId: "wharf",
    visibility: "place",
    sourceEventIds: [String(plan.payload.damageEventId)],
    payload: {
      planId: plan.id,
      spread: spreads,
      bread: world.state.prices.bread,
      grain,
      fish,
      crowdFear: true,
    },
    facts: [
      {
        kind: "trade",
        subjectId: "market_square",
        objectId: "grain",
        placeId: "market",
        detail: {
          grainFrom: before.grain,
          grainTo: grain,
          fishFrom: before.fish,
          fishTo: fish,
          reason: "fire",
        },
        salience: clamp(0.45 + (spreads ? 0.2 : 0)),
        summary: `火灾之后粮价从 ${before.grain} 涨到 ${grain}，鱼价也变了。`,
      },
    ],
    provenance: provenance("ambient", { planId: plan.id, seed: world.seed, proposalId: priceEvent.provenance.proposalId }),
  });

  for (const crowd of world.state.crowds) {
    crowd.mood.fear = clamp(crowd.mood.fear + (spreads ? 0.3 : 0.12));
    crowd.mood.hope = clamp(crowd.mood.hope - (spreads ? 0.1 : 0.03));
  }
  world.refreshClimate("wharf", spreads ? "仓库失火" : "仓库冒烟");
  world.refreshClimate("market", spreads ? "码头失火，粮价要涨" : "码头冒烟");

  plan.payload.priceEventId = priceEvent.id;
  plan.payload.crowdEventId = event.id;
  world.setPlanState(plan.id, "resolved", "fire price updated");
  return event.id;
}

export function fireLossSummary(world: World): Record<string, number> {
  const out: Record<string, number> = {};
  for (const fact of world.state.facts.filter((candidate) => candidate.kind === "fire")) {
    for (const key of ["grainLoss", "fishLoss"] as const) {
      const value = fact.detail[key];
      if (typeof value === "number") out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}

export function commodityPrices(world: World): Record<Commodity, number> {
  return { ...world.state.prices };
}
