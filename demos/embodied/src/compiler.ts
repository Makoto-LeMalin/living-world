/**
 * V3 Action Compiler：把自由动作编译成 14 维需求。
 *
 * 关键约束：
 * - 默认盲于角色能力/身体（blind），只判断"动作在物理上要求什么"；
 * - 只允许 12 个维度；不对 family 做包络校验（family 由需求推导，不由 LLM 选择）；
 * - 失败不猜：返回 ok=false，由调用方决定回退。
 *
 * aware 是消融模式：允许看到能力值，用来测"需求会不会被角色能力带偏"。
 */

import type { ChatClient, ChatMessage } from "../../../llm/types.ts";
import { canonicalJson } from "../../../engine/json.ts";
import { hashString } from "../../../engine/rng.ts";
import { parseJsonObject } from "./dm.ts";
import {
  isValidOntologyTag,
  normalizeOntologyTags,
} from "./ontology.ts";
import type { ActionDemand, Family } from "./v2/demand.ts";
import { classifyDemand } from "./v2/demand.ts";
import { DIMS, type Dim } from "./v2/dimensions.ts";

export type CompilerArm = "blind" | "aware";

export interface CompilerAction {
  id: string;
  description: string;
  target?: string;
  instrument?: string;
  manner?: string;
  environment?: string;
  expectedFamily?: Family;
  expectedFamilies?: Family[];
}

export interface CompilerCharacter {
  capabilities: Record<string, number>;
  constraints: string[];
}

export interface CompilerInput extends CompilerAction {
  arm: CompilerArm;
  character?: CompilerCharacter;
}

export interface CompilerOutput extends ActionDemand {
  verdict: "action";
  confidence: number;
  notes?: string;
  /** 社交/攻击/防御等意图标签；不参与物理判定 */
  intentTags?: string[];
}

export interface CompileResult {
  ok: boolean;
  output?: CompilerOutput;
  raw: string;
  model: string;
  error?: string;
}

const BASE_PROMPT = `你是文字世界的动作编译器（Action Compiler）。把一句自由动作编译成 ActionDemand。

你只判断这个动作在物理上要求什么，不判断是否成功，也不看执行者的身体或能力。

维度（只能使用这些）：
reach 够得到, grasp 抓得住, precision 精细操作, force 发力, mobility 位移,
balance 平衡, breath 呼吸, voice 发声, sight 视觉, hearing 听觉,
smell 嗅觉, touch 触觉, cognition 注意/判断, endurance 持续。

规则：
- dims 是硬需求：缺了就完全做不到；assist 是辅助：缺了只是更吃力/更慢/更容易出错。
- dims 尽量少而准：能放进 assist 的就不要放进 dims。
- cognition / balance / endurance / breath 通常是 assist；只有动作本身就是思考、平衡、持续或屏息时才放进 dims。
- 强度 0..1：0.2 轻微，0.4 明显，0.6 高，0.8 很高，1.0 极致。
- durationTicks 1..30；noise 0..1；confidence 0..1。
- 一个动作至少有 dims 或 assist 中的一项。
- 多通道动作可以同时需要多个维度（例如边走边喊 = mobility + voice），不要硬选一个类别。
- 不要判断动作是否可能。若动作依赖世界可能不存在的能力（意念、时间、神术、超自然），
  把这些依赖放进 ontologyTags（psychic / temporal / divine / metaphysical…）；
  这时 dims 可以为空，但 ontologyTags 必须非空。世界规则会决定它是否成立。
- intentTags 是可选的意图标签（social / attack / defend / deceive / hide / give…），不参与物理判定。
- 不要输出角色能力、身体状态、判定结果、family 或解释性长文。

例子：
- 用牙叼起炭笔：dims {grasp:0.3}，assist {sight:0.2, balance:0.1, cognition:0.1}
- 借门缝的光认字：dims {sight:0.6}，assist {cognition:0.4}
- 隔着门低声求人：dims {voice:0.4}，assist {cognition:0.3, hearing:0.2}
- 把血抹在墙上：dims {reach:0.4, precision:0.2}，assist {sight:0.2}
- 用肩膀撞门：dims {force:0.7, mobility:0.2}，assist {balance:0.2}

只输出这个 JSON：
{"verdict":"action","label":"...","intentTags":["social"],"ontologyTags":[],"dims":{"grasp":0.4},"assist":{"sight":0.2},"durationTicks":1,"noise":0.1,"confidence":0.8,"notes":"一句话"}`;

