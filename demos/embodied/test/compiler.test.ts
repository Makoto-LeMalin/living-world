import test from "node:test";
import assert from "node:assert/strict";

import type { ChatRequest } from "../../../llm/types.ts";
import { CompilerSession, validateCompilerOutput } from "../src/compiler.ts";
import { runCompilerValidation } from "../src/compiler-run.ts";
import { StubClient } from "./stub-client.ts";

const VALID = {
  label: "用牙叼起炭笔",
  family: "manual",
  dims: { grasp: 0.4, precision: 0.3 },
  assist: { sight: 0.2 },
  durationTicks: 1,
  noise: 0.1,
  confidence: 0.8,
  notes: "用嘴代替手",
};

function reply(request: ChatRequest): string {
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
      assist: {},
      durationTicks: 1,
      noise: 0,
      confidence: 0.7,
    });
  }
  const aware = "character" in payload;
  return JSON.stringify({
    verdict: "action",
    ...VALID,
    dims: { grasp: aware ? 0.2 : 0.6, precision: 0.4 },
    confidence: 0.8,
  });
}

test("合法编译器输出被接受", () => {
  const result = validateCompilerOutput(VALID);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.output.family, "manual");
    assert.equal(result.output.dims.grasp, 0.4);
  }
});

test("本体依赖动作编译为 tags-only demand，而不是拒绝", () => {
  const result = validateCompilerOutput({
    verdict: "action",
    label: "用意念把门打开",
    ontologyTags: ["psychic"],
    dims: {},
    assist: {},
    durationTicks: 1,
    noise: 0,
    confidence: 0.7,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.output.ontologyTags, ["psychic"]);
    assert.equal(result.output.family, undefined);
  }
});

test("未知维度被拒", () => {
  const result = validateCompilerOutput({ ...VALID, dims: { telekinesis: 0.5 } });
  assert.equal(result.ok, false);
});

test("多通道需求可接受，family 由需求推导", () => {
  const result = validateCompilerOutput({
    ...VALID,
    dims: { mobility: 0.4, voice: 0.5 },
    assist: { sight: 0.2 },
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.output.family, "vocal");
});

test("强度越界被拒", () => {
  const result = validateCompilerOutput({ ...VALID, dims: { grasp: 1.5 } });
  assert.equal(result.ok, false);
});

test("空需求被拒", () => {
  const result = validateCompilerOutput({ ...VALID, dims: {}, assist: {} });
  assert.equal(result.ok, false);
});

test("输出带判定字段被拒", () => {
  const result = validateCompilerOutput({ ...VALID, outcome: "success" });
  assert.equal(result.ok, false);
});

test("CompilerSession 返回合法 demand", async () => {
  const session = new CompilerSession(new StubClient([JSON.stringify(VALID)]));
  const result = await session.compile({
    id: "t1",
    description: "用牙叼起炭笔",
    arm: "blind",
  });
  assert.equal(result.ok, true);
  assert.equal(result.output?.family, "manual");
});

test("verdict=reject 不再被接受", () => {
  const result = validateCompilerOutput({ ...VALID, verdict: "reject" });
  assert.equal(result.ok, false);
});

test("dims 与 assist 重叠被拒", () => {
  const result = validateCompilerOutput({
    ...VALID,
    dims: { grasp: 0.4 },
    assist: { grasp: 0.2 },
  });
  assert.equal(result.ok, false);
});

test("本体标签归一化为小写并去重检查", () => {
  const result = validateCompilerOutput({
    ...VALID,
    dims: {},
    assist: {},
    ontologyTags: ["Psychic"],
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.output.ontologyTags, ["psychic"]);

  const duplicate = validateCompilerOutput({
    ...VALID,
    dims: {},
    assist: {},
    ontologyTags: ["psychic", "Psychic"],
  });
  assert.equal(duplicate.ok, false);
});

test("非法本体标签被拒", () => {
  const result = validateCompilerOutput({
    ...VALID,
    dims: {},
    assist: {},
    ontologyTags: ["not a tag"],
  });
  assert.equal(result.ok, false);
});

test("schema 坏输入批量被拒", () => {
  const bad: unknown[] = [
    null,
    [],
    { ...VALID, dims: { grasp: "0.4" } },
    { ...VALID, dims: { grasp: Number.NaN } },
    { ...VALID, dims: { grasp: -0.1 } },
    { ...VALID, dims: { grasp: 1.01 } },
    { ...VALID, dims: { grasp: 0 }, assist: {} },
    { ...VALID, assist: "sight" },
    { ...VALID, label: "" },
    { ...VALID, label: 42 },
    { ...VALID, durationTicks: 0 },
    { ...VALID, durationTicks: 31 },
    { ...VALID, durationTicks: 1.5 },
    { ...VALID, noise: -0.01 },
    { ...VALID, noise: 1.01 },
    { ...VALID, confidence: Number.POSITIVE_INFINITY },
    { ...VALID, notes: 1 },
    { ...VALID, intentTags: ["a", "a"] },
    { ...VALID, ontologyTags: ["psychic", "psychic"] },
    { ...VALID, ontologyTags: ["UPPER", "bad tag"] },
    { ...VALID, ontologyTags: ["a", "b", "c", "d", "e", "f", "g"] },
    { ...VALID, capability: 80 },
    { ...VALID, difficulty: 50 },
    { ...VALID, feasible: true },
  ];
  for (const input of bad) {
    assert.equal(validateCompilerOutput(input).ok, false, JSON.stringify(input));
  }
});

test("100 条动作 × 两臂可跑，aware 需求更低", async () => {
  const report = await runCompilerValidation({ client: new StubClient(reply) });

  assert.equal(report.arms.length, 2);
  assert.equal(report.rows.length, 200);
  assert.equal(report.arms[0].validRate, 1);
  assert.equal(report.arms[1].validRate, 1);
  assert.equal(report.arms[0].worldDiff, 6);
  assert.ok(report.drift.compared >= 90);
  assert.ok(report.drift.meanDelta < 0);
  assert.equal(report.failures.length, 0, report.failures.join("\n"));
});
