import test from "node:test";
import assert from "node:assert/strict";

import { applyWound, capabilities, interoception } from "../src/body.ts";
import { clone, close, loadAkha } from "./helpers.ts";

test("阿岬的能力值符合设计算例", () => {
  const caps = capabilities(loadAkha());

  close(caps.strength, 50.6, 0.6, "strength");
  close(caps.dexterity, 17.4, 0.6, "dexterity");
  close(caps.mobility, 62.6, 0.6, "mobility");
  close(caps.sight, 100, 0.01, "sight");
  close(caps.hearing, 100, 0.01, "hearing");
  close(caps.speech, 61.2, 0.6, "speech");
  close(caps.endurance, 62.6, 0.6, "endurance");
  close(caps.cognition, 65.1, 0.6, "cognition");
});

test("反绑把手部敏捷压到 20 以下", () => {
  const bound = capabilities(loadAkha());

  const freeBody = clone(loadAkha());
  freeBody.statuses = [];
  const free = capabilities(freeBody);

  assert.ok(bound.dexterity < 20, `bound dexterity = ${bound.dexterity}`);
  assert.ok(free.dexterity > 50, `free dexterity = ${free.dexterity}`);
});

test("蒙眼让视觉归零", () => {
  const body = clone(loadAkha());
  body.statuses = ["blindfold"];
  assert.equal(capabilities(body).sight, 0);
});

test("部位缺失会拉低相关能力", () => {
  const base = capabilities(loadAkha());

  const noArm = clone(loadAkha());
  noArm.parts.leftArm.exists = false;
  assert.ok(capabilities(noArm).strength < base.strength);

  const noHand = clone(loadAkha());
  noHand.parts.leftHand.exists = false;
  assert.ok(capabilities(noHand).dexterity < base.dexterity);
});

test("伤势与疼痛单调降低能力", () => {
  const base = capabilities(loadAkha());

  const hurt = clone(loadAkha());
  hurt.parts.leftArm.integrity = 20;
  assert.ok(capabilities(hurt).strength <= base.strength);

  const pained = clone(loadAkha());
  pained.parts.leftArm.pain = 95;
  assert.ok(capabilities(pained).strength <= base.strength);

  const tired = clone(loadAkha());
  tired.fatigue = 95;
  assert.ok(capabilities(tired).endurance <= base.endurance);
});

test("四级伤视为断肢", () => {
  const body = applyWound(clone(loadAkha()), "rightArm", 4);
  assert.equal(body.parts.rightArm.exists, false);
  assert.equal(body.parts.rightArm.function, 0);
  assert.ok(body.parts.rightArm.visibleStates.includes("missing"));
});

test("内感受是定性描述，不含数字", () => {
  const lines = interoception(loadAkha()).join("\n");
  assert.ok(lines.includes("麻"), lines);
  assert.ok(!/\d/.test(lines), lines);
});
