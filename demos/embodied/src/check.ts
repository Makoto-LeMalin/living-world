/**
 * 判定：硬约束 → 能力值 → 难度 → 概率 → 结果。
 * 见 demos/embodied/DESIGN.md §1、§4–§6。
 *
 * 约束：
 * - LLM 不参与这里的任何一步（DM 只能给有界难度，A2 接入）。
 * - 所有随机走 engine/rng.ts。
 * - 结果只产出"事实"，不产出叙述；叙述由 Narrator 负责。
 */

import {
  ACTION_SPECS,
  NEEDS_HAND,
  baseDifficulty,
  type ActionSpec,
  type CheckEnv,
  type Verb,
} from "./actions.ts";
import { capabilities, type Body, type Capability } from "./body.ts";
import { makeRng } from "../../../engine/rng.ts";

export type Outcome =
  | "clean_success"
  | "narrow_success"
  | "lucky_success"
  | "near_miss"
  | "hard_fail";

export type CheckTraceEvent =
  | { phase: "blocked"; reason: string }
  | { phase: "feasible" }
  | { phase: "capability"; capability: number; minCapability: number }
  | { phase: "difficulty"; base: number; final: number }
  | { phase: "roll"; probability: number; roll: number; outcome: Outcome }
  | { phase: "no-roll" };

export interface CheckOptions {
  body: Body;
  verb: Verb;
  /** 手法，如 crawl / mouth；影响硬规则与修正 */
  manner?: string;
  env?: CheckEnv;
  /** 直接指定最终难度（调试/DM 接入前）；不传则用 baseDC + 修正 */
  difficulty?: number;
  seed?: string | number;
  checkId?: number;
  /** 只读观测钩子；不改变判定 */
  onTrace?: (event: CheckTraceEvent) => void;
}

export interface CheckResult {
  verb: Verb;
  feasible: boolean;
  reason?: string;
  capability?: number;
  difficulty?: number;
  baseDifficulty?: number;
  probability?: number;
  roll?: number;
  outcome?: Outcome;
  /** 允许叙述者声明的谓词；Narrator 的 claims 必须是它的子集 */
  claimIds: string[];
  facts: string[];
}

const clamp = (x: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, x));

/** 能力值 = 动作权重 × 八项能力。 */
export function capabilityFor(body: Body, spec: ActionSpec): number {
  const caps = capabilities(body);
  let total = 0;
  for (const [key, weight] of Object.entries(spec.weights)) {
    total += caps[key as Capability] * (weight ?? 0);
  }
  return clamp(total, 0, 100);
}

/** p = sigmoid((C − D) / scale)。 */
export function probability(capability: number, difficulty: number, scale = 12): number {
  return 1 / (1 + Math.exp((difficulty - capability) / scale));
}

/** 成功率与掷骰的差决定分级。 */
export function outcomeOf(prob: number, roll: number): Outcome {
  const success = roll < prob;
  const margin = prob - roll;

  if (success) {
    if (prob < 0.15) return "lucky_success";
    // 接近必然的成功不应被叙述成"勉强"。
    if (prob >= 0.9) return "clean_success";
    if (margin >= 0.2) return "clean_success";
    return "narrow_success";
  }
  return margin > -0.15 ? "near_miss" : "hard_fail";
}

const CLEAN: Partial<Record<Verb, string>> = {
  move: "你到了想去的位置。",
  look: "你看清了周围。",
  listen: "你听清了外面的动静。",
  speak: "对方听进去了。",
  whisper: "对方听见了你的低语。",
  take: "东西到了你手里。",
  give: "对方接了过去。",
  use: "你用成了。",
  hide: "藏好了。",
  tend: "伤口处理得还算干净。",
  rest: "你歇了一会儿，气息稳了些。",
  wait: "你等了一会儿，外面没有变化。",
};

const NARROW: Partial<Record<Verb, string>> = {
  move: "你到了，但碰倒了什么，发出声响。",
  look: "光线太暗，你只看清了个大概。",
  listen: "声音断断续续，你只抓住了一半。",
  speak: "对方半信半疑。",
  whisper: "对方听到了，但没全信。",
  take: "你拿到了，但弄出了点动静。",
  give: "对方犹豫了一下才接。",
  use: "勉强用成了，但费了点事。",
  hide: "藏住了，但露出一个角。",
  tend: "血止住了，但包扎得很粗糙。",
  rest: "你歇了一会儿，但没真正放松。",
  wait: "你等了一会儿，腿有些发麻。",
};

