/**
 * ActionDM：只给方向、stakes、难度/分支，不给结果。
 * 结果由 EventResolver 用 p = sigmoid((C-D)/12) 掷骰。
 */

import { clamp, round2 } from "../world/canon.ts";
import { provenance, type World } from "../world/world.ts";
import { createPlan } from "./plans.ts";
import type { Commodity, EventPlan } from "../types.ts";
import { roll } from "../kernel/rng.ts";

export interface ActionDmVerdict {
  direction: string;
  stakes: number;
  difficulty: number;
  branches: { onSuccess: string; onFailure: string; onPartial?: string };
  reason: string;
  proposalId: string;
}

export function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

export function successProbability(capability: number, difficulty: number): number {
  return sigmoid((capability - difficulty) / 12);
}

export function theftCapability(world: World, actorId: string): number {
  const actor = world.character(actorId);
  return actor.skills.theft * 0.65 + actor.skills.stealth * 0.35;
}

export function adjudicateTheft(
  world: World,
  actorId: string,
  targetId: string,
  commodity: Commodity,
  amount: number,
): ActionDmVerdict {
  const actor = world.character(actorId);
  const target = world.character(targetId);
  const guardPresent = world.state.characters.some(
    (character) =>
      character.role === "守卫" &&
      character.currentRoomId === actor.currentRoomId &&
      !character.jailed,
  );
  const targetWatching = target.attention > 0.6;
  const difficulty = 48 + (guardPresent ? 14 : 0) + (targetWatching ? 6 : 0);
  const proposalId = `ad_theft_${actorId}_${world.state.tick}`;
  return {
    direction: `在集市面包摊拿${amount}块${commodity}，得手后沿巷子离开；若被注意就混进人群。`,
    stakes: 0.6,
    difficulty,
    branches: {
      onSuccess: "拿到东西，趁人群还在时离开。",
      onFailure: "被摊主或旁人注意到，丢下东西沿巷子跑。",
    },
    reason: `actor.theft=${actor.skills.theft}, stealth=${actor.skills.stealth}, guardPresent=${guardPresent}, targetAttention=${target.attention}`,
    proposalId,
  };
}

export function scheduleTheft(
  world: World,
  actorId: string,
  targetId: string,
  commodity: Commodity,
  amount: number,
  atTick: number,
): EventPlan {
  const verdict = adjudicateTheft(world, actorId, targetId, commodity, amount);
  return createPlan(world, {
    source: "actor",
    type: "theft",
    placeId: world.placeOfRoom(world.character(targetId).currentRoomId),
    roomId: world.character(targetId).currentRoomId,
    actorIds: [actorId],
    targetIds: [targetId],
    timeWindow: { startTick: atTick, endTick: atTick },
    direction: verdict.direction,
    stakes: verdict.stakes,
    preconditions: ["actor present", "target stock > 0"],
    branches: verdict.branches,
    visibility: "room",
    createdBy: "action-dm",
    proposalId: verdict.proposalId,
    payload: {
      difficulty: verdict.difficulty,
      commodity,
      amount,
      reason: verdict.reason,
    },
  });
}

export interface TheftResolution {
  planId: string;
  eventId: string;
  success: boolean;
  chance: number;
  roll: number;
  capability: number;
  difficulty: number;
  factId?: string;
}

