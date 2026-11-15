/**
 * 叙述检查：claims ⊆ 允许的 claims；文本不出现元词/数值/助手腔。
 * 对应 DESIGN §7、EA-16 与 T8 的一部分。
 */

export interface NarrationOutput {
  text: string;
  claims: string[];
}

export interface TextCheck {
  ok: boolean;
  errors: string[];
}

/** 元词：角色/叙述者不应知道这些概念。 */
export const META_TERMS = [
  "用户",
  "玩家",
  "系统",
  "提示词",
  "prompt",
  "assistant",
  "AI",
  // “听到消息”是世界内正常说法；只拦宿主/系统消息这类元概念。
  "系统消息",
  "用户消息",
  "新消息",
  "消息通知",
];

const ASSISTANT_TONE = ["作为AI", "作为 AI", "有什么可以帮", "我可以帮你", "很高兴为你"];

const NUMBER_LEAK =
  /\b\d{1,3}\s*\/\s*100\b|(力量|敏捷|移动|视觉|听觉|言语|耐力|认知|能力值)(是|为|有|只有|大约|约)?\s*[:：]?\s*\d/;

export function scanMeta(text: string): TextCheck {
  const errors: string[] = [];
  for (const term of META_TERMS) {
    if (text.includes(term)) errors.push(`出现元词「${term}」`);
  }
  for (const phrase of ASSISTANT_TONE) {
    if (text.includes(phrase)) errors.push(`出现助手腔「${phrase}」`);
  }
  return { ok: errors.length === 0, errors };
}

export function scanNumbers(text: string): TextCheck {
  const match = NUMBER_LEAK.exec(text);
  return match
    ? { ok: false, errors: [`出现数值泄漏「${match[0]}」`] }
    : { ok: true, errors: [] };
}

/**
 * claims 必须是 allowedClaims 的子集；文本必须非空。
 * 注意：claims 是叙述者"自声明"的状态谓词，不是从自由文本里猜出来的。
 */
export function checkNarration(
  output: NarrationOutput,
  allowedClaims: string[],
): TextCheck {
  const errors: string[] = [];
  const text = output.text?.trim() ?? "";

  if (text.length === 0) errors.push("text 为空");
  if (text.length > 400) errors.push("text 超过 400 字");
  if (!Array.isArray(output.claims)) {
    errors.push("claims 不是数组");
  } else {
    const allowed = new Set(allowedClaims);
    for (const claim of output.claims) {
      if (typeof claim !== "string" || !allowed.has(claim)) {
        errors.push(`claim 不在允许列表: ${String(claim)}`);
      }
    }
  }

  errors.push(...scanMeta(text).errors);
  errors.push(...scanNumbers(text).errors);

  return { ok: errors.length === 0, errors };
}
