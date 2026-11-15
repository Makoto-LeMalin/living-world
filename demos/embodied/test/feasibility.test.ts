import test from "node:test";
import assert from "node:assert/strict";

import type { Verb } from "../src/actions.ts";
import { evaluateCheck, type CheckOptions } from "../src/check.ts";
import { clone, loadAkha } from "./helpers.ts";

const run = (body: ReturnType<typeof loadAkha>, verb: Verb, extra: Partial<CheckOptions> = {}) =>
  evaluateCheck({ body, verb, seed: "test", checkId: 1, ...extra });

test("反绑时手动动作不可尝试，理由是世界内的", () => {
  const result = run(loadAkha(), "take");
  assert.equal(result.feasible, false);
  assert.ok(result.reason?.includes("反绑"), result.reason);
  assert.equal(result.probability, undefined);
});

test("反绑时用嘴可以尝试（低概率）", () => {
  const result = run(loadAkha(), "take", { manner: "嘴" });
  assert.equal(result.feasible, true);
  assert.ok((result.capability ?? 0) < 15);
  assert.ok((result.probability ?? 0) < 0.1);
});

test("解开双手后 take 可尝试", () => {
  const body = clone(loadAkha());
  body.statuses = [];
  const result = run(body, "take");
  assert.equal(result.feasible, true);
  assert.ok((result.capability ?? 0) > 50);
});

test("蒙眼时 look 不可尝试", () => {
  const body = clone(loadAkha());
  body.statuses = ["blindfold"];
  const result = run(body, "look");
  assert.equal(result.feasible, false);
  assert.ok(result.reason?.includes("蒙住"), result.reason);
});

test("无光时 look 不可尝试", () => {
  const body = clone(loadAkha());
  body.statuses = [];
  const result = run(body, "look", { env: { light: "dark" } });
  assert.equal(result.feasible, false);
});

test("失去意识时所有动作不可尝试", () => {
  const body = clone(loadAkha());
  body.statuses = ["unconscious"];
  for (const verb of ["move", "look", "listen", "speak", "take", "wait"] as Verb[]) {
    const result = run(body, verb);
    assert.equal(result.feasible, false, verb);
  }
});

test("铁链限制移动半径", () => {
  const body = clone(loadAkha());
  body.statuses = ["tether"];

  assert.equal(run(body, "move", { env: { distanceM: 2 } }).feasible, false);
  assert.equal(run(body, "move", { env: { distanceM: 0.5 } }).feasible, true);
});

test("绑腿只能爬", () => {
  const body = clone(loadAkha());
  body.statuses = ["bound_legs"];

  assert.equal(run(body, "move", { manner: "walk" }).feasible, false);
  const crawl = run(body, "move", { manner: "crawl" });
  assert.equal(crawl.feasible, true);
  assert.ok((crawl.capability ?? 0) < 30);
});

test("双手缺失时不能拿取", () => {
  const body = clone(loadAkha());
  body.statuses = [];
  body.parts.leftHand.exists = false;
  body.parts.rightHand.exists = false;
  const result = run(body, "take");
  assert.equal(result.feasible, false);
  assert.ok(result.reason?.includes("手"), result.reason);
});

test("眼睛缺失时不能看", () => {
  const body = clone(loadAkha());
  body.statuses = [];
  body.parts.eyes.exists = false;
  const result = run(body, "look");
  assert.equal(result.feasible, false);
});

test("低语只能对 1m 内的人说", () => {
  const body = clone(loadAkha());
  body.statuses = [];
  assert.equal(run(body, "whisper", { env: { distanceM: 2 } }).feasible, false);
  assert.equal(run(body, "whisper", { env: { distanceM: 0.5 } }).feasible, true);
});

test("完全隔音时听不见", () => {
  const body = clone(loadAkha());
  body.statuses = [];
  const result = run(body, "listen", { env: { soundproof: true } });
  assert.equal(result.feasible, false);
});
