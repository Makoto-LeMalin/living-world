/**
 * check 日志与回放（A1）。
 *
 * 每条 check 记录完整输入（含身体快照）与输出，回放时不调用 LLM、不重掷骰，
 * 直接用同样的 seed/checkId 重算并逐字段比对。这样：
 * - 失败可复现；
 * - E1/校准可以离线重跑；
 * - 日志本身是"发生过什么"的证据。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { CheckEnv, Verb } from "./actions.ts";
import type { Body } from "./body.ts";
import { evaluateCheck, type CheckResult } from "./check.ts";
import { hashString } from "../../../engine/rng.ts";
import { canonicalJson } from "../../../engine/json.ts";

export interface LoggedCheckInput {
  body: Body;
  verb: Verb;
  manner?: string;
  env?: CheckEnv;
  difficulty?: number;
  seed: string | number;
  checkId: number;
}

export interface LlmTraceEntry {
  dm?: { difficulty: number; source: string; error?: string };
  narration?: { text: string; claims: string[]; source: string; error?: string };
}

export interface CheckLogEntry {
  kind: "check";
  seq: number;
  scene: string;
  beatId: string;
  tick: number;
  bodyHash: string;
  input: LoggedCheckInput;
  result: CheckResult;
  /** 仅 LLM 场景写入；回放不重算，但保留审计 */
  llm?: LlmTraceEntry;
}

export interface EventLogEntry {
  kind: "event";
  seq: number;
  scene: string;
  beatId: string;
  tick: number;
  text: string;
}

export type LogEntry = CheckLogEntry | EventLogEntry;

/** 规范化 JSON：对象键排序，保证同一身体得到同一 hash。 */
export function bodyHash(body: Body): string {
  return hashString(canonicalJson(body)).toString(16).padStart(8, "0");
}

export function writeLog(path: string, entries: LogEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const text = entries.map((entry) => JSON.stringify(entry)).join("\n");
  writeFileSync(path, `${text}\n`, "utf8");
}

export function readLog(path: string): LogEntry[] {
  const lines = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as LogEntry;
    } catch (error) {
      throw new Error(`第 ${index + 1} 行不是合法 JSON: ${String(error)}`);
    }
  });
}

export interface ReplayReport {
  ok: boolean;
  checks: number;
  errors: string[];
}

function diffValues(a: unknown, b: unknown, path: string): string | undefined {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= 1e-9 ? undefined : `${path}: ${a} !== ${b}`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: 长度 ${a.length} !== ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = diffValues(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return undefined;
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
    for (const key of keys) {
      const d = diffValues(ra[key], rb[key], path ? `${path}.${key}` : key);
      if (d) return d;
    }
    return undefined;
  }
  return a === b ? undefined : `${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
}

/**
 * 回放：逐条重算 check，与日志比对。
 * 事件记录只校验 seq 单调，不参与重算。
 */
export function replayLog(entries: LogEntry[]): ReplayReport {
  const errors: string[] = [];
  let checks = 0;
  let lastSeq = -1;

  for (const entry of entries) {
    if (entry.seq <= lastSeq) errors.push(`seq 非单调: ${entry.seq} <= ${lastSeq}`);
    lastSeq = entry.seq;

    if (entry.kind !== "check") continue;
    checks++;

    const expectedHash = bodyHash(entry.input.body);
    if (entry.bodyHash !== expectedHash) {
      errors.push(`${entry.beatId}: bodyHash ${entry.bodyHash} !== ${expectedHash}`);
      continue;
    }

    const result = evaluateCheck(entry.input);
    const d = diffValues(entry.result, result, `${entry.beatId}.result`);
    if (d) errors.push(d);
  }

  return { ok: errors.length === 0, checks, errors };
}
