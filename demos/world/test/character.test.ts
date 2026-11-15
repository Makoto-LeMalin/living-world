import test from "node:test";
import assert from "node:assert/strict";

import { CassetteClient } from "../../../llm/cassette.ts";
import type { ChatClient, ChatRequest } from "../../../llm/types.ts";
import { buildWorld, defaultConfig, loadCanon } from "../src/world/canon.ts";
import { World } from "../src/world/world.ts";
import { runSimulation } from "../src/sim.ts";
import { NpcRuntime } from "../src/agents/runtime.ts";
import { ScriptedPcRuntime } from "../src/agents/character.ts";
import { CrowdRuntime, individualizeCrowd, mergeCrowdMember } from "../src/agents/crowd.ts";
import { forceTier } from "../src/agents/tiers.ts";
import { Budget, BUDGET_LIMITS } from "../src/rules/budget.ts";
import { focusDialogue } from "../src/agents/dialogue.ts";
import {
  checkBudgetStressAsync,
  checkCm1,
  checkCm6,
  checkCm7,
  checkCm8,
  maxTierCoverage,
} from "../src/b3-checks.ts";
import { runB3Full } from "../src/b3-full.ts";
import { B3_FULL_CASSETTE_DIR } from "../src/b3-run.ts";

function stubClient(): ChatClient {
  return {
    async chat(request: ChatRequest) {
      const system = request.messages[0].content;
      const user = JSON.parse(request.messages[request.messages.length - 1].content) as {
        allowedTypes?: string[];
        placeId?: string;
        roomId?: string;
        time?: { tick: number };
        allowedClaims?: string[];
      };
      if (system.includes("WorldDirector")) {
        const type = (user.allowedTypes ?? ["structural"])[0];
        return {
          content: JSON.stringify({
            proposals: [
              {
                type,
                placeId: user.placeId,
                roomId: user.roomId,
                actorIds: [],
                targetIds: [],
                timeWindow: { startTick: user.time?.tick ?? 0, endTick: (user.time?.tick ?? 0) + 1 },
                direction: "环境继续施压，结构出现新的细响。",
                stakes: 0.4,
                preconditions: [],
                branches: { onSuccess: "压力继续累积。", onFailure: "暂时恢复。" },
                visibility: "place",
                reason: "stub",
                confidence: 0.6,
              },
            ],
          }),
          model: "stub",
        };
      }
      const claims = (user.allowedClaims ?? []).slice(0, 1);
      return {
        content: JSON.stringify({
          speech: claims.length > 0 ? `我记得${claims[0]}。` : "我不知道。",
          claims,
          tone: "calm",
        }),
        model: "stub",
      };
    },
  };
}

test("CM-1：PC、NPC、群体走同一组 contract", () => {
  const result = checkCm1();
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.pc.kind, "pc");
  assert.equal(result.npc.kind, "npc");
  assert.equal(result.crowd.kind, "crowd");
  assert.deepEqual(result.pc.checks, result.npc.checks);
});

test("CM-6：20 次降级→晋升保留身份/关系/关键记忆", () => {
  const result = checkCm6();
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.identityStable, 40);
  assert.equal(result.relationshipsStable, 40);
  assert.equal(result.keyMemoriesRetained, 20);
});

test("CM-7：群体个体化→合并→再观察复用同一身份", () => {
  const result = checkCm7();
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.afterIndividualize, result.initialSize - 1);
  assert.equal(result.afterMerge, result.initialSize);
  assert.equal(result.afterReobserve, result.initialSize - 1);
  assert.equal(result.sameIdentity, true);
});

test("CM-7：合并回写人数/心情，并保留墓碑记录", () => {
  const world = new World(buildWorld(loadCanon(), defaultConfig("7")));
  const crowd = world.crowd("crowd_market");
  const beforeMood = { ...crowd.mood };
  const member = individualizeCrowd(world, crowd.id, { reason: "unit" });
  member.mood.fear = 0.95;
  const record = mergeCrowdMember(world, crowd.id, member.id);
  assert.equal(crowd.size, crowd.initialSize);
  assert.equal(record.tombstone, true);
  assert.ok(crowd.mood.fear >= beforeMood.fear);
  assert.ok(world.state.individuals.some((entry) => entry.id === member.id && entry.tombstone));
});

test("T0–T3：具名角色覆盖 T0/T1/T2，群体是 T3", () => {
  const result = runSimulation({ seed: "7", days: 3 });
  const coverage = maxTierCoverage(result.world);
  assert.equal(coverage.pass, true, coverage.tiers.join(","));
  assert.ok(coverage.tiers.includes("T3"));
});

