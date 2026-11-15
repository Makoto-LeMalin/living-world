import test from "node:test";
import assert from "node:assert/strict";

import type { Verb } from "../src/actions.ts";
import { evaluateCheck, outcomeOf, probability } from "../src/check.ts";
import { clone, close, loadAkha } from "./helpers.ts";

test("概率曲线与设计表一致", () => {
  close(probability(50, 50), 0.5, 0.0001);
  close(probability(74, 50), 0.881, 0.005);
  close(probability(62, 50), 0.731, 0.005);
  close(probability(26, 50), 0.119, 0.005);
  close(probability(14, 50), 0.047, 0.005);
});

test("结果分级按 margin 划分", () => {
  assert.equal(outcomeOf(0.5, 0.1), "clean_success");
  assert.equal(outcomeOf(0.5, 0.4), "narrow_success");
  assert.equal(outcomeOf(0.5, 0.6), "near_miss");
  assert.equal(outcomeOf(0.5, 0.9), "hard_fail");
  assert.equal(outcomeOf(0.1, 0.05), "lucky_success");
  // 接近必然的成功不写成"勉强"
  assert.equal(outcomeOf(0.95, 0.94), "clean_success");
});

test("同一 seed 与 checkId 可复现", () => {
  const body = clone(loadAkha());
  body.statuses = [];

  const options = {
    body,
    verb: "take" as Verb,
    difficulty: 45,
    seed: "replay",
    checkId: 3,
  };

  const a = evaluateCheck(options);
  const b = evaluateCheck(options);

  assert.equal(a.roll, b.roll);
  assert.equal(a.outcome, b.outcome);
  assert.equal(a.capability, b.capability);
});

test("不同 checkId 掷出不同结果", () => {
  const body = clone(loadAkha());
  body.statuses = [];

  const first = evaluateCheck({ body, verb: "take", difficulty: 45, seed: "x", checkId: 1 });
  const second = evaluateCheck({ body, verb: "take", difficulty: 45, seed: "x", checkId: 2 });

  assert.notEqual(first.roll, second.roll);
});

test("难度越高成功率越低", () => {
  const body = clone(loadAkha());
  body.statuses = [];

  const easy = evaluateCheck({ body, verb: "take", difficulty: 10, seed: "x", checkId: 1 });
  const hard = evaluateCheck({ body, verb: "take", difficulty: 90, seed: "x", checkId: 1 });

  assert.ok((easy.probability ?? 0) > (hard.probability ?? 0));
  assert.equal(easy.capability, hard.capability);
});

test("休息不掷骰", () => {
  const result = evaluateCheck({ body: loadAkha(), verb: "rest" });
  assert.equal(result.feasible, true);
  assert.equal(result.outcome, undefined);
  assert.equal(result.roll, undefined);
  assert.ok(result.facts.length > 0);
});

test("被拒绝时不产生概率", () => {
  const result = evaluateCheck({ body: loadAkha(), verb: "take" });
  assert.equal(result.feasible, false);
  assert.equal(result.probability, undefined);
  assert.equal(result.roll, undefined);
});
