import test from "node:test";
import assert from "node:assert/strict";

import { Space } from "../src/space/index.ts";

const rooms = [
  { id: "market_square", placeId: "market", exits: ["square_well"], light: "bright" as const },
  { id: "square_well", placeId: "market", exits: ["market_square"], light: "dim" as const },
  { id: "alley", placeId: "market", exits: ["market_square"], light: "dark" as const },
  { id: "wharf", placeId: "wharf", exits: [], light: "bright" as const },
];

const routes = [
  { id: "r_market_alley", fromRoomId: "market_square", toRoomId: "alley" },
  { id: "r_market_wharf", fromRoomId: "market_square", toRoomId: "wharf" },
];

function space(): Space<(typeof rooms)[number], (typeof routes)[number]> {
  return new Space(rooms, routes);
}

test("房间/聚落查询保留 canon 顺序", () => {
  const s = space();
  assert.equal(s.room("market_square").placeId, "market");
  assert.equal(s.placeOfRoom("alley"), "market");
  assert.deepEqual(s.roomsInPlace("market").map((room) => room.id), ["market_square", "square_well", "alley"]);
  assert.deepEqual(s.roomsInPlace("nowhere"), []);
  assert.throws(() => s.room("nowhere"), /未知房间/);
});

test("重复房间 id 在装配时失败", () => {
  assert.throws(
    () => new Space([{ id: "a", placeId: "p" }, { id: "a", placeId: "p" }], []),
    /重复房间 id/,
  );
});

test("可见范围：private 空、room 单间、place/public 同聚落", () => {
  const s = space();
  assert.deepEqual(s.scopeRoomIds("private", "market_square"), []);
  assert.deepEqual(s.scopeRoomIds("room", "market_square"), ["market_square"]);
  assert.deepEqual(s.scopeRoomIds("place", "alley"), ["market_square", "square_well", "alley"]);
  assert.deepEqual(s.scopeRoomIds("public", "market_square"), ["market_square", "square_well", "alley"]);
  assert.deepEqual(s.scopeRoomIds("place", "wharf"), ["wharf"]);
});

test("路线双向可查，邻接去重", () => {
  const s = space();
  assert.equal(s.routeBetween("market_square", "alley")?.id, "r_market_alley");
  assert.equal(s.routeBetween("alley", "market_square")?.id, "r_market_alley");
  assert.equal(s.routeBetween("alley", "wharf"), undefined);
  assert.deepEqual(s.neighbors("market_square"), ["alley", "wharf"]);
  assert.deepEqual(s.neighbors("wharf"), ["market_square"]);
});

test("结构检查报告坏出口、坏端点、自环与重复路线", () => {
  const broken = new Space(
    [{ id: "a", placeId: "p", exits: ["missing"] }, { id: "b", placeId: "p" }],
    [
      { id: "r1", fromRoomId: "a", toRoomId: "missing" },
      { id: "r2", fromRoomId: "a", toRoomId: "a" },
      { id: "r1", fromRoomId: "a", toRoomId: "b" },
    ],
  );
  const errors = broken.validate().join("\n");
  assert.match(errors, /出口不存在/);
  assert.match(errors, /终点不存在/);
  assert.match(errors, /自环/);
  assert.match(errors, /重复路线 id/);
  assert.equal(space().validate().length, 0);
});
