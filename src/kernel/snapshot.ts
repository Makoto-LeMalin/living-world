/**
 * 快照与 JSONL 的读写。
 *
 * 字节格式是兼容性契约：
 * - 快照：`JSON.stringify({ version, snapshot }, null, 2)` + 换行
 * - JSONL：每条记录 `JSON.stringify(record)`，行间 `\n`，末尾换行
 *
 * 读的时候只校验信封版本，不解释 snapshot 的内部结构。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface SnapshotEnvelope<T> {
  version: number;
  snapshot: T;
}

export function writeSnapshotFile<T>(path: string, snapshot: T, version = 1): void {
  mkdirSync(dirname(path), { recursive: true });
  const envelope: SnapshotEnvelope<T> = { version, snapshot };
  writeFileSync(path, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}

export function readSnapshotFile<T>(path: string, expectedVersion = 1): T {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SnapshotEnvelope<T>>;
  if (parsed.version !== expectedVersion) {
    throw new Error(`未知快照版本: ${String(parsed.version)}（期望 ${expectedVersion}）`);
  }
  if (parsed.snapshot === undefined) throw new Error("快照缺少 snapshot 字段");
  return parsed.snapshot;
}

export function writeJsonLines<T>(path: string, records: readonly T[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const text = records.map((record) => JSON.stringify(record)).join("\n");
  writeFileSync(path, `${text}\n`, "utf8");
}

export function readJsonLines<T>(path: string, label = "JSONL"): T[] {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as T;
    } catch (error) {
      throw new Error(`${label} 第 ${index + 1} 行非法: ${String(error)}`);
    }
  });
}
