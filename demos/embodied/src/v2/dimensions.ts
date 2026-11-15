/**
 * v2 物理维度（14）。只依赖身体，不知道动作。
 * 与 v0 的 8 项能力并存：v2 是"开放动作"的内核，v0 是当前基线。
 */

import {
  PART_IDS,
  capabilities,
  partPerformance,
  vital,
  type Body,
} from "../body.ts";

export const DIMS = [
  "reach",
  "grasp",
  "precision",
  "force",
  "mobility",
  "balance",
  "breath",
  "voice",
  "sight",
  "hearing",
  "smell",
  "touch",
  "cognition",
  "endurance",
] as const;

export type Dim = (typeof DIMS)[number];
export type DimensionSheet = Record<Dim, number>;

const clamp = (x: number): number => Math.max(0, Math.min(100, x));

/** 从部位与全局状态推导 14 维能力，0–100。 */
export function deriveDimensions(body: Body): DimensionSheet {
  const p = {} as Record<(typeof PART_IDS)[number], number>;
  for (const id of PART_IDS) p[id] = partPerformance(body.parts[id]);

  const v = vital(body);
  const caps = capabilities(body);

  return {
    reach: clamp(100 * v * (0.4 * p.leftArm + 0.4 * p.rightArm + 0.1 * p.leftHand + 0.1 * p.rightHand)),
    grasp: clamp(100 * v * (0.35 * p.leftHand + 0.35 * p.rightHand + 0.15 * p.leftArm + 0.15 * p.rightArm)),
    precision: clamp(
      100 *
        v *
        (0.4 * p.leftHand + 0.4 * p.rightHand + 0.1 * p.leftArm + 0.1 * p.rightArm) *
        (0.5 + 0.5 * p.eyes),
    ),
    force: clamp(
      100 * v * (0.3 * p.leftArm + 0.3 * p.rightArm + 0.2 * p.torso + 0.1 * p.leftLeg + 0.1 * p.rightLeg),
    ),
    mobility: clamp(100 * v * (0.35 * p.leftLeg + 0.35 * p.rightLeg + 0.15 * p.torso + 0.15 * p.head)),
    balance: clamp(100 * v * (0.3 * p.leftLeg + 0.3 * p.rightLeg + 0.2 * p.torso + 0.2 * p.head)),
    breath: clamp(100 * v * (0.7 * p.torso + 0.3 * p.head)),
    voice: clamp(100 * v * (0.65 * p.mouth + 0.35 * p.head)),
    sight: clamp(100 * p.eyes),
    hearing: clamp(100 * p.ears),
    smell: clamp(100 * v * (0.6 * p.head + 0.4 * p.mouth)),
    touch: clamp(
      100 * v * (0.4 * p.leftHand + 0.4 * p.rightHand + 0.1 * p.torso + 0.1 * p.head),
    ),
    cognition: caps.cognition,
    endurance: caps.endurance,
  };
}