export function resolveTheft(world: World, plan: EventPlan): TheftResolution {
  const actorId = plan.actorIds[0];
  const targetId = plan.targetIds[0];
  const actor = world.character(actorId);
  const target = world.character(targetId);
  const commodity = plan.payload.commodity as Commodity;
  const amount = Number(plan.payload.amount ?? 1);
  const capability = round2(theftCapability(world, actorId));
  const difficulty = Number(plan.payload.difficulty ?? 50);
  const chance = successProbability(capability, difficulty);
  const rollValue = roll(world.seed, "theft", plan.id, plan.timeWindow.startTick);
  const success = rollValue < chance;

  const attempt = world.emit({
    type: "TheftAttempt",
    actorId,
    roomId: target.currentRoomId,
    visibility: "room",
    payload: {
      planId: plan.id,
      targetId,
      commodity,
      amount,
      capability,
      difficulty,
      chance: round2(chance),
      roll: round2(rollValue),
      concealment: "stall",
    },
    provenance: provenance("actor", {
      planId: plan.id,
      proposalId: plan.proposalId,
      seed: world.seed,
    }),
  });

  const summary = success
    ? "集市的面包摊少了两块面包，有人看见一个瘦小的人影离开。"
    : "集市的面包摊前有人伸手，被摊主喝止，瘦小的人影沿巷子跑了。";
  const outcome = world.emit({
    type: success ? "TheftSucceeded" : "TheftFailed",
    actorId,
    roomId: target.currentRoomId,
    visibility: "room",
    sourceEventIds: [attempt.id],
    payload: {
      planId: plan.id,
      targetId,
      commodity,
      amount,
      success,
      capability,
      difficulty,
      chance: round2(chance),
      roll: round2(rollValue),
      branch: success ? "onSuccess" : "onFailure",
      concealment: "stall",
    },
    facts: [
      {
        kind: "crime",
        subjectId: actorId,
        objectId: targetId,
        placeId: world.placeOfRoom(target.currentRoomId),
        detail: {
          culpritId: actorId,
          victimId: targetId,
          commodity,
          amount,
          success,
          difficulty,
          chance: round2(chance),
          roll: round2(rollValue),
        },
        salience: success ? 0.82 : 0.62,
        summary,
      },
    ],
    traces: success
      ? [
          {
            kind: "missing-goods",
            roomId: target.currentRoomId,
            description: "面包板上空出两块的位置，边缘还留着新鲜的刀痕。",
            factId: "pending",
          },
          {
            kind: "footprints",
            roomId: "alley",
            placeId: "road",
            description: "巷口泥地上有一串急促的脚印。",
            factId: "pending",
          },
        ]
      : [
          {
            kind: "scuffle",
            roomId: target.currentRoomId,
            description: "面包摊前的泥地被踩乱，半块面包掉在地上。",
            factId: "pending",
          },
        ],
    provenance: provenance("actor", {
      planId: plan.id,
      proposalId: plan.proposalId,
      seed: world.seed,
    }),
  });

  // trace 草稿的 factId 是占位；事件里已有真实 fact，回填关系。
  const fact = outcome.facts[0];
  for (const trace of outcome.traces) trace.factId = fact.id;
  for (const trace of outcome.traces) if (!fact.traceIds.includes(trace.id)) fact.traceIds.push(trace.id);

  if (success) {
    const sold = Math.min(amount, world.state.stocks[target.currentRoomId]?.bread ?? 0);
    if (sold > 0) {
      world.emit({
        type: "StockChanged",
        actorId,
        roomId: target.currentRoomId,
        visibility: "private",
        payload: { roomId: target.currentRoomId, commodity: "bread", delta: -sold, reason: "theft" },
        provenance: provenance("actor", { planId: plan.id, seed: world.seed }),
      });
    }
  }

  if (outcome.witnesses.length > 0) {
    world.emit({
      type: "Witnessed",
      roomId: target.currentRoomId,
      visibility: "private",
      witnesses: outcome.witnesses,
      sourceEventIds: [outcome.id],
      payload: { ofEventId: outcome.id, witnessIds: outcome.witnesses, factId: fact.id },
      provenance: provenance("actor", { planId: plan.id, seed: world.seed }),
    });
  }

  world.setPlanState(plan.id, "resolved", success ? "theft succeeded" : "theft failed");
  return {
    planId: plan.id,
    eventId: outcome.id,
    success,
    chance,
    roll: rollValue,
    capability,
    difficulty,
    factId: fact.id,
  };
}
