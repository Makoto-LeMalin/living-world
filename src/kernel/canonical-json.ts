/**
 * 规范化 JSON 与哈希。
 *
 * `canonicalJson` 的实现在 engine；这里是对领域层暴露的稳定入口，
 * 另加“规范化后取 32 位哈希”的常用组合。
 */

import { canonicalJson } from "../../engine/json.ts";
import { hashString } from "../../engine/rng.ts";

export { canonicalJson } from "../../engine/json.ts";

/** 规范化后取 32 位哈希；默认 8 位十六进制，用于投影/全量哈希。 */
export function hashCanonical(value: unknown, width = 8): string {
  if (!Number.isInteger(width) || width <= 0 || width > 8) {
    throw new Error(`哈希宽度必须是 1..8 的整数，收到 ${String(width)}`);
  }
  return hashString(canonicalJson(value)).toString(16).padStart(8, "0").slice(0, width);
}
