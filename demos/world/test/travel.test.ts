import test from "node:test";
import assert from "node:assert/strict";

import { buildWorld, defaultConfig, loadCanon } from "../src/world/canon.ts";
import { World } from "../src/world/world.ts";
import { encounterProbability, routeBetween, tryEncounter } from "../src/rules/travel.ts";
import { runSimulation } from "../src/sim.ts";

function world(): World {
  return new World(buildWorld(loadCanon(), defaultConfig("7")));
}

test("路线双向可识别，未知房间对返回 undefined", () => {
  const w = world();
  assert.equal(routeBetween(w, "market_square", "alley")?.id, "r_market_alley");
  assert.equal(routeBetween(w, "alley", "market_square")?.id, "r_market_alley");
  assert.equal(routeBetween(w, "market_square", "wharf"), undefined);
});

test("遭遇概率在 0..0.9，且受事件压力影响", () => {
  const w = world();
  const route = routeBetween(w, "market_square", "alley");
  assert.ok(route);
  const base = encounterProbability(w, route);
  assert.ok(base > 0 && base <= 0.9);
  w.state.facts.push({
    id: "f_test_fire",
    kind: "fire",
    subjectId: "warehouse",
    placeId: "wharf",
    detail: {},
    status: "active",
    salience: 0.9,
    traceIds: [],
    summary: "test",
    validFromTick: 0,
    sourceEventId: "e_test",
  });
  assert.ok(encounterProbability(w, route) > base);
});

test("强制 encounter 会给 PC 一条带 factId 的传闻", () => {
  const w = world();
  // 先造一个最小的犯罪事实，让遭遇池有东西可绑。
  w.emit({
    type: "TheftSucceeded",
    roomId: "market_square",
    visibility: "room",
    payload: { test: true },
    facts: [
      {
        kind: "crime",
        subjectId: "npc_thief",
        objectId: "npc_merchant",
        placeId: "market",
        detail: { culpritId: "npc_thief", victimId: "npc_merchant", commodity: "bread", amount: 1, success: true },
        salience: 0.8,
        summary: "集市的面包摊少了一块面包。",
      },
    ],
    provenance: { source: "actor", ruleVersion: "test", seed: "7" },
  });
  const route = routeBetween(w, "market_square", "alley");
  assert.ok(route);
  let found = false;
  for (let tick = 0; tick < 100; tick++) {
    const result = tryEncounter(w, w.state.pc.id, "market_square", "alley", tick);
    if (result?.factId) {
      found = true;
      const rumor = w.state.eventLog.find((event) => event.id === result.rumorEventId);
      assert.ok(rumor);
      assert.equal(rumor?.payload.factId, result.factId);
      assert.ok(w.state.pc.beliefs.some((belief) => belief.factId === result.factId));
      break;
    }
  }
  assert.equal(found, true);
});

test("完整仿真中 PC 有路上遭遇，且在 B 听到 A 的传闻", () => {
  const result = runSimulation({ seed: "7" });
  assert.ok(result.world.state.metrics.travelEncounters > 0);
  const pc = result.world.state.pc;
  const crime = result.world.state.facts.find((fact) => fact.kind === "crime");
  assert.ok(crime);
  const belief = pc.beliefs.find((candidate) => candidate.factId === crime.id);
  assert.ok(belief);
  assert.ok(belief.hops <= 5);
});
