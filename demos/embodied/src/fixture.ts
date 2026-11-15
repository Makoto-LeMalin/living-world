import { readFileSync } from "node:fs";

import type { Body } from "./body.ts";

export interface Fixture extends Body {
  id?: string;
  name?: string;
}

/** 读取手写 fixture（demos/embodied/fixtures/<name>.json）。 */
export function loadFixture(name = "akha"): Fixture {
  const url = new URL(`../fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Fixture;
}
