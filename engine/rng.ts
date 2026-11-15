/**
 * 种子 RNG。整个项目只允许通过这里取随机数，禁止 Math.random()。
 * mulberry32 + FNV-1a：足够小、足够稳、可回放。
 */

export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
}

export function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed: string | number): Rng {
  let state = typeof seed === "number" ? seed >>> 0 : hashString(seed);
  if (state === 0) state = 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (maxExclusive: number) => Math.floor(next() * maxExclusive),
  };
}

/** 一个 check 的种子：同一 worldSeed + checkId 永远得到同一个 u。 */
export function seedFor(worldSeed: string | number, checkId: number): string {
  return `${worldSeed}:${checkId}`;
}
