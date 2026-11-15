/**
 * v2 动作需求：自由意图编译后的 14 维需求。
 * 判定用瓶颈分（最弱环节），不是加权平均。
 *
 * family 不是让 LLM 选的分类，而是从需求向量**推导**出来的机械标签：
 * 社交/攻击/防御属于 intentTags，不属于物理通道。
 */

import type { Dim, DimensionSheet } from "./dimensions.ts";

export type Family =
  | "manual"
  | "locomotion"
  | "perception"
  | "vocal"
  | "impact";

export interface ActionDemand {
  /** 自由文本，给日志/叙述；不参与判定 */
  label: string;
  /** 机械标签；由 classifyDemand 推导，调用方不必填 */
  family?: Family;
  /** 硬需求：缺了就不行，0..1 */
  dims: Partial<Record<Dim, number>>;
  /** 辅助需求：缺了会打折，但不会直接 block，0..1 */
  assist?: Partial<Record<Dim, number>>;
  /**
   * 本体依赖：psychic / temporal / divine / metaphysical ...
   * 编译器不判断它是否成立，由世界规则决定。
   */
  ontologyTags?: string[];
  durationTicks: number;
  noise: number;
  tags?: string[];
}

export interface Bottleneck {
  C: number;
  /** 最紧的硬需求维度；没有要求时为 null */
  dim: Dim | null;
  ratios: Partial<Record<Dim, number>>;
  assistFactor: number;
}

/** 从硬需求向量推导机械族；没有物理需求时返回 undefined。 */
export function classifyDemand(demand: ActionDemand): Family | undefined {
  const dims = demand.dims;
  const max = Math.max(
    dims.voice ?? 0,
    dims.sight ?? 0,
    dims.hearing ?? 0,
    dims.smell ?? 0,
    dims.touch ?? 0,
    dims.mobility ?? 0,
    dims.balance ?? 0,
    dims.force ?? 0,
    dims.grasp ?? 0,
    dims.precision ?? 0,
    dims.reach ?? 0,
  );
  if (max <= 0) return undefined;

  if ((dims.mobility ?? 0) === max || (dims.balance ?? 0) === max) return "locomotion";
  if ((dims.voice ?? 0) === max) return "vocal";
  if (
    (dims.sight ?? 0) === max ||
    (dims.hearing ?? 0) === max ||
    (dims.smell ?? 0) === max ||
    (dims.touch ?? 0) === max
  ) {
    return "perception";
  }
  if (
    (dims.force ?? 0) === max &&
    (dims.force ?? 0) >= 0.45 &&
    (dims.grasp ?? 0) < 0.4
  ) {
    return "impact";
  }
  return "manual";
}

/** C = 100 × min(硬需求比) × (0.5 + 0.5×min(辅助比))。 */
export function scoreDemand(dims: DimensionSheet, demand: ActionDemand): Bottleneck {
  const ratios: Partial<Record<Dim, number>> = {};
  let minRatio = Infinity;
  let bottleneck: Dim | null = null;

  for (const [key, required] of Object.entries(demand.dims) as Array<[Dim, number]>) {
    if (required <= 0) continue;
    const ratio = dims[key] / (required * 100);
    ratios[key] = ratio;
    if (ratio < minRatio) {
      minRatio = ratio;
      bottleneck = key;
    }
  }

  const hard = bottleneck === null ? 1 : Math.min(1, Math.max(0, minRatio));

  let minAssist = Infinity;
  for (const [key, required] of Object.entries(demand.assist ?? {}) as Array<[Dim, number]>) {
    if (required <= 0) continue;
    const ratio = dims[key] / (required * 100);
    ratios[key] = ratio;
    if (ratio < minAssist) minAssist = ratio;
  }

  const assistFactor =
    minAssist === Infinity ? 1 : 0.5 + 0.5 * Math.min(1, Math.max(0, minAssist));

  return {
    C: Math.min(100, Math.max(0, hard * assistFactor * 100)),
    dim: bottleneck,
    ratios,
    assistFactor,
  };
}
