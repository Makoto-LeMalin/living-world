/**
 * 项目级 RNG 入口。
 *
 * 基础算法在 `engine/rng.ts`（内核的依赖，不是反向依赖）；这里补上
 * “同一 worldSeed + 用途 + 参与键 → 同一随机流”的分流语义。
 * 规则层只允许使用这里的 API，禁止 Math.random()。
 */

import { makeRng, type Rng } from "../../engine/rng.ts";

export { hashString, makeRng, seedFor, type Rng } from "../../engine/rng.ts";

/** 独立 RNG 流：同一 seed + 用途 + 参与键永远得到同一序列。 */
export function stream(seed: string | number, ...parts: Array<string | number>): Rng {
  return makeRng([String(seed), ...parts.map(String)].join("|"));
}

export function roll(seed: string | number, ...parts: Array<string | number>): number {
  return stream(seed, ...parts).next();
}

export function chance(seed: string | number, probability: number, ...parts: Array<string | number>): boolean {
  return roll(seed, ...parts) < probability;
}

export function pick<T>(seed: string | number, items: readonly T[], ...parts: Array<string | number>): T {
  if (items.length === 0) throw new Error("pick 需要至少一个元素");
  return items[stream(seed, ...parts).int(items.length)];
}
