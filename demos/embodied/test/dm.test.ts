import test from "node:test";
import assert from "node:assert/strict";

import { DmSession, validateDmOutput, type DmInput } from "../src/dm.ts";
import { StubClient } from "./stub-client.ts";

const INPUT: DmInput = {
  intent: { verb: "speak", target: "老石", goal: "让他开门" },
  baseDifficulty: 55,
  category: "medium",
  attemptable: true,
  environment: { place: "牢房门口", light: "昏暗" },
  opposition: { name: "老石", attitude: "敌意" },
  facts: [{ id: "f_blood", text: "老石刚看见地上的血" }],
  allowedConsequences: ["noise_alert", "none"],
};

const VALID = JSON.stringify({
  difficulty: 63,
  factors: [{ kind: "social", value: 8, reason: "刚看见血", factId: "f_blood" }],
  stakes: "high",
  consequenceHint: "noise_alert",
  rationale: "他更怕被上司发现",
});

test("合法 DM 输出被采用", async () => {
  const stub = new StubClient([VALID]);
  const session = new DmSession(stub, { model: "deepseek-flash" });
  const result = await session.propose(INPUT);

  assert.equal(result.source, "dm");
  assert.equal(result.difficulty, 63);
  assert.equal(result.output?.factors[0].factId, "f_blood");
  assert.equal(stub.calls.length, 1);
});

test("偏离基线超过 20 → 回退", async () => {
  const reply = JSON.stringify({
    difficulty: 80,
    factors: [],
    stakes: "medium",
    consequenceHint: "none",
    rationale: "太离谱",
  });
  const session = new DmSession(new StubClient([reply]));
  const result = await session.propose(INPUT);

  assert.equal(result.source, "fallback");
  assert.equal(result.difficulty, INPUT.baseDifficulty);
  assert.ok(result.error?.includes("20"), result.error);
});

test("编造 factId → 回退", async () => {
  const reply = JSON.stringify({
    difficulty: 60,
    factors: [{ kind: "social", value: 5, reason: "编的", factId: "f_fake" }],
    stakes: "medium",
    consequenceHint: "none",
    rationale: "编的",
  });
  const session = new DmSession(new StubClient([reply]));
  const result = await session.propose(INPUT);

  assert.equal(result.source, "fallback");
  assert.ok(result.error?.includes("factId"), result.error);
});

test("输出包含身体/能力字段 → 回退", async () => {
  const reply = JSON.stringify({
    difficulty: 60,
    factors: [],
    stakes: "medium",
    consequenceHint: "none",
    rationale: "想帮忙",
    body: { pain: 60 },
  });
  const session = new DmSession(new StubClient([reply]));
  const result = await session.propose(INPUT);

  assert.equal(result.source, "fallback");
  assert.ok(result.error?.includes("禁止字段"), result.error);
});

test("同一情境走缓存", async () => {
  const stub = new StubClient([VALID]);
  const session = new DmSession(stub);
  await session.propose(INPUT);
  await session.propose(INPUT);
  assert.equal(stub.calls.length, 1);
});

test("绕过缓存会再次调用", async () => {
  const stub = new StubClient([VALID, VALID]);
  const session = new DmSession(stub);
  await session.propose(INPUT);
  await session.propose(INPUT, { bypassCache: true });
  assert.equal(stub.calls.length, 2);
});

test("关闭 DM 不调用模型", async () => {
  const stub = new StubClient([]);
  const session = new DmSession(stub, { enabled: false });
  const result = await session.propose(INPUT);
  assert.equal(result.source, "fallback");
  assert.equal(stub.calls.length, 0);
});

test("validateDmOutput 拒绝 consequence 不在列表", () => {
  const parsed = JSON.parse(VALID) as unknown;
  const result = validateDmOutput(
    { ...(parsed as object), consequenceHint: "exposure" },
    { ...INPUT, allowedConsequences: ["none"] },
  );
  assert.equal(result.ok, false);
});
