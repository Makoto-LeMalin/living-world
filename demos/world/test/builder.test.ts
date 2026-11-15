import test from "node:test";
import assert from "node:assert/strict";

import { canonicalJson } from "../../../src/kernel/canonical-json.ts";
import { buildWorld, defaultConfig, loadCanon, validateCanon } from "../src/world/canon.ts";
import { World } from "../src/world/world.ts";
import { checkCanonInvariants, checkWorldInvariants } from "../src/world/invariants.ts";

test("canon 有 12 房间 / 10 NPC / 2 群体，且手写结构通过", () => {
  const canon = loadCanon();
  assert.equal(canon.rooms.length, 12);
  assert.equal(canon.characters.length, 10);
  assert.equal(canon.crowds.length, 2);
  assert.equal(canon.routes.length, 3);
  const report = checkCanonInvariants(canon);
  assert.equal(report.ok, true, report.errors.join("\n"));
});

test("20 个 seed 的 builder 不变量全过", () => {
  const canon = loadCanon();
  for (let seed = 1; seed <= 20; seed++) {
    const world = new World(buildWorld(canon, defaultConfig(String(seed))));
    const report = checkWorldInvariants(world);
    assert.equal(report.ok, true, `seed ${seed}: ${report.errors.join("\n")}`);
  }
});

test("同一 seed 的 builder 完全确定", () => {
  const canon = loadCanon();
  const a = buildWorld(canon, defaultConfig("7"));
  const b = buildWorld(canon, defaultConfig("7"));
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test("不同 seed 会参数化价格/库存/情绪，而不是换拓扑", () => {
  const canon = loadCanon();
  const a = buildWorld(canon, defaultConfig("7"));
  const b = buildWorld(canon, defaultConfig("8"));
  assert.deepEqual(a.rooms.map((room) => room.id), b.rooms.map((room) => room.id));
  assert.notDeepEqual(a.prices, b.prices);
  assert.notDeepEqual(
    a.characters.map((character) => character.mood),
    b.characters.map((character) => character.mood),
  );
});

test("每个 NPC 的日程覆盖整天且不重叠", () => {
  const canon = loadCanon();
  for (const character of canon.characters) {
    const blocks = [...character.schedule].sort((a, b) => a.startTick - b.startTick);
    let cursor = 0;
    for (const block of blocks) {
      assert.equal(block.startTick, cursor, `${character.id} 日程不连续`);
      assert.ok(block.endTick > block.startTick, `${character.id} 空日程`);
      cursor = block.endTick;
    }
    assert.equal(cursor, canon.ticksPerDay, `${character.id} 日程没有覆盖整天`);
  }
});

test("损坏的 canon 会被 builder 拒绝", () => {
  const canon = structuredClone(loadCanon());
  canon.rooms[0].exits.push("room_not_exist");
  assert.throws(() => validateCanon(canon), /未知出口/);
});

test("出口互逆、路线端点合法、库存非负", () => {
  const canon = loadCanon();
  const roomIds = new Set(canon.rooms.map((room) => room.id));
  for (const room of canon.rooms) {
    for (const exit of room.exits) {
      assert.ok(roomIds.has(exit));
      const back = canon.rooms.find((candidate) => candidate.id === exit);
      assert.ok(back?.exits.includes(room.id), `${room.id} <-> ${exit} 不互逆`);
    }
  }
  for (const route of canon.routes) {
    assert.ok(roomIds.has(route.fromRoomId));
    assert.ok(roomIds.has(route.toRoomId));
  }
  for (const stock of Object.values(canon.stocks)) {
    for (const amount of Object.values(stock)) assert.ok((amount ?? 0) >= 0);
  }
});

test("同一个 WorldState 的 projectionHash 稳定", () => {
  const canon = loadCanon();
  const world = new World(buildWorld(canon, defaultConfig("11")));
  const clone = structuredClone(world.state);
  assert.equal(new World(clone).projectionHash(), world.projectionHash());
});
