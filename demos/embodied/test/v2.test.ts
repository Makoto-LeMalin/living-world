import test from "node:test";
import assert from "node:assert/strict";

import { buildVariants } from "../src/parity.ts";
import { evaluateV2 } from "../src/v2/check.ts";
import { applyConstraints, constraintsFromBody } from "../src/v2/constraints.ts";
import { scoreDemand } from "../src/v2/demand.ts";
import { deriveDimensions } from "../src/v2/dimensions.ts";
import { V2_PROFILES } from "../src/v2/profiles.ts";
import { close } from "./helpers.ts";

const variants = buildVariants();
const body = (id: string) => {
  const variant = variants.find((item) => item.id === id);
  assert.ok(variant, `missing variant ${id}`);
  return variant.body;
};

test("健康身体的 14 维均为 100", () => {
  const dims = deriveDimensions(body("healthy"));
  for (const [key, value] of Object.entries(dims)) {
    assert.ok(Math.abs(value - 100) < 0.01, `${key}=${value}`);
  }
});

test("反绑时 take 被约束 block", () => {
  const result = evaluateV2({ body: body("akha"), verb: "take" });
  assert.equal(result.feasible, false);
  assert.ok(result.reason?.includes("反绑"), result.reason);
  assert.ok(result.blocks.length > 0);
});

test("松绑后 take 的 C 与 v0 基线对齐", () => {
  const result = evaluateV2({ body: body("free"), verb: "take", difficulty: 45 });
  assert.equal(result.feasible, true);
  close(result.C ?? 0, 63.3, 0.5, "take C");
});

test("蒙眼：look 不可尝试，take 可尝试但 C 降低", () => {
  const blind = body("blindfold");
  const look = evaluateV2({ body: blind, verb: "look" });
  assert.equal(look.feasible, false);

  const take = evaluateV2({ body: blind, verb: "take", difficulty: 45 });
  const freeTake = evaluateV2({ body: body("free"), verb: "take", difficulty: 45 });
  assert.equal(take.feasible, true);
  assert.ok((take.C ?? 0) < (freeTake.C ?? 0));
});

test("铁链限制移动：2m 不可尝试", () => {
  const result = evaluateV2({
    body: body("akha"),
    verb: "move",
    env: { distanceM: 2 },
  });
  assert.equal(result.feasible, false);
  assert.ok(result.reason?.includes("短链"), result.reason);
});

test("失去意识时连 rest 也不可尝试", () => {
  const result = evaluateV2({ body: body("unconscious"), verb: "rest" });
  assert.equal(result.feasible, false);
});

test("辅助维度只打折、不直接 block", () => {
  const blind = body("blindfold");
  const constrained = applyConstraints(deriveDimensions(blind), constraintsFromBody(blind));
  const score = scoreDemand(constrained.dims, V2_PROFILES.take);
  assert.ok(score.C > 0);
  assert.ok(score.assistFactor < 1);
});