const NEAR: Partial<Record<Verb, string>> = {
  move: "你差一点就够到了。",
  look: "你什么也没看清。",
  listen: "你听漏了关键的部分。",
  speak: "对方没有接话。",
  whisper: "对方没听清。",
  take: "你的指尖擦过它，没抓住。",
  give: "对方没接。",
  use: "没用好。",
  hide: "差点被发现。",
  tend: "没处理好。",
  rest: "你没能歇下来。",
  wait: "你等得有些焦躁。",
};

const HARD_FAIL: Partial<Record<Verb, string>> = {
  move: "你没能过去。",
  look: "眼前一片模糊。",
  listen: "你什么也没听出来。",
  speak: "对方不为所动。",
  whisper: "对方根本没听见。",
  take: "你没拿到。",
  give: "对方拒绝了。",
  use: "没用成。",
  hide: "被看见了。",
  tend: "伤口更疼了。",
  rest: "你没能休息。",
  wait: "你白等了一场。",
};

const LUCKY: Partial<Record<Verb, string>> = {
  move: "你几乎是摔过去的，但总算到了。",
  look: "你眯着眼辨认了半天，才看清一点轮廓。",
  listen: "你从一片杂音里勉强抓住了一个词。",
  speak: "对方居然信了，但你也露出了破绽。",
  whisper: "对方居然听见了，但你也惊动了旁人。",
  take: "你胡乱一抓，居然抓住了。",
  give: "对方稀里糊涂地接了。",
  use: "你误打误撞地用成了。",
  hide: "你几乎是被草堆绊倒才藏住。",
  tend: "你手忙脚乱地按住了伤口，居然止住了血。",
  rest: "你昏沉了一会儿，勉强算歇了。",
  wait: "你等到了，但错过了别的。",
};

export function describeOutcome(verb: Verb, outcome: Outcome): string {
  switch (outcome) {
    case "clean_success":
      return CLEAN[verb] ?? "你做到了。";
    case "narrow_success":
      return NARROW[verb] ?? "你勉强做到了。";
    case "lucky_success":
      return LUCKY[verb] ?? "你侥幸做到了，代价不小。";
    case "near_miss":
      return NEAR[verb] ?? "你差一点就做到了。";
    case "hard_fail":
      return HARD_FAIL[verb] ?? "你失败了。";
  }
}

function hasUsableHand(body: Body): boolean {
  return (["leftHand", "rightHand"] as const).some((id) => {
    const part = body.parts[id];
    return part.exists && part.function > 0;
  });
}

function hasUsableLeg(body: Body): boolean {
  return (["leftLeg", "rightLeg"] as const).some((id) => {
    const part = body.parts[id];
    return part.exists && part.function > 0;
  });
}

const MIN_REASON: Partial<Record<Verb, string>> = {
  move: "腿撑不住，迈不开步。",
  look: "眼睛使不上力，看不清。",
  listen: "耳朵嗡嗡的，听不清。",
  speak: "嗓子发不出声。",
  whisper: "气不够，压不住声音。",
  take: "手使不上力，拿不住。",
  give: "手使不上力，递不出去。",
  use: "手使不上力，用不了。",
  hide: "手脚都不听使唤，藏不住。",
  tend: "手抖得厉害，处理不了伤口。",
};

