import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bodyHash, readLog, replayLog, writeLog, type CheckLogEntry } from "../src/log.ts";
import { runTabletNight } from "../src/scenario.ts";
import { clone, loadAkha } from "./helpers.ts";

test("日志写读往返，回放通过", () => {
  const dir = mkdtempSync(join(tmpdir(), "lw-log-"));
  const path = join(dir, "tablet-night.jsonl");

  try {
    const run = runTabletNight("7");
    writeLog(path, run.entries);

    const entries = readLog(path);
    assert.equal(entries.length, run.entries.length);
    assert.equal(entries[0].seq, 1);

    const report = replayLog(entries);
    assert.equal(report.ok, true, report.errors.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("篡改结果会被回放发现", () => {
  const entries = structuredClone(runTabletNight("42").entries);
  const first = entries.find((entry) => entry.kind === "check") as CheckLogEntry;
  first.result.roll = (first.result.roll ?? 0) + 0.1;

  const report = replayLog(entries);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes("roll")));
});

test("篡改身体快照会被 hash 发现", () => {
  const entries = structuredClone(runTabletNight("42").entries);
  const first = entries.find((entry) => entry.kind === "check") as CheckLogEntry;
  first.input.body.parts.leftArm.pain = 99;

  const report = replayLog(entries);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes("bodyHash")));
});

test("bodyHash 对键顺序不敏感", () => {
  const body = loadAkha();
  const reversed = Object.fromEntries(Object.entries(body).reverse()) as typeof body;
  assert.equal(bodyHash(body), bodyHash(reversed));
});

test("身体变化会改变 bodyHash", () => {
  const body = clone(loadAkha());
  const before = bodyHash(body);
  body.parts.leftArm.pain = 99;
  assert.notEqual(bodyHash(body), before);
});