const AWARE_NOTE = `

消融模式：你还会看到执行者当前的能力值与约束。请按这个执行者来估计需求强度；
仍然只输出同样的 JSON，不输出判定结果。`;

export function buildCompilerMessages(input: CompilerInput): ChatMessage[] {
  const system =
    input.arm === "aware" ? `${BASE_PROMPT}\n${AWARE_NOTE}` : BASE_PROMPT;

  const payload: Record<string, unknown> = {
    action: {
      description: input.description,
      target: input.target,
      instrument: input.instrument,
      manner: input.manner,
      environment: input.environment,
    },
  };
  if (input.arm === "aware" && input.character) {
    payload.character = input.character;
  }

  return [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(payload, null, 2) },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWeights(
  raw: unknown,
  field: "dims" | "assist",
): { ok: true; value: Partial<Record<Dim, number>> } | { ok: false; error: string } {
  if (raw === undefined && field === "assist") return { ok: true, value: {} };
  if (!isRecord(raw)) return { ok: false, error: `${field} 不是对象` };

  const value: Partial<Record<Dim, number>> = {};
  for (const [key, weight] of Object.entries(raw)) {
    if (!DIMS.includes(key as Dim)) {
      return { ok: false, error: `${field} 含未知维度 ${key}` };
    }
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 1) {
      return { ok: false, error: `${field}.${key} 越界: ${String(weight)}` };
    }
    if (weight > 0) value[key as Dim] = weight;
  }
  return { ok: true, value };
}

export type CompilerValidation =
  | { ok: true; output: CompilerOutput }
  | { ok: false; error: string };

export function validateCompilerOutput(raw: unknown): CompilerValidation {
  if (!isRecord(raw)) return { ok: false, error: "输出不是对象" };

  for (const forbidden of [
    "capability",
    "capabilities",
    "body",
    "success",
    "outcome",
    "difficulty",
    "feasible",
  ]) {
    if (forbidden in raw) return { ok: false, error: `输出包含禁止字段 ${forbidden}` };
  }

  // 撤回 reject 之后，任何非 action 的 verdict 都不再接受；缺失则兼容旧测试。
  if ("verdict" in raw && raw.verdict !== "action") {
    return { ok: false, error: `verdict 只能是 action，收到 ${String(raw.verdict)}` };
  }

  const dims = readWeights(raw.dims, "dims");
  if (!dims.ok) return dims;
  const assist = readWeights(raw.assist, "assist");
  if (!assist.ok) return assist;

  const overlap = Object.keys(dims.value).filter((key) => key in assist.value);
  if (overlap.length > 0) {
    return { ok: false, error: `dims 与 assist 不能重叠: ${overlap.join(", ")}` };
  }

  const ontologyTags = raw.ontologyTags;
  if (ontologyTags !== undefined) {
    if (!Array.isArray(ontologyTags) || ontologyTags.length > 6) {
      return { ok: false, error: "ontologyTags 必须是 ≤6 的数组" };
    }
    if (!ontologyTags.every((tag): tag is string => typeof tag === "string")) {
      return { ok: false, error: "ontologyTags 含非字符串" };
    }
    for (const tag of ontologyTags) {
      const normalized = tag.trim().toLowerCase();
      if (normalized.length === 0 || normalized.length > 24 || !isValidOntologyTag(normalized)) {
        return { ok: false, error: `ontologyTags 含非法标签: ${JSON.stringify(tag)}` };
      }
    }
  }
  const rawTags = (ontologyTags ?? []) as string[];
  const tags = normalizeOntologyTags(rawTags);
  if (tags.length !== rawTags.length) {
    return { ok: false, error: "ontologyTags 含重复标签" };
  }

  const total =
    Object.values(dims.value).reduce((sum, value) => sum + value, 0) +
    Object.values(assist.value).reduce((sum, value) => sum + value, 0);
  if (total <= 0 && tags.length === 0) {
    return { ok: false, error: "dims/assist 与 ontologyTags 都为空" };
  }

  const label = raw.label;
  if (typeof label !== "string" || label.trim().length === 0 || label.length > 60) {
    return { ok: false, error: "label 为空或过长" };
  }

  const durationTicks = raw.durationTicks;
  if (
    typeof durationTicks !== "number" ||
    !Number.isInteger(durationTicks) ||
    durationTicks < 1 ||
    durationTicks > 30
  ) {
    return { ok: false, error: `durationTicks 非法: ${String(durationTicks)}` };
  }

  const noise = raw.noise;
  if (typeof noise !== "number" || !Number.isFinite(noise) || noise < 0 || noise > 1) {
    return { ok: false, error: `noise 非法: ${String(noise)}` };
  }

  const confidence = raw.confidence;
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    return { ok: false, error: `confidence 非法: ${String(confidence)}` };
  }

  const notes = raw.notes;
  if (notes !== undefined && typeof notes !== "string") {
    return { ok: false, error: "notes 不是字符串" };
  }
  if (typeof notes === "string" && notes.length > 500) {
    return { ok: false, error: "notes 过长（>500）" };
  }

  let intentTags: string[] | undefined;
  if (raw.intentTags !== undefined) {
    if (!Array.isArray(raw.intentTags) || raw.intentTags.length > 6) {
      return { ok: false, error: "intentTags 必须是 ≤6 的数组" };
    }
    const cleaned = raw.intentTags.map((tag) =>
      typeof tag === "string" ? tag.trim().toLowerCase() : "",
    );
    if (cleaned.some((tag) => tag.length === 0 || tag.length > 20)) {
      return { ok: false, error: "intentTags 含非法字符串" };
    }
    if (new Set(cleaned).size !== cleaned.length) {
      return { ok: false, error: "intentTags 含重复标签" };
    }
    intentTags = cleaned;
  }

  const demand: ActionDemand = {
    label: label.trim(),
    dims: dims.value,
    assist: assist.value,
    ...(tags.length === 0 ? {} : { ontologyTags: tags }),
    durationTicks,
    noise,
  };

  return {
    ok: true,
    output: {
      verdict: "action",
      ...demand,
      family: classifyDemand(demand),
      confidence,
      ...(notes === undefined ? {} : { notes }),
      ...(intentTags === undefined ? {} : { intentTags }),
    },
  };
}

