/**
 * 世界不变量：builder 之后、模拟之后都能检查。
 * 这里只检查结构/资源/可追溯性，不检查“故事好不好”。
 */

import { InvariantBuilder, type InvariantReport } from "../../../../harness/invariant.ts";
import type { CanonFile, WorldState } from "../types.ts";
import type { World } from "./world.ts";

export type { InvariantReport };

export function checkCanonInvariants(canon: CanonFile): InvariantReport {
  const checker = new InvariantBuilder();
  const roomIds = new Set(canon.rooms.map((room) => room.id));
  const characterIds = new Set(canon.characters.map((character) => character.id));
  const ids = new Set<string>();

  checker.check(canon.rooms.length === 12, `房间数应为 12，实际 ${canon.rooms.length}`);
  checker.check(canon.characters.length === 10, `具名 NPC 应为 10，实际 ${canon.characters.length}`);
  checker.check(canon.crowds.length === 2, `群体应为 2，实际 ${canon.crowds.length}`);

  for (const room of canon.rooms) {
    checker.check(!ids.has(room.id), `重复 id: ${room.id}`);
    ids.add(room.id);
  }
  for (const character of canon.characters) {
    const missing: string[] = [];
    if (!roomIds.has(character.homeRoomId)) missing.push("home 不存在");
    if (!roomIds.has(character.startRoomId)) missing.push("start 不存在");
    checker.check(missing.length === 0, `${character.id} ${missing.join("; ")}`);
    for (const relation of Object.keys(character.relationships)) {
      checker.check(characterIds.has(relation), `${character.id} 关系指向未知角色 ${relation}`);
    }
  }
  for (const route of canon.routes) {
    const missing: string[] = [];
    if (!roomIds.has(route.fromRoomId)) missing.push(`起点 ${route.fromRoomId} 不存在`);
    if (!roomIds.has(route.toRoomId)) missing.push(`终点 ${route.toRoomId} 不存在`);
    checker.check(missing.length === 0, `路线 ${route.id} ${missing.join("; ")}`);
  }
  return checker.report();
}

export function checkWorldInvariants(world: World): InvariantReport {
  const errors: string[] = [];
  let checks = 0;
  const state: WorldState = world.state;
  const roomIds = new Set(state.rooms.map((room) => room.id));
  const eventIds = new Set(state.eventLog.map((event) => event.id));
  const characterIds = new Set(state.characters.map((character) => character.id));

  for (const character of state.characters) {
    checks++;
    if (!roomIds.has(character.currentRoomId)) errors.push(`${character.id} 在未知房间 ${character.currentRoomId}`);
    if (character.coins < 0) errors.push(`${character.id} 金币为负: ${character.coins}`);
    for (const [key, value] of Object.entries(character.needs)) {
      checks++;
      if (!Number.isFinite(value) || value < 0) errors.push(`${character.id}.needs.${key} 非法: ${value}`);
    }
    for (const [key, value] of Object.entries(character.mood)) {
      checks++;
      if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(`${character.id}.mood.${key} 越界: ${value}`);
    }
    if (character.jailed && character.currentRoomId !== "jail") {
      errors.push(`${character.id} 被拘禁但不在拘留所: ${character.currentRoomId}`);
    }
  }

  for (const crowd of state.crowds) {
    checks++;
    if (!roomIds.has(crowd.roomId)) errors.push(`群体 ${crowd.id} 在未知房间 ${crowd.roomId}`);
    if (crowd.size < 0) errors.push(`群体 ${crowd.id} 人数为负`);
    for (const memberId of crowd.representativeIds) {
      checks++;
      if (!characterIds.has(memberId)) errors.push(`群体 ${crowd.id} 的代表不存在: ${memberId}`);
    }
  }

  for (const record of state.individuals) {
    checks++;
    if (!record.id) errors.push("individual record 缺少 id");
    if (record.tombstone && record.crowdId && !state.crowds.some((crowd) => crowd.id === record.crowdId)) {
      errors.push(`个体记录 ${record.id} 指向未知群体`);
    }
  }

  for (const [roomId, stock] of Object.entries(state.stocks)) {
    checks++;
    if (!roomIds.has(roomId)) errors.push(`库存指向未知房间 ${roomId}`);
    for (const [commodity, amount] of Object.entries(stock)) {
      checks++;
      if (!Number.isFinite(amount) || (amount as number) < 0) errors.push(`库存 ${roomId}.${commodity} 为负`);
    }
  }

  for (const fact of state.facts) {
    checks++;
    if (!eventIds.has(fact.sourceEventId)) errors.push(`事实 ${fact.id} 的来源事件不存在: ${fact.sourceEventId}`);
    if (!["active", "resolved", "superseded"].includes(fact.status)) errors.push(`事实 ${fact.id} 状态非法`);
    if (fact.salience < 0 || fact.salience > 1) errors.push(`事实 ${fact.id} salience 越界`);
  }
  for (const trace of state.traces) {
    checks++;
    if (!eventIds.has(trace.sourceEventId)) errors.push(`痕迹 ${trace.id} 的来源事件不存在`);
  }

  for (const event of state.eventLog) {
    checks++;
    if (!event.provenance || !event.provenance.source) errors.push(`事件 ${event.id} 缺少 provenance`);
    for (const sourceId of event.sourceEventIds) {
      checks++;
      if (!eventIds.has(sourceId)) errors.push(`事件 ${event.id} 引用了不存在的事件 ${sourceId}`);
      if (sourceId === event.id) errors.push(`事件 ${event.id} 引用了自己`);
    }
    if (event.facts.some((fact) => fact.sourceEventId !== event.id)) {
      errors.push(`事件 ${event.id} 的 fact sourceEventId 不一致`);
    }
  }

  for (const plan of state.plans) {
    checks++;
    if (!["proposed", "validated", "scheduled", "pending", "resolving", "resolved", "aborted"].includes(plan.state)) {
      errors.push(`计划 ${plan.id} 状态非法: ${plan.state}`);
    }
    for (const actorId of plan.actorIds) {
      checks++;
      if (!characterIds.has(actorId) && actorId !== state.pc.id) errors.push(`计划 ${plan.id} actor 不存在: ${actorId}`);
    }
  }

  if (state.metrics.events !== state.eventLog.length) {
    errors.push(`事件计数不一致: ${state.metrics.events} vs ${state.eventLog.length}`);
  }
  return { ok: errors.length === 0, errors, checks };
}

export function terminalPlans(world: World): boolean {
  return world.state.plans.every((plan) => plan.state === "resolved" || plan.state === "aborted");
}