test("T3：CrowdRuntime 一次判定作用于群体，不逐个成员", () => {
  const world = new World(buildWorld(loadCanon(), defaultConfig("7")));
  const crowd = world.crowd("crowd_market");
  const runtime = new CrowdRuntime(crowd);
  const intent = runtime.decide(world, { tick: 0, viewLevel: "ambient" });
  assert.ok(intent);
  const result = runtime.act(world, intent, 0);
  assert.equal(result.ok, true);
  assert.equal(crowd.size, crowd.initialSize);
  assert.ok(world.state.eventLog.some((event) => event.type === "CrowdActed"));
});

test("预算：每 tick 最多 K=3 个角色、offstage 0 调用", async () => {
  const world = new World(buildWorld(loadCanon(), defaultConfig("7")));
  const budget = new Budget(world);
  for (let index = 0; index < BUDGET_LIMITS.characterConcurrentPerTick; index++) {
    assert.equal(budget.canUseCharacter(0, "focus"), true);
    budget.consumeCharacter(0, { lod: "focus", npcId: `npc_${index}` });
  }
  assert.equal(budget.canUseCharacter(0, "focus"), false);
  assert.equal(budget.canUseCharacter(0, "offstage"), false);
  assert.throws(() => budget.consumeCharacter(0, { lod: "offstage", npcId: "npc_guard" }), /offstage/);
  const offstage = await focusDialogue(world, "npc_guard", "你好", { client: stubClient() });
  assert.equal(offstage.calls, 0);
  assert.equal(offstage.error?.includes("OFFSTAGE"), true);
});

test("预算耗尽：角色/世界预算满后降级模板，不崩溃", async () => {
  const result = await checkBudgetStressAsync();
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.total, 30);
  assert.equal(result.fallbackCalls, 0);
  assert.ok(result.degradedEvents > 0);
});

test("CM-8：完整 B3 世界没有 hops=0 的未目击泄漏", () => {
  const run = runSimulation({ seed: "7", days: 3 });
  const leaks = checkCm8(run.world);
  assert.equal(leaks.pass, true, JSON.stringify(leaks.leaks.slice(0, 3)));
});

test("B3 完整 3 天：真实调用面、预算、T0–T3、群体都跑通（stub）", async () => {
  const run = await runB3Full({ client: stubClient(), seed: "7", days: 3 });
  assert.deepEqual(run.simulation.errors, []);
  assert.equal(run.simulation.invariants.ok, true, run.simulation.invariants.errors.join("\n"));
  assert.ok(run.directorAttempts > 0);
  assert.ok(run.proposals.length > 0);
  assert.ok((run.simulation.runtime?.dialogueCalls ?? 0) > 0);
  assert.ok((run.simulation.runtime?.crowdActions ?? 0) > 0);
  assert.ok((run.simulation.world.state.metrics.crowdIndividualizations ?? 0) > 0);
  assert.ok((run.simulation.world.state.metrics.crowdMerges ?? 0) > 0);
  assert.equal(run.simulation.runtime?.offstageCharacterCalls, 0);
  const budget = run.simulation.budget;
  assert.ok(budget.maxCharacterDay <= BUDGET_LIMITS.characterPerDay);
  assert.ok(budget.maxDirectorDay <= BUDGET_LIMITS.directorPerDay);
  assert.ok(budget.maxTotalDay <= BUDGET_LIMITS.totalPerDay);
  assert.ok(budget.maxCharacterTick <= BUDGET_LIMITS.characterConcurrentPerTick);
  const coverage = maxTierCoverage(run.simulation.world);
  assert.equal(coverage.pass, true, coverage.tiers.join(","));
});

test("B3 fixture：同 seed + cassette 两次完整运行一致", async () => {
  const client = new CassetteClient(undefined, { mode: "replay", dir: B3_FULL_CASSETTE_DIR });
  const a = await runB3Full({ client, seed: "7", days: 3 });
  const b = await runB3Full({ client, seed: "7", days: 3 });
  assert.equal(a.simulation.world.projectionHash(), b.simulation.world.projectionHash());
  assert.equal(JSON.stringify(a.simulation.world.state.eventLog), JSON.stringify(b.simulation.world.state.eventLog));
  assert.ok(
    (a.simulation.runtime?.dialogues ?? []).every((dialogue) => dialogue.source === "llm" && !dialogue.error),
    "fixture 里不应有 cassette miss / 模板回退",
  );
});

test("Tier 强制接口只用于测试，不绕过身份记录", () => {
  const world = new World(buildWorld(loadCanon(), defaultConfig("7")));
  const merchant = world.character("npc_merchant");
  forceTier(world, merchant.id, "T2", "test");
  assert.ok(merchant.record);
  assert.equal(merchant.detailLevel, "index");
  forceTier(world, merchant.id, "T0", "test");
  assert.equal(merchant.tier, "T0");
  assert.equal(merchant.detailLevel, "full");
});
