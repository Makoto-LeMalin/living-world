/**
 * 回放校验：同一事件序列必须得到同一签名。
 * 只依赖规范化 JSON；不依赖世界类型。
 */

import { canonicalJson } from "../engine/json.ts";

export function eventSignature(events: unknown): string {
  return canonicalJson(events);
}

export interface ReplayVerifyResult {
  ok: boolean;
  hashes: string[];
}

export function verifyReplays(eventsList: readonly unknown[]): ReplayVerifyResult {
  const hashes = eventsList.map(eventSignature);
  const ok = hashes.every((hash) => hash === hashes[0]);
  return { ok, hashes };
}
