/**
 * v2 判定：约束 → 维度 → 瓶颈分 → 难度 → 概率 → 结果。
 * 与 v0 共用概率/分级/DC 规则，便于 parity 对比。
 */

import {
  ACTION_SPECS,
  baseDifficulty,
  type CheckEnv,
  type Verb,
} from "../actions.ts";
import type { Body } from "../body.ts";
import {
  describeOutcome,
  outcomeOf,
  probability,
  type Outcome,
} from "../check.ts";
import { makeRng } from "../../../../src/kernel/rng.ts";
import { applyConstraints, constraintsFromBody } from "./constraints.ts";
import { deriveDimensions, type Dim, type DimensionSheet } from "./dimensions.ts";
import { scoreDemand, type ActionDemand } from "./demand.ts";
import { V2_PROFILES } from "./profiles.ts";

export interface V2Options {
  body: Body;
  verb: Verb;
  env?: CheckEnv;
  /** 直接指定最终难度；不传则用 baseDifficulty */
  difficulty?: number;
  seed?: string | number;
  checkId?: number;
  /** 覆盖 profile，用于自由动作 */
  demand?: ActionDemand;
}

export interface V2Result {
  verb: Verb;
  feasible: boolean;
  reason?: string;
  C?: number;
  D?: number;
  p?: number;
  u?: number;
  outcome?: Outcome;
  claimIds: string[];
  facts: string[];
  demand: ActionDemand;
  dims: DimensionSheet;
  blocks: string[];
  bottleneck: Dim | null;
  reachLimit: number;
}

export function evaluateV2(options: V2Options): V2Result {
  const spec = ACTION_SPECS[options.verb];
  if (!spec) throw new Error(`未知动词: ${options.verb}`);

  const demand = options.demand ?? V2_PROFILES[options.verb];
  const env = options.env ?? {};
  const baseDims = deriveDimensions(options.body);
  const constraints = constraintsFromBody(options.body);
  const constrained = applyConstraints(baseDims, constraints);

  const blocked = (reason: string): V2Result => ({
    verb: spec.verb,
    feasible: false,
    reason,
    claimIds: [`${spec.verb}:blocked`],
    facts: [reason],
    demand,
    dims: constrained.dims,
    blocks: constrained.blocks,
    bottleneck: null,
    reachLimit: constrained.reachLimit,
  });

  // 0. 失去意识：所有动作，包括 rest/wait
  if (constraints.some((constraint) => constraint.kind === "unconscious")) {
    return blocked("你失去了意识，什么也做不了。");
  }

  // 1. 空间约束：铁链/栏杆
  if (
    Number.isFinite(constrained.reachLimit) &&
    (env.distanceM ?? 0) > constrained.reachLimit &&
    ((demand.dims.mobility ?? 0) > 0 ||
      (demand.dims.reach ?? 0) > 0 ||
      (demand.dims.grasp ?? 0) > 0)
  ) {
    return blocked("脚踝上的短链拉住了你，够不到那里。");
  }

  // 2. 需求维度被硬性 block（或本身为 0）
  for (const [key, required] of Object.entries(demand.dims) as Array<[Dim, number]>) {
    if (required <= 0) continue;
    const reason = constrained.blockedDims.find((item) => item.dim === key)?.reason;
    if (reason) return blocked(reason);
    if (constrained.dims[key] <= 0.01) {
      return blocked(`身体在这个维度上做不到：${key}`);
    }
  }

  // 3. 不需要掷骰的动作
  if (spec.checkWorthy === "never") {
    return {
      verb: spec.verb,
      feasible: true,
      C: 100,
      claimIds: [`${spec.verb}:done`],
      facts: [`你${spec.label}了一会儿。`],
      demand,
      dims: constrained.dims,
      blocks: constrained.blocks,
      bottleneck: null,
      reachLimit: constrained.reachLimit,
    };
  }

  // 4. 瓶颈分
  const score = scoreDemand(constrained.dims, demand);
  if (score.C < 5) {
    return blocked("身体撑不住。");
  }

  // 5. 难度与掷骰
  const D = options.difficulty ?? baseDifficulty(spec, env);
  const p = probability(score.C, D);
  const seed = options.seed ?? "42";
  const checkId = options.checkId ?? 1;
  const u = makeRng(`${seed}:${checkId}`).next();
  const outcome = outcomeOf(p, u);

  return {
    verb: spec.verb,
    feasible: true,
    C: score.C,
    D,
    p,
    u,
    outcome,
    claimIds: [`${spec.verb}:${outcome}`],
    facts: [describeOutcome(spec.verb, outcome)],
    demand,
    dims: constrained.dims,
    blocks: constrained.blocks,
    bottleneck: score.dim,
    reachLimit: constrained.reachLimit,
  };
}
