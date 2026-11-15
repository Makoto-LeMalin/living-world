/**
 * 身体模型 v0。
 * 见 demos/embodied/DESIGN.md §2–§3。
 *
 * 存在性/功能缺失 → 硬约束（由 check.ts 判断）
 * 性能 → 能力值（本文件）
 */

export const PART_IDS = [
  "head",
  "torso",
  "leftArm",
  "rightArm",
  "leftHand",
  "rightHand",
  "leftLeg",
  "rightLeg",
  "eyes",
  "ears",
  "mouth",
] as const;

export type PartId = (typeof PART_IDS)[number];

export const PART_LABELS: Record<PartId, string> = {
  head: "头",
  torso: "躯干",
  leftArm: "左臂",
  rightArm: "右臂",
  leftHand: "左手",
  rightHand: "右手",
  leftLeg: "左腿",
  rightLeg: "右腿",
  eyes: "眼",
  ears: "耳",
  mouth: "嘴",
};

export const CAPABILITIES = [
  "strength",
  "dexterity",
  "mobility",
  "sight",
  "hearing",
  "speech",
  "endurance",
  "cognition",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  strength: "力量",
  dexterity: "敏捷",
  mobility: "移动",
  sight: "视觉",
  hearing: "听觉",
  speech: "言语",
  endurance: "耐力",
  cognition: "认知",
};

export type Visibility = "clean" | "blood" | "bandage" | "bound" | "missing";

export interface Part {
  exists: boolean;
  /** 结构完整度 0–100 */
  integrity: number;
  /** 当前功能 0–100（神经、关节、束缚） */
  function: number;
  /** 疼痛 0–100 */
  pain: number;
  /** 出血 0–100 */
  bleeding: number;
  visibleStates: Visibility[];
}

export type StatusId =
  | "bound_hands"
  | "bound_legs"
  | "blindfold"
  | "tether"
  | "unconscious"
  | "one_hand";

export interface Body {
  parts: Record<PartId, Part>;
  fatigue: number;
  hunger: number;
  thirst: number;
  fever: number;
  intoxication: number;
  consciousness: number;
  statuses: StatusId[];
}

export interface CapabilitySheet {
  strength: number;
  dexterity: number;
  mobility: number;
  sight: number;
  hearing: number;
  speech: number;
  endurance: number;
  cognition: number;
}

const clamp = (x: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, x));

const unit = (x: number): number => clamp(x / 100, 0, 1);

/** 部位性能：完整 × 功能 × (1−0.7 疼痛) × (1−0.5 出血)。 */
export function partPerformance(part: Part): number {
  if (!part.exists) return 0;
  return (
    unit(part.integrity) *
    unit(part.function) *
    (1 - 0.7 * unit(part.pain)) *
    (1 - 0.5 * unit(part.bleeding))
  );
}

/** 全身状态乘数。 */
export function vital(body: Body): number {
  return (
    (1 - 0.3 * unit(body.fatigue)) *
    (1 - 0.15 * unit(body.hunger)) *
    (1 - 0.2 * unit(body.thirst)) *
    (1 - 0.35 * unit(body.fever)) *
    (1 - 0.35 * unit(body.intoxication))
  );
}

/**
 * 状态对部位的即时影响（不写回存档）。
 * bound_hands 把双手功能压到 5；blindfold 把眼功能压到 0。
 */
export function effectiveBody(body: Body): Body {
  const parts = {} as Record<PartId, Part>;
  for (const id of PART_IDS) {
    parts[id] = { ...body.parts[id], visibleStates: [...body.parts[id].visibleStates] };
  }
  if (body.statuses.includes("bound_hands")) {
    parts.leftHand.function = Math.min(parts.leftHand.function, 5);
    parts.rightHand.function = Math.min(parts.rightHand.function, 5);
  }
  if (body.statuses.includes("blindfold")) {
    parts.eyes.function = 0;
  }
  return { ...body, parts, statuses: [...body.statuses] };
}

