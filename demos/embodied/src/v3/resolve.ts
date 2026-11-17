/**
 * V3 端到端：编译后的 demand → 世界规则 → 身体约束 → 掷骰。
 *
 * 这一层不引入新规则，只把已有的 v2 约束/瓶颈分/概率接起来，
 * 让"编译器输出"真正产生后果，而不是停在 C 值上。
 *
 * 无硬需求、但有本体标签的 demand（纯意念/时间/月光）：
 * 世界允许时记为 narrative——身体不掷骰，由世界规则接管。
 */

import type { Body } from "../body.ts";
import { outcomeOf, probability, type Outcome } from "../check.ts";
import { makeRng } from "../../../../engine/rng.ts";
import { applyConstraints, constraintsFromBody } from "../v2/constraints.ts";
import { scoreDemand, type ActionDemand } from "../v2/demand.ts";
import { deriveDimensions, type Dim } from "../v2/dimensions.ts";
import { gateDemand, type WorldRules } from "./world.ts";

export type ResolveStatus = "blocked_ontology" | "blocked_body" | "narrative" | "rolled";

export interface ResolveOptions {
  body: Body;
  demand: ActionDemand;
  world: WorldRules;
  /** 自由动作没有动词基表；默认中性难度 50，可用 --dc 做敏感性检查 */
  difficulty?: number;
  seed?: string | number;
  checkId?: number;
}

export interface ResolveResult {
  status: ResolveStatus;
  worldId: string;
  tags: string[];
  feasible: boolean;
  reason?: string;
  C?: number;
  D?: number;
  p?: number;
  u?: number;
  outcome?: Outcome | "narrative";
  bottleneck?: Dim | null;
  blocks: string[];
  claimIds: string[];
  facts: string[];
}

const OUTCOME_TEXT: Record<Outcome, string> = {
  clean_success: "你做到了，动作干净利落。",
  narrow_success: "你勉强做到了，但留下了破绽。",
  lucky_success: "你侥幸做到了，代价不小。",
  near_miss: "你差一点就做到了。",
  hard_fail: "你没做到。",
};

function blocked(
  status: "blocked_ontology" | "blocked_body",
  options: ResolveOptions,
  reason: string,
  extra: { tags: string[]; blocks?: string[] },
): ResolveResult {
  return {
    status,
    worldId: options.world.id,
    tags: extra.tags,
    feasible: false,
    reason,
    blocks: extra.blocks ?? [],
    claimIds: ["action:blocked"],
    facts: [reason],
  };
}

export function resolveAction(options: ResolveOptions): ResolveResult {
  const demand = options.demand;
  const gate = gateDemand(demand, options.world);
  if (!gate.allowed) {
    return blocked("blocked_ontology", options, gate.reason ?? "世界规则不允许这个动作。", {
      tags: gate.tags,
    });
  }

  const constraints = constraintsFromBody(options.body);
  const constrained = applyConstraints(deriveDimensions(options.body), constraints);

  if (constraints.some((constraint) => constraint.kind === "unconscious")) {
    return blocked("blocked_body", options, "你失去了意识，什么也做不了。", {
      tags: gate.tags,
      blocks: constrained.blocks,
    });
  }

  const hardDims = (Object.entries(demand.dims) as Array<[Dim, number]>).filter(
    ([, value]) => value > 0,
  );

  // 纯本体动作：世界已放行，身体不掷骰；narrative 不是"成功"，只是交给世界规则。
  if (hardDims.length === 0) {
    return {
      status: "narrative",
      worldId: options.world.id,
      tags: gate.tags,
      feasible: true,
      outcome: "narrative",
      blocks: constrained.blocks,
      claimIds: ["action:narrative"],
      facts: ["这个动作没有身体判定；结果由世界规则决定。"],
    };
  }

  for (const [dim] of hardDims) {
    const reason = constrained.blockedDims.find((item) => item.dim === dim)?.reason;
    if (reason) {
      return blocked("blocked_body", options, reason, {
        tags: gate.tags,
        blocks: constrained.blocks,
      });
    }
    if (constrained.dims[dim] <= 0.01) {
      return blocked("blocked_body", options, `身体在这个维度上做不到：${dim}`, {
        tags: gate.tags,
        blocks: constrained.blocks,
      });
    }
  }

  const score = scoreDemand(constrained.dims, demand);
  if (score.C < 5) {
    return blocked("blocked_body", options, "身体撑不住。", {
      tags: gate.tags,
      blocks: constrained.blocks,
    });
  }

  const D = options.difficulty ?? 50;
  const p = probability(score.C, D);
  const seed = options.seed ?? "42";
  const checkId = options.checkId ?? 1;
  const u = makeRng(`${seed}:${checkId}`).next();
  const outcome = outcomeOf(p, u);

  return {
    status: "rolled",
    worldId: options.world.id,
    tags: gate.tags,
    feasible: true,
    C: score.C,
    D,
    p,
    u,
    outcome,
    bottleneck: score.dim,
    blocks: constrained.blocks,
    claimIds: [`action:${outcome}`],
    facts: [OUTCOME_TEXT[outcome]],
  };
}
