import test from "node:test";
import assert from "node:assert/strict";

import { buildWorld, defaultConfig, loadCanon } from "../src/world/canon.ts";
import { World } from "../src/world/world.ts";
import {
  canTransition,
  createPlan,
  hasResultClaim,
  transitionPlan,
  validatePlan,
  validateProposal,
} from "../src/rules/plans.ts";
import { Budget, BUDGET_LIMITS } from "../src/rules/budget.ts";
import type { EventProposal } from "../src/types.ts";

function world(): World {
  return new World(buildWorld(loadCanon(), defaultConfig("7")));
}

test("direction 含已定结果会被拒绝", () => {
  assert.equal(hasResultClaim("他成功偷了面包"), true);
  assert.equal(hasResultClaim("她偷到了钱"), true);
  assert.equal(hasResultClaim("在集市偷面包，失败则逃向巷子"), false);
});

test("未知 actor 的计划会被创建但进入 aborted", () => {
  const w = world();
  const plan = createPlan(w, {
    source: "actor",
    type: "theft",
    placeId: "market",
    roomId: "market_square",
    actorIds: ["npc_nobody"],
    targetIds: ["npc_merchant"],
    timeWindow: { startTick: 10, endTick: 10 },
    direction: "在集市偷面包。",
    stakes: 0.5,
    branches: { onSuccess: "得手", onFailure: "被看见" },
    createdBy: "action-dm",
  });
  assert.equal(plan.state, "aborted");
  assert.ok(w.state.eventLog.some((event) => event.type === "PlanStateChanged" && event.payload.to === "aborted"));
});

test("合法的 actor 计划按 proposed → validated → scheduled", () => {
  const w = world();
  const plan = createPlan(w, {
    source: "actor",
    type: "theft",
    placeId: "market",
    roomId: "market_square",
    actorIds: ["npc_thief"],
    targetIds: ["npc_merchant"],
    timeWindow: { startTick: 10, endTick: 10 },
    direction: "在集市偷面包。",
    stakes: 0.5,
    branches: { onSuccess: "得手", onFailure: "被看见" },
    createdBy: "action-dm",
  });
  assert.equal(plan.state, "scheduled");
  assert.equal(validatePlan(w, plan).ok, true);
});

test("计划状态机不允许跳步", () => {
  const w = world();
  const plan = createPlan(w, {
    source: "ambient",
    type: "fog",
    placeId: "market",
    roomId: "market_square",
    timeWindow: { startTick: 10, endTick: 11 },
    direction: "河面起雾。",
    stakes: 0.2,
    branches: { onSuccess: "雾大", onFailure: "雾散" },
    createdBy: "rule",
  });
  assert.equal(canTransition("scheduled", "resolved"), false);
  assert.throws(() => transitionPlan(w, plan.id, "resolved", "skip"), /非法计划状态/);
  assert.equal(canTransition("scheduled", "pending"), true);
});

test("EventProposal 的未知地点/结果断言会被拒绝", () => {
  const w = world();
  const badPlace: EventProposal = {
    id: "proposal_bad_place",
    type: "fog",
    placeId: "market",
    roomId: "room_not_exist",
    actorIds: [],
    targetIds: [],
    timeWindow: { startTick: 10, endTick: 11 },
    direction: "河面起雾。",
    stakes: 0.2,
    preconditions: [],
    branches: { onSuccess: "雾大", onFailure: "雾散" },
    visibility: "place",
    reason: "test",
    confidence: 0.5,
  };
  assert.equal(validateProposal(w, badPlace).ok, false);
  const badResult = { ...badPlace, roomId: "market_square", direction: "他成功偷了面包。" };
  assert.equal(validateProposal(w, badResult).ok, false);
});

test("ambient 计划不能带主动 actor", () => {
  const w = world();
  const plan = createPlan(w, {
    source: "ambient",
    type: "fog",
    placeId: "market",
    roomId: "market_square",
    actorIds: ["npc_thief"],
    timeWindow: { startTick: 10, endTick: 11 },
    direction: "河面起雾。",
    stakes: 0.2,
    branches: { onSuccess: "雾大", onFailure: "雾散" },
    createdBy: "rule",
  });
  assert.equal(plan.state, "aborted");
});

test("预算默认值符合 CM-5/WB-7 拆分", () => {
  assert.equal(BUDGET_LIMITS.directorPerDay, 8);
  assert.equal(BUDGET_LIMITS.characterPerDay, 22);
  assert.equal(BUDGET_LIMITS.totalPerDay, 30);
});

test("预算消耗会按天/地点记账", () => {
  const w = world();
  const budget = new Budget(w);
  budget.consumeDirector(0);
  budget.consumeHighSalience("market", 0);
  assert.equal(budget.directorUsed(0), 1);
  assert.equal(budget.highSalienceUsed("market", 0), 1);
  assert.equal(budget.canUseDirector(0), true);
  for (let i = 0; i < 7; i++) budget.consumeDirector(0);
  assert.equal(budget.canUseDirector(0), false);
  assert.equal(budget.totals().director, 8);
});
