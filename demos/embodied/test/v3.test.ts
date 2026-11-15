import test from "node:test";
import assert from "node:assert/strict";

import type { ChatRequest } from "../../../llm/types.ts";
import type { Body } from "../src/body.ts";
import { loadFixture } from "../src/fixture.ts";
import { deriveIntentExpectation, verifyIntent } from "../src/v3/intent.ts";
import { resolveAction } from "../src/v3/resolve.ts";
import { runV3Validation } from "../src/v3/run.ts";
import {
  DEFAULT_WORLDS,
  gateDemand,
  runWorldMatrix,
  validateWorldRules,
} from "../src/v3/world.ts";
import { StubClient } from "./stub-client.ts";

const PSYCHIC = {
  label: "意念开门",
  dims: {},
  assist: {},
  ontologyTags: ["psychic"],
  durationTicks: 1,
  noise: 0,
};

test("世界矩阵穷举全部标签子集，且单调", () => {
  const matrix = runWorldMatrix(DEFAULT_WORLDS);
  assert.equal(matrix.failures.length, 0, JSON.stringify(matrix.failures.slice(0, 3)));
  assert.equal(matrix.passed, matrix.total);
  assert.ok(matrix.total >= 192);
  assert.equal(matrix.monotonicFailures.length, 0);
  assert.equal(matrix.unknownDenied, true);
  assert.equal(matrix.customAllowed, true);
});

test("世界规则校验拒绝重复标签", () => {
  const result = validateWorldRules({
    id: "bad",
    label: "坏规则",
    allowedTags: ["psychic", "Psychic"],
  });
  assert.equal(result.ok, false);
});

test("世界准入：物理拒绝、秘法允许、未注册标签默认拒绝", () => {
  assert.equal(gateDemand(PSYCHIC, DEFAULT_WORLDS[0]).allowed, false);
  assert.equal(gateDemand(PSYCHIC, DEFAULT_WORLDS[1]).allowed, true);
  assert.equal(gateDemand({ ontologyTags: ["magic"] }, DEFAULT_WORLDS[2]).allowed, false);
  assert.equal(gateDemand({ ontologyTags: [] }, DEFAULT_WORLDS[0]).allowed, true);
});

test("IntentVerifier 覆盖显式通道", () => {
  const check = verifyIntent(
    {
      dims: { grasp: 0.4, reach: 0.3 },
      assist: { sight: 0.2 },
      ontologyTags: [],
    },
    "用牙叼起地上的炭笔",
  );
  assert.equal(check.ok, true);
  assert.deepEqual(check.missingDims, []);
});

test("IntentVerifier 抓漏项", () => {
  const check = verifyIntent(
    { dims: { grasp: 0.4 }, assist: {}, ontologyTags: [] },
    "隔着门大声喊他",
  );
  assert.equal(check.ok, false);
  assert.ok(check.missingDims.includes("voice"));
});

test("IntentVerifier 检查本体标签", () => {
  const ok = verifyIntent(PSYCHIC, "用意念把门打开");
  assert.equal(ok.ok, true);

  const missing = verifyIntent(
    { dims: { grasp: 0.4 }, assist: {}, ontologyTags: [] },
    "用意念把门打开",
  );
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missingTags, ["psychic"]);
});

test("纯本体动作跳过物理通道，但不跳过发声", () => {
  const moon = verifyIntent(
    { dims: {}, assist: {}, ontologyTags: ["metaphysical"] },
    "把月光装进口袋",
  );
  assert.equal(moon.ok, true);
  assert.equal(moon.physicalSkipped, true);

  const words = verifyIntent(
    { dims: {}, assist: {}, ontologyTags: ["metaphysical"] },
    "用一句话让所有人立刻死掉",
  );
  assert.equal(words.ok, false);
  assert.ok(words.missingDims.includes("voice"));
});

