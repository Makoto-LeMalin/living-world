import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InvariantBuilder, duplicateIds } from "../harness/invariant.ts";
import { verifyReplays } from "../harness/replay.ts";
import { hashCanonical } from "../src/kernel/canonical-json.ts";
import { formatId, parseId } from "../src/kernel/ids.ts";
import { pick, roll, stream } from "../src/kernel/rng.ts";
import {
  readJsonLines,
  readSnapshotFile,
  writeJsonLines,
  writeSnapshotFile,
} from "../src/kernel/snapshot.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "lw-kernel-"));
}

test("ID 格式固定：事件 6 位、事实/痕迹 5 位", () => {
  assert.equal(formatId("e", 1, 6), "e_000001");
  assert.equal(formatId("f", 42, 5), "f_00042");
  assert.deepEqual(parseId("p_00123"), { prefix: "p", value: 123 });
  assert.equal(parseId("not-an-id"), undefined);
  assert.throws(() => formatId("x", -1, 3), /整数/);
  assert.throws(() => formatId("x", 1.5, 3), /整数/);
});

test("RNG 流由 seed + 用途 + 参与键决定，且相互独立", () => {
  const firstA = stream("7", "witness", 1, "npc").next();
  assert.equal(stream("7", "witness", 1, "npc").next(), firstA);

  const first = roll("7", "fire", 12);
  assert.equal(roll("7", "fire", 12), first);
  assert.notEqual(roll("8", "fire", 12), first);
  assert.notEqual(roll("7", "fire", 13), first);
  assert.ok(first >= 0 && first < 1);
  assert.throws(() => pick("7", []), /至少一个/);
});

test("规范化哈希对键顺序不敏感", () => {
  assert.equal(hashCanonical({ a: 1, b: [2, 3] }), hashCanonical({ b: [2, 3], a: 1 }));
  assert.notEqual(hashCanonical({ a: 1 }), hashCanonical({ a: 2 }));
  assert.equal(hashCanonical({ a: 1 }, 4).length, 4);
});

test("快照文件保持既有信封字节格式", () => {
  const dir = tempDir();
  try {
    const path = join(dir, "snapshot.json");
    writeSnapshotFile(path, { tick: 3, rooms: ["a"] });
    const text = readFileSync(path, "utf8");
    assert.ok(text.endsWith("\n"));
    assert.equal(text, `${JSON.stringify({ version: 1, snapshot: { tick: 3, rooms: ["a"] } }, null, 2)}\n`);
    assert.deepEqual(readSnapshotFile(path), { tick: 3, rooms: ["a"] });
    assert.throws(() => readSnapshotFile(path, 2), /未知快照版本/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("JSONL 往返保留顺序；坏行报行号", () => {
  const dir = tempDir();
  try {
    const path = join(dir, "events.jsonl");
    writeJsonLines(path, [{ id: "e_1" }, { id: "e_2" }]);
    assert.equal(readFileSync(path, "utf8"), '{"id":"e_1"}\n{"id":"e_2"}\n');
    assert.deepEqual(readJsonLines<{ id: string }>(path), [{ id: "e_1" }, { id: "e_2" }]);

    const bad = join(dir, "bad.jsonl");
    writeFileSync(bad, '{"id":"e_1"}\nnot json\n', "utf8");
    assert.throws(() => readJsonLines(bad, "事件日志"), /事件日志 第 2 行非法/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("回放签名：一致通过，分叉失败", () => {
  assert.equal(verifyReplays([{ id: "a" }, { id: "a" }]).ok, true);
  const mismatch = verifyReplays([{ id: "a" }, { id: "b" }]);
  assert.equal(mismatch.ok, false);
  assert.notEqual(mismatch.hashes[0], mismatch.hashes[1]);
});

test("不变量容器计数并收集错误", () => {
  const builder = new InvariantBuilder();
  builder.check(true, "ok");
  builder.check(false, "bad");
  builder.checkEqual(1, 2, "数值");
  const report = builder.report();
  assert.equal(report.checks, 3);
  assert.equal(report.ok, false);
  assert.equal(report.errors.length, 2);
  assert.deepEqual(duplicateIds(["a", "b", "a", "c", "b"]), ["a", "b"]);
});