export interface CompilerOptions {
  model?: string;
  bypassCache?: boolean;
}

export interface CompilerTraceEvent {
  phase: "request" | "response" | "valid" | "fallback" | "cache";
  input?: CompilerInput;
  content?: string;
  output?: CompilerOutput;
  error?: string;
}

export class CompilerSession {
  private readonly client: ChatClient;
  readonly model: string;
  private readonly cache = new Map<string, CompileResult>();

  constructor(client: ChatClient, options: { model?: string } = {}) {
    this.client = client;
    this.model = options.model ?? process.env.DEEPSEEK_MODEL_DM ?? "deepseek-flash";
  }

  clearCache(): void {
    this.cache.clear();
  }

  async compile(
    input: CompilerInput,
    options: CompilerOptions & { onTrace?: (event: CompilerTraceEvent) => void } = {},
  ): Promise<CompileResult> {
    const emit = options.onTrace ?? (() => {});
    const key = hashString(canonicalJson(input)).toString(16);
    const cached = this.cache.get(key);
    if (cached && !options.bypassCache) {
      emit({ phase: "cache", input, output: cached.output, error: cached.error });
      return cached;
    }

    const messages = buildCompilerMessages(input);

    try {
      emit({ phase: "request", input });
      const response = await this.client.chat({
        model: this.model,
        messages,
        temperature: 0.2,
        maxTokens: 500,
        responseFormat: "json",
      });
      emit({ phase: "response", content: response.content });

      const parsed = parseJsonObject(response.content);
      const validation = validateCompilerOutput(parsed);
      if (!validation.ok) {
        const result: CompileResult = {
          ok: false,
          raw: response.content,
          model: response.model,
          error: `COMPILER_INVALID: ${validation.error}`,
        };
        emit({ phase: "fallback", error: result.error });
        this.cache.set(key, result);
        return result;
      }

      const result: CompileResult = {
        ok: true,
        output: validation.output,
        raw: response.content,
        model: response.model,
      };
      emit({ phase: "valid", output: validation.output });
      this.cache.set(key, result);
      return result;
    } catch (error) {
      const message =
        `COMPILER_FALLBACK: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          240,
        );
      const result: CompileResult = {
        ok: false,
        raw: "",
        model: this.model,
        error: message,
      };
      emit({ phase: "fallback", error: message });
      this.cache.set(key, result);
      return result;
    }
  }
}
