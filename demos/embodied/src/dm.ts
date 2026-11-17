/**
 * DM（裁判）契约：只判断"这件事在这个世界里有多难"。
 *
 * 硬约束：
 * - 输入不含角色能力/身体/thought。
 * - 输出 difficulty 与 baseDifficulty 的偏离 ≤ 20。
 * - factors 必须引用输入 facts 的 id。
 * - consequenceHint 只能从 allowedConsequences 里选。
 * - 任何不合法 → 回退 baseDifficulty，记 DM_INVALID/FALLBACK。
 */

import type { Verb } from "./actions.ts";
import type { ChatClient, ChatMessage } from "../../../llm/types.ts";
import { hashString } from "../../../engine/rng.ts";
import { canonicalJson } from "../../../engine/json.ts";

export type DifficultyCategory =
  | "trivial"
  | "easy"
  | "medium"
  | "hard"
  | "very_hard"
  | "extreme";

export type DmFactorKind = "social" | "circumstance" | "context";
export type DmStakes = "low" | "medium" | "high";

export const CONSEQUENCE_HINTS = [
  "none",
  "noise_alert",
  "time_loss",
  "pain_spike",
  "injury",
  "item_lost",
  "exposure",
] as const;

export type ConsequenceHint = (typeof CONSEQUENCE_HINTS)[number];

export interface DmFact {
  id: string;
  text: string;
}

export interface DmInput {
  intent: {
    verb: Verb;
    target?: string;
    manner?: string;
    goal?: string;
  };
  baseDifficulty: number;
  category: DifficultyCategory;
  attemptable: boolean;
  environment: {
    place?: string;
    light?: string;
    noise?: string;
    crowd?: number;
    timePressure?: string;
  };
  opposition?: {
    name: string;
    attitude?: string;
    alertness?: string;
  };
  facts: DmFact[];
  allowedConsequences: ConsequenceHint[];
}

export interface DmFactor {
  kind: DmFactorKind;
  value: number;
  reason: string;
  factId: string;
}

export interface DmOutput {
  difficulty: number;
  factors: DmFactor[];
  stakes: DmStakes;
  consequenceHint: ConsequenceHint;
  rationale: string;
}

export interface DmResult {
  difficulty: number;
  source: "dm" | "fallback";
  output?: DmOutput;
  error?: string;
}

export type DmTraceEvent =
  | { phase: "request"; input: DmInput; messages: ChatMessage[] }
  | { phase: "response"; content: string }
  | { phase: "valid"; output: DmOutput }
  | { phase: "fallback"; error: string }
  | { phase: "cache"; result: DmResult };

export const DIFFICULTY_ANCHORS: Array<{ category: DifficultyCategory; dc: number; label: string }> = [
  { category: "trivial", dc: 10, label: "几乎不会失败" },
  { category: "easy", dc: 30, label: "稍加注意即可" },
  { category: "medium", dc: 50, label: "需要点本事" },
  { category: "hard", dc: 70, label: "明显吃力" },
  { category: "very_hard", dc: 85, label: "专家级" },
  { category: "extreme", dc: 95, label: "近乎不可能" },
];

export function categoryFromBase(base: number): DifficultyCategory {
  if (base < 20) return "trivial";
  if (base < 40) return "easy";
  if (base < 60) return "medium";
  if (base < 75) return "hard";
  if (base < 90) return "very_hard";
  return "extreme";
}

const SYSTEM_PROMPT = `你是文字世界的裁判（DM）。你只回答一个问题：这个动作在这个世界里有多难？

规则：
- 你只看环境、对手、情境，不看角色的身体或能力值。能力只影响掷骰的一方，不影响难度。
- 光照、地形、伤口、饥饿、疲劳等物理/身体因素已经算进 baseDifficulty，不要作为 factor 重复计入。
- baseDifficulty 是世界规则给出的基线；你的 difficulty 与它的偏离不得超过 20。
- 每个因素必须引用输入 facts 里的 id；没有因素就给空数组，不要编造。
- factors.kind 只能是 social / circumstance / context：
  - social：对手态度、人群、身份暴露；
  - circumstance：时间压力、声响、突发干扰；
  - context：场合、惯例、身份。
- 不要输出角色能力、身体状态、thought 或任何解释性长文，只输出 JSON。

难度锚点：10 几乎不会失败；30 稍加注意即可；50 需要点本事；70 明显吃力；85 专家级；95 近乎不可能。

只输出这个 JSON：
{"difficulty":50,"factors":[{"kind":"social","value":8,"reason":"...","factId":"f_1"}],"stakes":"medium","consequenceHint":"none","rationale":"一句话"}`;

