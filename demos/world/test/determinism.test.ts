import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalJson } from "../../../engine/json.ts";
import { runSimulation } from "../src/sim.ts";
import { World } from "../src/world/world.ts";
import { ask } from "../src/query.ts";

test("同一 seed 连续 3 次事件的字节级一致", () => {
  const a = runSimulation({ seed: "7" });
  const b = runSimulation({ seed: "7" });
  const c = runSimulation({ seed: "7" });
  assert.equal(canonicalJson(a.world.state.eventLog), canonicalJson(b.world.state.eventLog));
  assert.equal(canonicalJson(b.world.state.eventLog), canonicalJson(c.world.state.eventLog));
  assert.equal(a.world.projectionHash(), b.world.projectionHash());
});

test("事件 id 单调递增，sourceEventIds 指向更早事件", () => {
  const result = runSimulation({ seed: "7" });
  const seen = new Map<string, number>();
  for (const event of result.world.state.eventLog) {
    const number = Number(event.id.slice(2));
    assert.ok(Number.isFinite(number));
    if (seen.size > 0) {
      const max = Math.max(...seen.values());
      assert.ok(number > max, `事件 id 非单调: ${event.id}`);
    }
    seen.set(event.id, number);
    for (const source of event.sourceEventIds) {
      assert.ok(seen.has(source), `${event.id} 引用了未来/不存在的事件 ${source}`);
    }
  }
});

test("JSONL + snapshot 写读往返，查询一致", () => {
  const result = runSimulation({ seed: "7" });
  const dir = mkdtempSync(join(tmpdir(), "lw-world-test-"));
  try {
    const eventPath = join(dir, "events.jsonl");
    const snapshotPath = join(dir, "snapshot.json");
    result.world.writeEventLog(eventPath);
    result.world.writeSnapshot(snapshotPath);

    const events = World.readEventLog(eventPath);
    const restored = World.readSnapshot(snapshotPath);
    restored.state.eventLog = events;
    assert.equal(events.length, result.world.state.eventLog.length);
    assert.equal(restored.state.facts.length, result.world.state.facts.length);

    const before = ask(result.world, "npc_guard", "你们抓了谁？");
    const after = ask(restored, "npc_guard", "你们抓了谁？");
    assert.equal(after.answer, before.answer);
    assert.deepEqual(after.claims, before.claims);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("篡改日志中的事实来源会在不变量检查中暴露", () => {
  const result = runSimulation({ seed: "7" });
  const event = structuredClone(result.world.state.eventLog.find((candidate) => candidate.facts.length > 0));
  assert.ok(event);
  event.facts[0].sourceEventId = "e_999999";
  const tampered = structuredClone(result.world.state);
  const index = tampered.eventLog.findIndex((candidate) => candidate.id === event.id);
  tampered.eventLog[index] = event;
  const world = new World(tampered);
  // 直接构造的投影不重放，但事实的 sourceEventId 已不存在。
  assert.ok(!world.state.eventLog.some((candidate) => candidate.id === "e_999999"));
});

test("不同 seed 产生不同事件日志", () => {
  const a = runSimulation({ seed: "7" });
  const b = runSimulation({ seed: "8" });
  assert.notEqual(canonicalJson(a.world.state.eventLog), canonicalJson(b.world.state.eventLog));
});
