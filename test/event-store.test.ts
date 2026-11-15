import test from "node:test";
import assert from "node:assert/strict";

import { buildWorld, defaultConfig, loadCanon } from "../demos/world/src/world/canon.ts";
import { World } from "../demos/world/src/world/world.ts";
import { EventStore } from "../src/world/event-store.ts";
import { replayProjection } from "../src/world/projection.ts";

test("EventStore 只追加，保持顺序并可按 id 查找", () => {
  const store = new EventStore<{ id: string; tick: number; type: string }>();
  store.append({ id: "e_000001", tick: 0, type: "A" });
  store.append({ id: "e_000002", tick: 1, type: "B" });

  assert.equal(store.length, 2);
  assert.equal(store.last()?.id, "e_000002");
  assert.deepEqual(store.all().map((event) => event.id), ["e_000001", "e_000002"]);
  assert.equal(store.find("e_000001")?.type, "A");
  assert.deepEqual([...store.ids()], ["e_000001", "e_000002"]);
});

test("投影按事件顺序消费，返回处理条数", () => {
  const seen: string[] = [];
  const count = replayProjection(
    { apply: (event: { id: string }) => seen.push(event.id) },
    [{ id: "e_1" }, { id: "e_2" }, { id: "e_3" }],
  );
  assert.equal(count, 3);
  assert.deepEqual(seen, ["e_1", "e_2", "e_3"]);
});

test("World.emit 经 EventStore 追加，日志与 store 是同一序列", () => {
  const world = new World(buildWorld(loadCanon(), defaultConfig("7")));
  const before = world.events.length;
  const event = world.emit({
    type: "TestEvent",
    roomId: "market_square",
    visibility: "private",
    payload: {},
    provenance: { source: "system", ruleVersion: "test" },
  });

  assert.equal(world.events.length, before + 1);
  assert.equal(world.events.last()?.id, event.id);
  assert.equal(world.state.eventLog.at(-1)?.id, event.id);
  assert.equal(world.events.all(), world.state.eventLog);
  assert.equal(event.id, `e_${String(before + 1).padStart(6, "0")}`);
});
