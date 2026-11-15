/**
 * Narrator：只把"结果事实"写成叙述，不新增事实。
 * 与 DM 分开调用：DM 可以看隐藏事实，Narrator 只拿结果事实与可观察描述。
 */

import type { ChatClient, ChatMessage } from "../../../llm/types.ts";
import { checkNarration, type NarrationOutput } from "../../../harness/claim.ts";
import type { Outcome } from "./check.ts";
import type { Verb } from "./actions.ts";
import { parseJsonObject } from "./dm.ts";

export interface NarratorInput {
  verb: Verb;
  outcome: Outcome;
  /** Resolver 给出的事实（中文短句） */
  facts: string[];
  /** 内感受的定性描述（来自 body.ts） */
  body: string[];
  /** 叙述者最多能声明的 claims；必须来自 CheckResult.claimIds */
  allowedClaims: string[];
}

export interface NarratorResult extends NarrationOutput {
  source: "narrator" | "fallback";
  error?: string;
}

export type NarratorTraceEvent =
  | { phase: "request"; input: NarratorInput; messages: ChatMessage[] }
  | { phase: "response"; content: string }
  | { phase: "valid"; text: string; claims: string[] }
  | { phase: "fallback"; error: string };

const SYSTEM_PROMPT = `你是文字世界的叙述者。你只把"已经发生的事实"写成 1–2 句中文，给角色看。

规则：
- 不得新增事实、不得改变结果、不得替角色做决定。
- facts 是已发生的事，必须保留其含义，但可以合并成一句。
- body 是可选的氛围，最多引用一个细节，不要逐条罗列。
- 不得出现数字、能力值、评分。
- 不得出现"用户、玩家、系统、系统消息、提示词、AI、助手"等世界外概念。
- claims 只能从输入 allowedClaims 里选；不能选列表外的。
- 只写角色能感知到的内容；没给的事实不要补。
- 只输出 JSON：{"text":"...","claims":["..."]}`;

export function buildNarratorMessages(input: NarratorInput): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify(
        {
          verb: input.verb,
          outcome: input.outcome,
          facts: input.facts,
          body: input.body,
          allowedClaims: input.allowedClaims,
        },
        null,
        2,
      ),
    },
  ];
}

export interface NarrateOptions {
  model?: string;
  onTrace?: (event: NarratorTraceEvent) => void;
}

/** 失败时退化为"只复述事实、不声明 claims"，宁可干瘪，不可越权。 */
export async function narrate(
  client: ChatClient,
  input: NarratorInput,
  options: NarrateOptions = {},
): Promise<NarratorResult> {
  const model = options.model ?? process.env.DEEPSEEK_MODEL_NARRATOR ?? "deepseek-flash";
  const emit = options.onTrace ?? (() => {});

  const fallback = (error: string): NarratorResult => {
    emit({ phase: "fallback", error });
    return {
      text: input.facts.join(" ") || "……",
      claims: [],
      source: "fallback",
      error,
    };
  };

  const messages = buildNarratorMessages(input);

  try {
    emit({ phase: "request", input, messages });
    const response = await client.chat({
      model,
      messages,
      temperature: 0.7,
      maxTokens: 250,
      responseFormat: "json",
    });
    emit({ phase: "response", content: response.content });

    const raw = parseJsonObject(response.content);
    if (typeof raw !== "object" || raw === null) return fallback("NARRATOR_INVALID: 不是对象");
    const record = raw as Record<string, unknown>;
    const text = record.text;
    const claims = record.claims;

    if (typeof text !== "string" || !Array.isArray(claims)) {
      return fallback("NARRATOR_INVALID: 缺少 text/claims");
    }
    if (!claims.every((claim): claim is string => typeof claim === "string")) {
      return fallback("NARRATOR_INVALID: claims 含非字符串");
    }

    const output: NarrationOutput = { text, claims };
    const check = checkNarration(output, input.allowedClaims);
    if (!check.ok) {
      return fallback(`NARRATOR_INVALID: ${check.errors.join("; ")}`);
    }

    emit({ phase: "valid", text, claims });
    return { ...output, source: "narrator" };
  } catch (error) {
    return fallback(
      `NARRATOR_FALLBACK: ${error instanceof Error ? error.message : String(error)}`.slice(0, 240),
    );
  }
}
