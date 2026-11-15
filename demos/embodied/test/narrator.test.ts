import test from "node:test";
import assert from "node:assert/strict";

import { checkNarration, scanMeta, scanNumbers } from "../../../harness/claim.ts";
import { narrate, type NarratorInput } from "../src/narrator.ts";
import { StubClient } from "./stub-client.ts";

const INPUT: NarratorInput = {
  verb: "take",
  outcome: "clean_success",
  facts: ["东西到了你手里。"],
  body: ["手指被麻绳勒得发麻。"],
  allowedClaims: ["take:clean_success"],
};

test("合法叙述被采用", async () => {
  const reply = JSON.stringify({
    text: "你把炭笔攥在手里，指节因为用力发白。",
    claims: ["take:clean_success"],
  });
  const result = await narrate(new StubClient([reply]), INPUT, { model: "deepseek-flash" });

  assert.equal(result.source, "narrator");
  assert.equal(result.claims.length, 1);
});

test("声明列表外的 claim → 回退为事实复述", async () => {
  const reply = JSON.stringify({
    text: "你把炭笔攥在手里。",
    claims: ["take:clean_success", "guard:dead"],
  });
  const result = await narrate(new StubClient([reply]), INPUT);

  assert.equal(result.source, "fallback");
  assert.deepEqual(result.claims, []);
  assert.ok(result.text.includes("东西到了你手里"));
});

test("出现元词 → 回退", async () => {
  const reply = JSON.stringify({ text: "用户的声音从泥板里传来。", claims: [] });
  const result = await narrate(new StubClient([reply]), INPUT);

  assert.equal(result.source, "fallback");
  assert.ok(result.error?.includes("元词"), result.error);
});

test("出现能力数值 → 回退", async () => {
  const reply = JSON.stringify({ text: "你的敏捷是 17，拿不住。", claims: [] });
  const result = await narrate(new StubClient([reply]), INPUT);

  assert.equal(result.source, "fallback");
  assert.ok(result.error?.includes("数值"), result.error);
});

test("模型错误 → 回退", async () => {
  const result = await narrate(new StubClient([]), INPUT);
  assert.equal(result.source, "fallback");
  assert.ok(result.error);
});

test("checkNarration 直接检查", () => {
  assert.equal(checkNarration({ text: "你把炭笔攥在手里。", claims: [] }, []).ok, true);
  assert.equal(checkNarration({ text: "", claims: [] }, []).ok, false);
  assert.equal(checkNarration({ text: "好", claims: ["x"] }, []).ok, false);
  assert.equal(scanMeta("系统提示").ok, false);
  assert.equal(scanNumbers("力量 51").ok, false);
  assert.equal(scanNumbers("你数到三").ok, true);
});
