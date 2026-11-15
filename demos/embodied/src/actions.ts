/**
 * 12 个动词的判定配置。
 * 见 demos/embodied/DESIGN.md §4–§5。
 *
 * 原则：能力值只由动作权重与身体决定；DC 只由环境/对手/情境决定。
 */

import type { Capability, StatusId } from "./body.ts";

export const VERBS = [
  "move",
  "look",
  "listen",
  "speak",
  "whisper",
  "take",
  "give",
  "use",
  "hide",
  "tend",
  "rest",
  "wait",
] as const;

export type Verb = (typeof VERBS)[number];

export const VERB_LABELS: Record<Verb, string> = {
  move: "移动",
  look: "看",
  listen: "听",
  speak: "说",
  whisper: "低语",
  take: "拿取",
  give: "递出",
  use: "使用",
  hide: "藏匿",
  tend: "处理伤口",
  rest: "休息",
  wait: "等待",
};

export type CheckWorthy = "never" | "risky" | "social" | "always";
export type Stakes = "low" | "medium" | "high";

export interface ActionSpec {
  verb: Verb;
  label: string;
  /** 用于展示与权重表的主能力 */
  primary: Capability;
  /** 权重之和为 1；能力值按权重加权 */
  weights: Partial<Record<Capability, number>>;
  /** 低于此值视为不可尝试（硬约束） */
  minCapability: number;
  baseDC: number;
  checkWorthy: CheckWorthy;
  stakes: Stakes;
  timeCostTicks: number;
}

export const ACTION_SPECS: Record<Verb, ActionSpec> = {
  move: {
    verb: "move",
    label: VERB_LABELS.move,
    primary: "mobility",
    weights: { mobility: 0.8, endurance: 0.2 },
    minCapability: 15,
    baseDC: 20,
    checkWorthy: "risky",
    stakes: "medium",
    timeCostTicks: 1,
  },
  look: {
    verb: "look",
    label: VERB_LABELS.look,
    primary: "sight",
    weights: { sight: 1 },
    minCapability: 5,
    baseDC: 0,
    checkWorthy: "risky",
    stakes: "low",
    timeCostTicks: 1,
  },
  listen: {
    verb: "listen",
    label: VERB_LABELS.listen,
    primary: "hearing",
    weights: { hearing: 1 },
    minCapability: 5,
    baseDC: 20,
    checkWorthy: "risky",
    stakes: "low",
    timeCostTicks: 1,
  },
  speak: {
    verb: "speak",
    label: VERB_LABELS.speak,
    primary: "speech",
    weights: { speech: 0.9, cognition: 0.1 },
    minCapability: 10,
    baseDC: 55,
    checkWorthy: "social",
    stakes: "medium",
    timeCostTicks: 1,
  },
  whisper: {
    verb: "whisper",
    label: VERB_LABELS.whisper,
    primary: "speech",
    weights: { speech: 1 },
    minCapability: 10,
    baseDC: 65,
    checkWorthy: "social",
    stakes: "high",
    timeCostTicks: 1,
  },
  take: {
    verb: "take",
    label: VERB_LABELS.take,
    primary: "dexterity",
    weights: { dexterity: 0.8, sight: 0.2 },
    minCapability: 20,
    baseDC: 30,
    checkWorthy: "risky",
    stakes: "medium",
    timeCostTicks: 1,
  },
  give: {
    verb: "give",
    label: VERB_LABELS.give,
    primary: "dexterity",
    weights: { dexterity: 0.8, speech: 0.2 },
    minCapability: 20,
    baseDC: 20,
    checkWorthy: "social",
    stakes: "low",
    timeCostTicks: 1,
  },
  use: {
    verb: "use",
    label: VERB_LABELS.use,
    primary: "dexterity",
    weights: { dexterity: 0.6, sight: 0.2, strength: 0.2 },
    minCapability: 20,
    baseDC: 40,
    checkWorthy: "risky",
    stakes: "medium",
    timeCostTicks: 2,
  },
  hide: {
    verb: "hide",
    label: VERB_LABELS.hide,
    primary: "dexterity",
    weights: { dexterity: 0.5, mobility: 0.3, sight: 0.2 },
    minCapability: 15,
    baseDC: 40,
    checkWorthy: "risky",
    stakes: "high",
    timeCostTicks: 2,
  },
  tend: {
    verb: "tend",
    label: VERB_LABELS.tend,
    primary: "dexterity",
    weights: { dexterity: 0.5, sight: 0.3, cognition: 0.2 },
    minCapability: 25,
    baseDC: 50,
    checkWorthy: "risky",
    stakes: "medium",
    timeCostTicks: 3,
  },
  rest: {
    verb: "rest",
    label: VERB_LABELS.rest,
    primary: "endurance",
    weights: {},
    minCapability: 0,
    baseDC: 0,
    checkWorthy: "never",
    stakes: "low",
    timeCostTicks: 6,
  },
  wait: {
    verb: "wait",
    label: VERB_LABELS.wait,
    primary: "endurance",
    weights: {},
    minCapability: 0,
    baseDC: 0,
    checkWorthy: "never",
    stakes: "low",
    timeCostTicks: 1,
  },
};

/** 需要至少一只可用的手。 */
export const NEEDS_HAND: Verb[] = ["take", "give", "use", "hide", "tend"];

export interface StatusRule {
  verbs: Verb[];
  reason: string;
}

/** 状态 → 直接禁止的动作。bound_legs 的"只能爬"在 check.ts 里单独处理。 */
export const STATUS_RULES: Partial<Record<StatusId, StatusRule>> = {
  bound_hands: {
    verbs: ["take", "give", "use", "hide", "tend"],
    reason: "双手被反绑，手指够不到。",
  },
  blindfold: {
    verbs: ["look"],
    reason: "眼睛被蒙住，什么也看不见。",
  },
  unconscious: {
    verbs: [...VERBS],
    reason: "你失去了意识。",
  },
};

export type Light = "bright" | "dim" | "dark";
export type Attitude = "friendly" | "neutral" | "hostile";

export interface CheckEnv {
  light?: Light;
  distanceM?: number;
  attitude?: Attitude;
  watched?: boolean;
  cover?: boolean;
  /** 石墙/关门等完全隔音 */
  soundproof?: boolean;
}

const ATTITUDE_DC: Record<Attitude, number> = {
  friendly: 40,
  neutral: 55,
  hostile: 70,
};

/**
 * 环境/对手决定的基础难度。角色能力不进这里。
 * DM 接入后，只在此基线上做有界调整（见 DESIGN §5）。
 */
export function baseDifficulty(spec: ActionSpec, env: CheckEnv = {}): number {
  switch (spec.verb) {
    case "speak":
      return (
        ATTITUDE_DC[env.attitude ?? "neutral"] +
        ((env.distanceM ?? 1) > 3 ? 10 : 0)
      );
    case "whisper":
      return ATTITUDE_DC[env.attitude ?? "neutral"] + 10;
    case "look":
      if (env.light === "dark") return 95;
      if (env.light === "dim") return 30;
      return 0;
    case "listen": {
      const d = env.distanceM ?? 1;
      if (d <= 2) return 20;
      if (d <= 5) return 45;
      if (d <= 15) return 60;
      return 75;
    }
    case "hide":
      return env.watched ? 65 : env.cover ? 40 : 55;
    case "move":
      return env.light === "dark" ? 35 : 20;
    default:
      return spec.baseDC;
  }
}
