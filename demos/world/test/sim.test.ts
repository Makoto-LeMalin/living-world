import test from "node:test";
import assert from "node:assert/strict";

import { runSimulation } from "../src/sim.ts";
import { forwardChain } from "../src/query.ts";

const result = runSimulation({ seed: "7", days: 3 });

test("三天仿真无运行时错误，计划全部终止", () => {
  assert.deepEqual(result.errors, []);
  assert.equal(result.invariants.ok, true, result.invariants.errors.join("\n"));
  assert.equal(result.plansTerminal, true);
  assert.ok(result.world.state.metrics.events > 100);
});

test("盗窃在 seed 7 成功，并产生完整执法链", () => {
  assert.ok(result.theft);
  assert.equal(result.theft?.success, true);
  const types = new Set(result.theftChain.map((id) => result.world.state.eventLog.find((event) => event.id === id)?.type));
  for (const expected of ["TheftAttempt", "TheftSucceeded", "Witnessed", "RumorTold", "Investigated", "WitnessStatement", "Accused", "Jailed"]) {
    assert.ok(types.has(expected), `缺少 ${expected}: ${[...types].join(",")}`);
  }
  const beggar = result.world.state.characters.find((character) => character.id === "npc_beggar");
  assert.equal(beggar?.jailed, true);
  assert.equal(beggar?.currentRoomId, "jail");
});

test("火灾链有起火、蔓延/控制、损伤、价格/人群", () => {
  assert.ok(result.fireEventId);
  const events = forwardChain(result.world, result.fireEventId as string);
  const types = new Set(events.map((event) => event.type));
  for (const expected of ["FireStarted", "FireDamaged", "FireCrowd"]) {
    assert.ok(types.has(expected), `缺少 ${expected}: ${[...types].join(",")}`);
  }
  assert.ok(types.has("FireSpread") || types.has("FireContained"));
  const damage = result.world.state.facts.find((fact) => fact.kind === "fire" && typeof fact.detail.grainLoss === "number");
  assert.ok(damage);
});

test("日程遵循 ≥95%，且被拘禁算 excused、移动算 transit", () => {
  assert.ok(result.schedule.ratio >= 0.95, `ratio=${result.schedule.ratio}`);
  assert.ok(result.schedule.npcTicks > 4000);
  assert.ok(result.schedule.transit > 0);
  assert.ok(result.schedule.excused > 0);
  assert.ok(result.schedule.violations <= 1);
});

test("没有负资源/负需求/非法房间", () => {
  for (const character of result.world.state.characters) {
    assert.ok(character.coins >= 0, `${character.id} coins`);
    for (const [key, value] of Object.entries(character.needs)) {
      assert.ok(value >= 0 && Number.isFinite(value), `${character.id}.${key}=${value}`);
    }
    assert.ok(result.world.state.rooms.some((room) => room.id === character.currentRoomId));
  }
  for (const stock of Object.values(result.world.state.stocks)) {
    for (const amount of Object.values(stock)) assert.ok((amount ?? 0) >= 0);
  }
});

test("三源事件都存在，且每个 gameplay 事件有 provenance", () => {
  assert.ok(result.eventsBySource.ambient > 0);
  assert.ok(result.eventsBySource.actor > 0);
  assert.ok(result.eventsBySource.special > 0);
  for (const event of result.world.state.eventLog) {
    assert.ok(event.provenance?.source, `${event.id} 缺少 source`);
    assert.ok(event.provenance.ruleVersion, `${event.id} 缺少 ruleVersion`);
  }
  assert.ok(result.world.state.plans.some((plan) => plan.createdBy === "world-director"));
  assert.ok(result.world.state.plans.some((plan) => plan.createdBy === "action-dm"));
  assert.ok(result.world.state.plans.some((plan) => plan.createdBy === "canon"));
});

test("离开/返回：stable/changed/added/removed 都有来源，且回响含 distorted/confirmed", () => {
  const diff = result.returnDiff;
  assert.ok(diff);
  assert.ok(diff.stableIds.some((id) => id.startsWith("lm_")));
  assert.ok(diff.changed.length > 0);
  for (const change of diff.changed) {
    assert.ok(change.eventIds.length > 0, `${change.id} 没有 eventIds`);
  }
  assert.ok(diff.echoes.some((echo) => echo.verdict === "distorted"));
  assert.ok(diff.echoes.some((echo) => echo.verdict === "confirmed"));
  const echo = diff.echoes.find((candidate) => candidate.verdict === "distorted");
  assert.ok(echo?.belief.suspectId === "npc_beggar");
});

test("PC 在 B 听到 A 的传闻，且传闻跳数 ≤5", () => {
  const pc = result.world.state.pc;
  const crime = result.world.state.facts.find((fact) => fact.kind === "crime");
  assert.ok(crime);
  const belief = pc.beliefs.find((candidate) => candidate.factId === crime.id);
  assert.ok(belief);
  assert.ok(belief.hops >= 1 && belief.hops <= 5);
  assert.ok(result.world.state.metrics.maxRumorHops <= 5);
  assert.ok(result.world.state.metrics.travelEncounters > 0);
});

test("D4 问话：孩子/守卫知道，船夫不知道（知识边界）", () => {
  assert.equal(result.queries.ferryman.unknown, true);
  assert.ok(result.queries.child.answer.includes("船夫") || result.queries.child.claims.length > 0);
  assert.ok(result.queries.guard.answer.includes("乞丐") || result.queries.guard.claims.length > 0);
  assert.ok(result.queries.merchant.claims.length > 0);
});

test("预算：角色调用为 0，WorldDirector ≤8/日，总 ≤30", () => {
  assert.equal(result.world.state.metrics.llmCalls, 0);
  assert.ok(result.budget.maxDirectorDay <= 8, `maxDirectorDay=${result.budget.maxDirectorDay}`);
  assert.ok(result.budget.total <= 30, `total=${result.budget.total}`);
  assert.equal(result.budget.character, 0);
});

test("非脚本事件 ≥5，且没有负时间/自引用", () => {
  const nonScripted = result.world.state.eventLog.filter(
    (event) => event.provenance.source !== "system" && event.provenance.injected !== true,
  );
  assert.ok(nonScripted.length >= 5, `nonScripted=${nonScripted.length}`);
  for (const event of result.world.state.eventLog) {
    assert.ok(event.tick >= 0);
    assert.ok(!event.sourceEventIds.includes(event.id));
  }
});

test("返回差分不包含低 salience 的关系噪声", () => {
  for (const change of result.returnDiff?.changed ?? []) {
    const fact = result.world.state.facts.find((candidate) => candidate.id === change.id);
    if (fact) assert.notEqual(fact.kind, "relationship");
  }
});
