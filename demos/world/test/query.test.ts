import test from "node:test";
import assert from "node:assert/strict";

import { runSimulation } from "../src/sim.ts";
import { ask, chronicle, inspect, metricsSnapshot, forwardChain } from "../src/query.ts";

const result = runSimulation({ seed: "7" });

test("重复问同一个 NPC 得到相同 claims/answer", () => {
  const a = ask(result.world, "npc_guard", "你们抓了谁？");
  const b = ask(result.world, "npc_guard", "你们抓了谁？");
  assert.equal(a.answer, b.answer);
  assert.deepEqual(a.claims, b.claims);
  assert.equal(a.unknown, false);
});

test("没有相关信念的 NPC 只能回答不知道", () => {
  const answer = ask(result.world, "npc_ferryman", "谁偷了面包？");
  assert.equal(answer.unknown, true);
  assert.equal(answer.answer, "我不知道。");
  assert.deepEqual(answer.claims, []);
});

test("inspect 显示信念、来源和情绪，不显示全局真相", () => {
  const view = inspect(result.world, "npc_guard");
  assert.equal(view.id, "npc_guard");
  assert.ok(view.beliefs.length > 0);
  for (const belief of view.beliefs) {
    assert.ok(belief.sourceEventId.startsWith("e_"));
    assert.ok(belief.confidence >= 0 && belief.confidence <= 1);
  }
  assert.ok(view.mood);
});

test("chronicle 从事件日志生成，按天分组", () => {
  const lines = chronicle(result.world);
  const text = lines.join("\n");
  assert.ok(text.includes("## 第 1 天"));
  assert.ok(text.includes("## 第 3 天"));
  assert.ok(lines.filter((line) => line.startsWith("- ")).length > 30);
});

test("正向链从盗窃根事件能到传闻/调查/拘禁", () => {
  const crime = result.world.state.facts.find((fact) => fact.kind === "crime");
  assert.ok(crime);
  const chain = forwardChain(result.world, crime.sourceEventId);
  const types = new Set(chain.map((event) => event.type));
  assert.ok(types.has("RumorTold"));
  assert.ok(types.has("Investigated"));
  assert.ok(types.has("Jailed"));
});

test("metrics 报告 0 次角色 LLM 调用和预算", () => {
  const metrics = metricsSnapshot(result.world) as {
    llmCalls: number;
    calls: { character: number; director: number; total: number };
  };
  assert.equal(metrics.llmCalls, 0);
  assert.equal(metrics.calls.character, 0);
  assert.ok(metrics.calls.total <= 30);
});
