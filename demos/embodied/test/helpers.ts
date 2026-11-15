import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

import type { Body } from "../src/body.ts";

export function loadAkha(): Body {
  const url = new URL("../fixtures/akha.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Body;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function close(actual: number, expected: number, tolerance = 0.6, label = "value"): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ±${tolerance}, got ${actual}`,
  );
}