test("端到端：物理拒绝本体，秘法记为 narrative", () => {
  const body = loadFixture("akha");
  body.statuses = [];
  const physical = resolveAction({
    body,
    demand: { ...PSYCHIC, durationTicks: 1, noise: 0 },
    world: DEFAULT_WORLDS[0],
  });
  assert.equal(physical.status, "blocked_ontology");

  const arcane = resolveAction({
    body,
    demand: { ...PSYCHIC, durationTicks: 1, noise: 0 },
    world: DEFAULT_WORLDS[1],
  });
  assert.equal(arcane.status, "narrative");
});

test("端到端：约束会阻止硬需求，自由身体可掷骰", () => {
  const free = loadFixture("akha");
  free.statuses = [];
  const bound = loadFixture("akha");

  const demand = {
    label: "抓钥匙",
    dims: { grasp: 0.5 },
    assist: {},
    durationTicks: 1,
    noise: 0,
  };

  const freeResult = resolveAction({ body: free, demand, world: DEFAULT_WORLDS[0], seed: "s", checkId: 1 });
  assert.equal(freeResult.status, "rolled");

  const boundResult = resolveAction({ body: bound, demand, world: DEFAULT_WORLDS[0], seed: "s", checkId: 1 });
  assert.equal(boundResult.status, "blocked_body");

  const again = resolveAction({ body: free, demand, world: DEFAULT_WORLDS[0], seed: "s", checkId: 1 });
  assert.deepEqual(freeResult, again);
});

function stubReply(request: ChatRequest): string {
  const payload = JSON.parse(request.messages[1]?.content ?? "{}") as {
    action?: { description?: string };
    character?: unknown;
  };
  const description = payload.action?.description ?? "";
  const tags = description.includes("时间倒流")
    ? ["temporal"]
    : description.includes("月光") || description.includes("一句话")
      ? ["metaphysical"]
      : ["意念", "眼神", "不碰"].some((word) => description.includes(word))
        ? ["psychic"]
        : [];

  if (tags.length > 0) {
    return JSON.stringify({
      verdict: "action",
      label: description,
      ontologyTags: tags,
      dims: description.includes("一句话") ? { voice: 0.4 } : {},
      assist: description.includes("一句话") ? { cognition: 0.3 } : {},
      durationTicks: 1,
      noise: 0.1,
      confidence: 0.8,
    });
  }

  const expected = deriveIntentExpectation(description);
  const dims: Record<string, number> = {};
  const assist: Record<string, number> = {};
  const chosen = expected.dims.length === 0 ? (["grasp"] as const) : expected.dims;
  chosen.slice(0, 2).forEach((dim) => {
    dims[dim] = payload.character ? 0.2 : 0.5;
  });
  for (const dim of chosen.slice(2)) assist[dim] = 0.2;
  if (!("endurance" in dims) && !("endurance" in assist)) assist.endurance = 0.1;

  return JSON.stringify({
    verdict: "action",
    label: description,
    ontologyTags: [],
    dims,
    assist,
    durationTicks: 1,
    noise: 0.1,
    confidence: 0.8,
  });
}

test("V3 全流程用 stub 跑通，门槛全过", async () => {
  const report = await runV3Validation({
    client: new StubClient(stubReply),
    repeatCompile: true,
  });

  assert.equal(report.actions, 100);
  assert.equal(report.compile.rows.length, 200);
  assert.equal(report.e2e.cases.length, 1500);
  assert.equal(report.intent.failures, 0, JSON.stringify(report.intent.rows.filter((row) => !row.ok).slice(0, 3)));
  assert.equal(report.worlds.failures.length, 0);
  assert.equal(report.e2e.freePhysicalBlocked.length, 6);
  assert.equal(report.e2e.freeArcaneNarrative.length, 5);
  assert.equal(report.e2e.freeBodyBlocked.length, 0);
  assert.equal(report.e2e.monotonicFailures.length, 0);
  assert.equal(report.e2e.determinismPassed, report.e2e.determinismChecked);
  assert.equal(report.stability.stable, true);

  const failed = report.gates.filter((gate) => !gate.pass);
  assert.equal(failed.length, 0, JSON.stringify(failed));
});