export function buildDmMessages(input: DmInput): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify(
        {
          intent: input.intent,
          baseDifficulty: input.baseDifficulty,
          category: input.category,
          attemptable: input.attemptable,
          environment: input.environment,
          opposition: input.opposition,
          facts: input.facts,
          allowedConsequences: input.allowedConsequences,
        },
        null,
        2,
      ),
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从可能带 ```json 围栏的文本里取出第一个对象。 */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("输出里没有 JSON 对象");
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

export type DmValidation =
  | { ok: true; value: DmOutput }
  | { ok: false; error: string };

export function validateDmOutput(raw: unknown, input: DmInput): DmValidation {
  if (!isRecord(raw)) return { ok: false, error: "输出不是对象" };

  for (const forbidden of ["capability", "capabilities", "body", "thought"]) {
    if (forbidden in raw) return { ok: false, error: `输出包含禁止字段 ${forbidden}` };
  }

  const difficulty = raw.difficulty;
  if (typeof difficulty !== "number" || !Number.isFinite(difficulty)) {
    return { ok: false, error: "difficulty 不是数字" };
  }
  if (difficulty < 0 || difficulty > 100) {
    return { ok: false, error: `difficulty 越界: ${difficulty}` };
  }
  const deviation = Math.abs(difficulty - input.baseDifficulty);
  if (deviation > 20) {
    return { ok: false, error: `difficulty 偏离基线 ${deviation.toFixed(1)} > 20` };
  }

  const facts = new Set(input.facts.map((fact) => fact.id));
  const rawFactors = raw.factors;
  if (!Array.isArray(rawFactors) || rawFactors.length > 6) {
    return { ok: false, error: "factors 必须是 ≤6 的数组" };
  }

  const factors: DmFactor[] = [];
  for (const item of rawFactors) {
    if (!isRecord(item)) return { ok: false, error: "factor 不是对象" };
    const kind = item.kind;
    if (kind !== "social" && kind !== "circumstance" && kind !== "context") {
      return { ok: false, error: `factor.kind 非法: ${String(kind)}` };
    }
    const value = item.value;
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 20) {
      return { ok: false, error: `factor.value 非法: ${String(value)}` };
    }
    const factId = item.factId;
    if (typeof factId !== "string" || !facts.has(factId)) {
      return { ok: false, error: `factor.factId 不在输入 facts 中: ${String(factId)}` };
    }
    const reason = item.reason;
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return { ok: false, error: "factor.reason 为空" };
    }
    factors.push({ kind, value, reason, factId });
  }

  const stakes = raw.stakes;
  if (stakes !== "low" && stakes !== "medium" && stakes !== "high") {
    return { ok: false, error: `stakes 非法: ${String(stakes)}` };
  }

  const consequenceHint = raw.consequenceHint;
  if (
    typeof consequenceHint !== "string" ||
    !input.allowedConsequences.includes(consequenceHint as ConsequenceHint)
  ) {
    return { ok: false, error: `consequenceHint 不在允许列表: ${String(consequenceHint)}` };
  }

  const rationale = raw.rationale;
  if (typeof rationale !== "string") {
    return { ok: false, error: "rationale 不是字符串" };
  }

  return {
    ok: true,
    value: {
      difficulty,
      factors,
      stakes,
      consequenceHint: consequenceHint as ConsequenceHint,
      rationale,
    },
  };
}

export interface DmSessionOptions {
  model?: string;
  enabled?: boolean;
}

/** DM 会话：缓存 + 校验 + 回退。 */
export class DmSession {
  private readonly client: ChatClient;
  readonly model: string;
  readonly enabled: boolean;
  private readonly cache = new Map<string, DmResult>();

  constructor(client: ChatClient, options: DmSessionOptions = {}) {
    this.client = client;
    this.model = options.model ?? process.env.DEEPSEEK_MODEL_DM ?? "deepseek-flash";
    this.enabled = options.enabled ?? true;
  }

  clearCache(): void {
    this.cache.clear();
  }

  async propose(
    input: DmInput,
    options: {
      bypassCache?: boolean;
      onTrace?: (event: DmTraceEvent) => void;
    } = {},
  ): Promise<DmResult> {
    const emit = options.onTrace ?? (() => {});
    const key = hashString(canonicalJson(input)).toString(16);
    const cached = this.cache.get(key);
    if (cached && !options.bypassCache) {
      emit({ phase: "cache", result: cached });
      return cached;
    }

    const fallback = (error: string): DmResult => ({
      difficulty: input.baseDifficulty,
      source: "fallback",
      error,
    });

    if (!this.enabled) {
      const result = fallback("DM 已关闭");
      emit({ phase: "fallback", error: result.error as string });
      this.cache.set(key, result);
      return result;
    }

    const messages = buildDmMessages(input);

    try {
      emit({ phase: "request", input, messages });
      const response = await this.client.chat({
        model: this.model,
        messages,
        temperature: 0.3,
        maxTokens: 400,
        responseFormat: "json",
      });
      emit({ phase: "response", content: response.content });

      const parsed = parseJsonObject(response.content);
      const validation = validateDmOutput(parsed, input);
      if (!validation.ok) {
        const error = `DM_INVALID: ${validation.error}`;
        const result = fallback(error);
        emit({ phase: "fallback", error });
        this.cache.set(key, result);
        return result;
      }
      const result: DmResult = {
        difficulty: validation.value.difficulty,
        source: "dm",
        output: validation.value,
      };
      emit({ phase: "valid", output: validation.value });
      this.cache.set(key, result);
      return result;
    } catch (error) {
      const message =
        `DM_FALLBACK: ${error instanceof Error ? error.message : String(error)}`.slice(0, 240);
      const result = fallback(message);
      emit({ phase: "fallback", error: message });
      this.cache.set(key, result);
      return result;
    }
  }
}
