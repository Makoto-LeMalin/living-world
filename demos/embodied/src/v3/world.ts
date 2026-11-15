/**
 * V3 世界规则：本体标签的准入，不是编译器的"可不可能"。
 *
 * 同一份 demand 在物理世界被拒、在秘法世界通过，是规则数据不同，
 * 不是模型或判定器改了标准。
 */

import type { ActionDemand } from "../v2/demand.ts";
import {
  ONTOLOGY_TAGS,
  isRegisteredOntologyTag,
  isValidOntologyTag,
  normalizeOntologyTags,
} from "../ontology.ts";

export interface WorldRules {
  id: string;
  label: string;
  /** 允许的本体标签；空数组表示只允许纯物理动作 */
  allowedTags: string[];
  note?: string;
}

/** 默认三套规则：物理 / 秘法 / 开放（用于对照，不是产品设定）。 */
export const DEFAULT_WORLDS: WorldRules[] = [
  {
    id: "physical",
    label: "物理世界",
    allowedTags: [],
    note: "本体依赖一律不成立；动作仍在编译器里合法，只是世界不放行。",
  },
  {
    id: "arcane",
    label: "秘法世界",
    allowedTags: ["psychic", "temporal", "divine", "metaphysical", "spirit"],
    note: "允许五类超自然依赖；technological 不在此列。",
  },
  {
    id: "open",
    label: "开放世界",
    allowedTags: [...ONTOLOGY_TAGS],
    note: "允许全部已注册标签，用来验证规则是数据而不是硬编码。",
  },
];

export interface WorldValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateWorldRules(world: WorldRules): WorldValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof world.id !== "string" || world.id.trim().length === 0) {
    errors.push("world.id 不能为空");
  }
  if (!Array.isArray(world.allowedTags)) {
    errors.push("world.allowedTags 必须是数组");
    return { ok: false, errors, warnings };
  }

  const seen = new Set<string>();
  for (const raw of world.allowedTags) {
    if (typeof raw !== "string") {
      errors.push("world.allowedTags 含非字符串");
      continue;
    }
    const tag = raw.trim().toLowerCase();
    if (!isValidOntologyTag(tag)) {
      errors.push(`world.allowedTags 含非法标签: ${JSON.stringify(raw)}`);
      continue;
    }
    if (seen.has(tag)) errors.push(`world.allowedTags 重复: ${tag}`);
    seen.add(tag);
    if (!isRegisteredOntologyTag(tag)) {
      warnings.push(`world.allowedTags 含未注册标签: ${tag}（世界可自定义，但需自行解释）`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export interface GateResult {
  allowed: boolean;
  worldId: string;
  tags: string[];
  violations: string[];
  unknownTags: string[];
  reason?: string;
}

/** 世界准入：所有标签都必须被允许；空标签永远通过。 */
export function gateDemand(
  demand: Pick<ActionDemand, "ontologyTags">,
  world: WorldRules,
): GateResult {
  const tags = normalizeOntologyTags(demand.ontologyTags);
  const allowed = new Set(world.allowedTags.map((tag) => tag.trim().toLowerCase()));
  const violations = tags.filter((tag) => !allowed.has(tag));
  const unknownTags = tags.filter((tag) => !isRegisteredOntologyTag(tag));

  return {
    allowed: violations.length === 0,
    worldId: world.id,
    tags,
    violations,
    unknownTags,
    ...(violations.length === 0
      ? {}
      : {
          reason: `${world.label}不允许本体依赖：${violations.join(", ")}`,
        }),
  };
}

/** 生成标签的全部子集；用于穷举世界矩阵，而不是抽样。 */
export function allTagSubsets(tags: readonly string[]): string[][] {
  const out: string[][] = [];
  const total = 1 << tags.length;
  for (let mask = 0; mask < total; mask++) {
    const subset: string[] = [];
    for (let i = 0; i < tags.length; i++) {
      if ((mask & (1 << i)) !== 0) subset.push(tags[i]);
    }
    out.push(subset);
  }
  return out;
}

export interface WorldMatrixCase {
  worldId: string;
  tags: string[];
  expected: boolean;
  actual: boolean;
  pass: boolean;
}

export interface WorldMatrixResult {
  total: number;
  passed: number;
  failures: WorldMatrixCase[];
  monotonicChecked: number;
  monotonicPassed: number;
  monotonicFailures: string[];
  unknownDenied: boolean;
  customAllowed: boolean;
  cases: WorldMatrixCase[];
}

/**
 * 穷举：所有已注册标签子集 × 每套世界规则。
 * 另外检查单调性：在同一世界里加标签只能让结果从"允许"变成"不允许"，不能反过来。
 */
export function runWorldMatrix(
  worlds: WorldRules[] = DEFAULT_WORLDS,
  tags: readonly string[] = ONTOLOGY_TAGS,
): WorldMatrixResult {
  const subsets = allTagSubsets(tags);
  const cases: WorldMatrixCase[] = [];
  const failures: WorldMatrixCase[] = [];

  for (const world of worlds) {
    const allowed = new Set(world.allowedTags.map((tag) => tag.trim().toLowerCase()));
    for (const subset of subsets) {
      const expected = subset.every((tag) => allowed.has(tag));
      const actual = gateDemand({ ontologyTags: subset }, world).allowed;
      const item = { worldId: world.id, tags: subset, expected, actual, pass: expected === actual };
      cases.push(item);
      if (!item.pass) failures.push(item);
    }
  }

  let monotonicChecked = 0;
  let monotonicPassed = 0;
  const monotonicFailures: string[] = [];
  for (const world of worlds) {
    for (const subset of subsets) {
      const base = gateDemand({ ontologyTags: subset }, world).allowed;
      for (const tag of tags) {
        if (subset.includes(tag)) continue;
        monotonicChecked++;
        const extended = gateDemand({ ontologyTags: [...subset, tag] }, world).allowed;
        const pass = !(extended && !base);
        if (pass) monotonicPassed++;
        else monotonicFailures.push(`${world.id}: ${subset.join("+") || "(空)"} + ${tag}`);
      }
    }
  }

  const unknownDenied = worlds.every(
    (world) => !gateDemand({ ontologyTags: ["magic"] }, world).allowed,
  );
  const customWorld: WorldRules = {
    id: "custom",
    label: "自定义世界",
    allowedTags: ["magic"],
  };
  const customAllowed = gateDemand({ ontologyTags: ["magic"] }, customWorld).allowed;

  return {
    total: cases.length,
    passed: cases.filter((item) => item.pass).length,
    failures,
    monotonicChecked,
    monotonicPassed,
    monotonicFailures,
    unknownDenied,
    customAllowed,
    cases,
  };
}
