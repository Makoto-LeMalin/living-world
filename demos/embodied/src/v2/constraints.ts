/**
 * v2 约束：状态是数据（锚点 + 效果 + 来源 + 移除条件），不是 switch 分支。
 * 当前只实现 block / scale / limit 三种效果；其余保留在类型里，供后续扩展。
 */

import type { PartId, StatusId, Body } from "../body.ts";
import { DIMS, type Dim, type DimensionSheet } from "./dimensions.ts";

export type Resource = "blood" | "stamina" | "air" | "warmth" | "consciousness";
export type Sense = "sight" | "hearing" | "touch" | "smell";

export type Effect =
  | { op: "block"; dim: Dim }
  | { op: "scale"; dim: Dim; factor: number }
  | { op: "drain"; resource: Resource; rate: number }
  | { op: "impair"; channel: Sense; amount: number }
  | { op: "signal"; tag: string; visibility: "private" | "observable" | "social" }
  | { op: "limit"; range: number }
  | { op: "damage"; part: PartId; severity: 1 | 2 | 3 | 4 };

export interface Constraint {
  id: string;
  kind: "restraint" | "injury" | "sensory" | "exposure" | "intoxication" | "unconscious" | "other";
  anchors: PartId[] | "space" | "whole";
  effects: Effect[];
  /** 世界内描述，给角色/叙述用；规则不看它 */
  description: string;
  /** 可追溯到发生过的事 */
  sourceEventId?: string;
  visibility?: "private" | "observable" | "social";
}

const ALL_DIMS: Dim[] = [...DIMS];

function blockAll(description: string): Effect[] {
  return ALL_DIMS.map((dim) => ({ op: "block" as const, dim }));
}

/**
 * 把 v0 的 statuses 映射成 v2 约束。
 * 这只是迁移期的适配器；v2 的目标是约束由世界事件直接产生。
 */
export function constraintsFromBody(body: Body): Constraint[] {
  const constraints: Constraint[] = [];

  if (body.statuses.includes("unconscious") || body.consciousness < 30) {
    constraints.push({
      id: "c_unconscious",
      kind: "unconscious",
      anchors: "whole",
      effects: blockAll("失去意识"),
      description: "你失去了意识，什么也做不了。",
      visibility: "observable",
    });
    return constraints;
  }

  if (body.statuses.includes("bound_hands")) {
    constraints.push({
      id: "c_bound_hands",
      kind: "restraint",
      anchors: ["leftHand", "rightHand"],
      effects: [
        { op: "block", dim: "grasp" },
        { op: "block", dim: "precision" },
        { op: "scale", dim: "force", factor: 0.2 },
        { op: "signal", tag: "restrained", visibility: "observable" },
      ],
      description: "双手被反绑，手指够不到。",
      visibility: "observable",
    });
  }

  if (body.statuses.includes("blindfold")) {
    constraints.push({
      id: "c_blindfold",
      kind: "sensory",
      anchors: ["eyes"],
      effects: [
        { op: "block", dim: "sight" },
        { op: "signal", tag: "blindfolded", visibility: "observable" },
      ],
      description: "眼睛被蒙住，什么也看不见。",
      visibility: "observable",
    });
  }

  if (body.statuses.includes("tether")) {
    constraints.push({
      id: "c_tether",
      kind: "restraint",
      anchors: "space",
      effects: [{ op: "limit", range: 1 }],
      description: "脚踝上的短链拉住了你。",
      visibility: "observable",
    });
  }

  if (body.statuses.includes("bound_legs")) {
    constraints.push({
      id: "c_bound_legs",
      kind: "restraint",
      anchors: ["leftLeg", "rightLeg"],
      effects: [{ op: "scale", dim: "mobility", factor: 0.2 }],
      description: "脚踝被绑着，站不起来。",
      visibility: "observable",
    });
  }

  return constraints;
}

export interface ConstraintResult {
  dims: DimensionSheet;
  blocks: string[];
  blockedDims: Array<{ dim: Dim; reason: string }>;
  /** 空间可达半径；没有 limit 时为 Infinity */
  reachLimit: number;
  signals: string[];
}

export function applyConstraints(
  dims: DimensionSheet,
  constraints: Constraint[],
): ConstraintResult {
  const out = { ...dims } as DimensionSheet;
  const blocks: string[] = [];
  const blockedDims: Array<{ dim: Dim; reason: string }> = [];
  const signals: string[] = [];
  let reachLimit = Infinity;

  for (const constraint of constraints) {
    for (const effect of constraint.effects) {
      switch (effect.op) {
        case "block":
          out[effect.dim] = 0;
          blocks.push(`${constraint.description}（${effect.dim}）`);
          blockedDims.push({
            dim: effect.dim,
            reason: `${constraint.description}（${effect.dim}）`,
          });
          break;
        case "scale":
          out[effect.dim] *= effect.factor;
          break;
        case "limit":
          reachLimit = Math.min(reachLimit, effect.range);
          break;
        case "signal":
          signals.push(effect.tag);
          break;
        default:
          // drain/impair/damage 在 v2 资源循环里处理；此 spike 不接
          break;
      }
    }
  }

  return { dims: out, blocks, blockedDims, reachLimit, signals };
}