export function evaluateCheck(options: CheckOptions): CheckResult {
  const spec = ACTION_SPECS[options.verb];
  if (!spec) throw new Error(`未知动词: ${options.verb}`);

  const body = options.body;
  const env: CheckEnv = options.env ?? {};
  const manner = (options.manner ?? "").toLowerCase();
  const emit = options.onTrace ?? (() => {});
  const blocked = (reason: string, capability?: number): CheckResult => {
    emit({ phase: "blocked", reason });
    return {
      verb: spec.verb,
      feasible: false,
      reason,
      ...(capability === undefined ? {} : { capability }),
      claimIds: [`${spec.verb}:blocked`],
      facts: [reason],
    };
  };

  if (body.statuses.includes("unconscious") || body.consciousness < 30) {
    return blocked("你失去了意识，什么也做不了。");
  }

  let capScale = 1;
  let dcDelta = 0;
  let minOverride: number | undefined;

  // 反绑：手动动作直接不可尝试；用嘴是唯一例外。
  if (body.statuses.includes("bound_hands") && NEEDS_HAND.includes(spec.verb)) {
    const mouth = ["mouth", "teeth", "嘴", "牙"].includes(manner);
    if (!mouth) return blocked("双手被反绑，手指够不到。");
    capScale *= 0.3;
    dcDelta += 20;
    minOverride = 2;
  }

  if (body.statuses.includes("blindfold") && spec.verb === "look") {
    return blocked("眼睛被蒙住，什么也看不见。");
  }

  // 绑腿：只能爬。
  if (body.statuses.includes("bound_legs") && spec.verb === "move") {
    const crawl = manner === "crawl" || manner === "爬";
    if (!crawl) return blocked("脚踝被绑着，站不起来。");
    capScale *= 0.3;
    dcDelta += 25;
  }

  // 铁链：活动半径 1m。
  if (
    body.statuses.includes("tether") &&
    spec.verb === "move" &&
    (env.distanceM ?? 0) > 1
  ) {
    return blocked("脚踝上的短链拉住了你，够不到那里。");
  }

  // 低语只能对 1m 内的人说。
  if (spec.verb === "whisper" && (env.distanceM ?? 0) > 1) {
    return blocked("太远了，压低声音也传不过去。");
  }

  // 完全隔音：听不见，不是难听见。
  if (spec.verb === "listen" && env.soundproof) {
    return blocked("这堵墙把声音挡得死死的。");
  }

  // 部位存在性。
  if (NEEDS_HAND.includes(spec.verb) && !hasUsableHand(body)) {
    return blocked("没有可用的手。");
  }
  if (spec.verb === "look" && (!body.parts.eyes.exists || body.parts.eyes.function <= 0)) {
    return blocked("你的眼睛看不见。");
  }
  if (spec.verb === "listen" && !body.parts.ears.exists) {
    return blocked("你听不见。");
  }
  if (
    (spec.verb === "speak" || spec.verb === "whisper") &&
    !body.parts.mouth.exists
  ) {
    return blocked("你说不出话。");
  }
  if (spec.verb === "move" && !hasUsableLeg(body)) {
    return blocked("你的腿动不了。");
  }
  if (spec.verb === "look" && env.light === "dark") {
    return blocked("睁着眼也什么都看不见。");
  }

  const rawCap = capabilityFor(body, spec);
  const capability = clamp(rawCap * capScale, 0, 100);

  // 能力下限：低于最低值视为身体做不到，而不是难度高。
  const minCapability = minOverride ?? spec.minCapability;
  emit({ phase: "feasible" });
  emit({ phase: "capability", capability, minCapability });
  if (spec.checkWorthy !== "never" && capability < minCapability) {
    const reason = MIN_REASON[spec.verb] ?? "身体撑不住。";
    return blocked(reason, capability);
  }

  // 不需要掷骰的动作。
  if (spec.checkWorthy === "never") {
    emit({ phase: "no-roll" });
    return {
      verb: spec.verb,
      feasible: true,
      capability,
      claimIds: [`${spec.verb}:done`],
      facts: [`你${spec.label}了一会儿。`],
    };
  }

  const base = baseDifficulty(spec, env);
  const difficulty = clamp(options.difficulty ?? base + dcDelta, 0, 100);
  emit({ phase: "difficulty", base, final: difficulty });

  const prob = probability(capability, difficulty);
  const seed = options.seed ?? "42";
  const checkId = options.checkId ?? 1;
  const roll = makeRng(`${seed}:${checkId}`).next();
  const outcome = outcomeOf(prob, roll);
  emit({ phase: "roll", probability: prob, roll, outcome });

  return {
    verb: spec.verb,
    feasible: true,
    capability,
    difficulty,
    baseDifficulty: base,
    probability: prob,
    roll,
    outcome,
    claimIds: [`${spec.verb}:${outcome}`],
    facts: [describeOutcome(spec.verb, outcome)],
  };
}