/** 八项能力值，0–100。 */
export function capabilities(body: Body): CapabilitySheet {
  const b = effectiveBody(body);
  const p = {} as Record<PartId, number>;
  for (const id of PART_IDS) p[id] = partPerformance(b.parts[id]);

  const v = vital(b);
  const cap = (x: number): number => clamp(x, 0, 100);
  const maxPain = Math.max(...PART_IDS.map((id) => unit(b.parts[id].pain)));

  return {
    strength: cap(
      100 *
        v *
        (0.25 * p.leftArm +
          0.25 * p.rightArm +
          0.2 * p.torso +
          0.15 * p.leftLeg +
          0.15 * p.rightLeg),
    ),
    dexterity: cap(
      100 *
        v *
        (0.3 * p.leftHand +
          0.3 * p.rightHand +
          0.2 * p.leftArm +
          0.2 * p.rightArm),
    ),
    mobility: cap(
      100 * v * (0.35 * p.leftLeg + 0.35 * p.rightLeg + 0.2 * p.torso + 0.1 * p.head),
    ),
    sight: cap(100 * p.eyes),
    hearing: cap(100 * p.ears),
    speech: cap(100 * v * (0.65 * p.mouth + 0.35 * p.head)),
    endurance: cap(100 * v * (0.4 * p.torso + 0.3 * p.leftLeg + 0.3 * p.rightLeg)),
    cognition: cap(
      100 *
        p.head *
        (1 - 0.4 * unit(body.fever)) *
        (1 - 0.25 * unit(body.intoxication)) *
        (1 - 0.2 * maxPain),
    ),
  };
}

/** 给角色看的定性描述，永远不含数字。 */
export function interoception(body: Body): string[] {
  const b = effectiveBody(body);
  const out: string[] = [];

  if (b.parts.leftArm.pain > 50) out.push("左臂每动一下都像有人拿烧红的针扎。");
  else if (b.parts.leftArm.pain > 25) out.push("左臂一阵阵地抽痛。");

  if (b.parts.leftHand.function < 10 && b.parts.leftHand.exists) {
    out.push("手指被麻绳勒得发麻，握不住东西。");
  }
  if (b.parts.rightHand.function < 10 && b.parts.rightHand.exists) {
    out.push("右手也使不上力，指尖发木。");
  }
  if (body.fever > 30) out.push("额头烫，嘴里发苦，看东西有点发飘。");
  if (body.fatigue > 60) out.push("眼皮发沉，四肢像灌了铅。");
  if (body.thirst > 40) out.push("喉咙干得发紧，咽口水都疼。");
  if (body.consciousness < 50) out.push("脑子一阵阵发空，得靠墙才坐得住。");

  const bleeding = PART_IDS.reduce((sum, id) => sum + unit(b.parts[id].bleeding), 0);
  if (bleeding > 0.1) out.push("伤口还在渗血，袖子黏在皮肤上。");

  if (out.length === 0) out.push("身上没什么大碍，只是有点乏。");
  return out;
}

const WOUND_TABLE = {
  1: { integrity: 5, pain: 10, bleeding: 5 },
  2: { integrity: 15, pain: 25, bleeding: 15 },
  3: { integrity: 35, pain: 50, bleeding: 30 },
} as const;

/** 按伤级给部位记账；4 级视为断肢/失明。 */
export function applyWound(body: Body, partId: PartId, severity: 1 | 2 | 3 | 4): Body {
  const next = structuredClone(body);
  const part = next.parts[partId];

  if (severity === 4) {
    part.exists = false;
    part.integrity = 0;
    part.function = 0;
    part.bleeding = 0;
    if (!part.visibleStates.includes("missing")) part.visibleStates.push("missing");
    return next;
  }

  const d = WOUND_TABLE[severity];
  part.integrity = clamp(part.integrity - d.integrity, 0, 100);
  part.pain = clamp(part.pain + d.pain, 0, 100);
  part.bleeding = clamp(part.bleeding + d.bleeding, 0, 100);
  if (!part.visibleStates.includes("blood")) part.visibleStates.push("blood");
  return next;
}
