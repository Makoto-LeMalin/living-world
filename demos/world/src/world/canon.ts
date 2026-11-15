/**
 * Canon 加载与 WorldBuilder。
 *
 * 世界拓扑和 NPC 身份手写；seed 只参数化初始价格/库存/情绪/关系，
 * 不生成拓扑，也不决定剧情。这样 20 个 seed 能验证不变量，而不是验证生成器。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { makeRng } from "../../../../src/kernel/rng.ts";
import type {
  Activity,
  CanonFile,
  CanonSpecialPlan,
  Character,
  Commodity,
  Crowd,
  Mood,
  Room,
  RouteSegment,
  ScheduleBlock,
  SocialClimate,
  WorldConfig,
  WorldMetrics,
  WorldState,
} from "../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export const CANON_PATH = join(HERE, "..", "..", "fixtures", "ferry-market.json");

export const COMMODITIES: Commodity[] = ["bread", "grain", "fish", "cloth", "tools"];

export const RULE_VERSION = "world-b2.0";

export function loadCanon(path = CANON_PATH): CanonFile {
  return JSON.parse(readFileSync(path, "utf8")) as CanonFile;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function unique<T>(items: T[], key: (item: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const id = key(item);
    assert(id.length > 0, `${label} 有空 id`);
    assert(!seen.has(id), `${label} id 重复: ${id}`);
    seen.add(id);
  }
}

function validateSchedule(
  owner: string,
  schedule: ScheduleBlock[],
  roomIds: Set<string>,
  ticksPerDay: number,
): void {
  assert(schedule.length > 0, `${owner} 没有日程`);
  const sorted = [...schedule].sort((a, b) => a.startTick - b.startTick);
  let cursor = 0;
  for (const block of sorted) {
    assert(Number.isInteger(block.startTick) && block.startTick >= 0, `${owner} 日程起点非法`);
    assert(Number.isInteger(block.endTick) && block.endTick <= ticksPerDay, `${owner} 日程终点非法`);
    assert(block.endTick > block.startTick, `${owner} 日程区间为空: ${block.startTick}-${block.endTick}`);
    assert(block.startTick === cursor, `${owner} 日程不连续: 期望 ${cursor}，得到 ${block.startTick}`);
    assert(roomIds.has(block.roomId), `${owner} 日程引用了未知房间: ${block.roomId}`);
    assert(block.priority >= 0, `${owner} 日程 priority 为负`);
    cursor = block.endTick;
  }
  assert(cursor === ticksPerDay, `${owner} 日程没有覆盖整天: ${cursor}/${ticksPerDay}`);
}

export function validateCanon(canon: CanonFile): void {
  assert(canon.id.length > 0, "canon 缺少 id");
  assert(canon.ticksPerDay > 0 && canon.tickMinutes > 0, "canon 时钟参数非法");
  assert(canon.rooms.length > 0, "canon 没有房间");
  assert(canon.characters.length > 0, "canon 没有角色");

  unique(canon.rooms, (room) => room.id, "房间");
  unique(canon.characters, (character) => character.id, "角色");
  unique(canon.crowds, (crowd) => crowd.id, "群体");
  unique(canon.routes, (route) => route.id, "路线");

  const roomIds = new Set(canon.rooms.map((room) => room.id));
  for (const room of canon.rooms) {
    assert(room.name.length > 0, `房间 ${room.id} 没有名字`);
    assert(room.placeId.length > 0, `房间 ${room.id} 没有 placeId`);
    assert(canon.commodities.includes("bread"), "canon 缺少 bread 商品");
    unique(room.landmarks, (landmark) => landmark.id, `房间 ${room.id} 的地标`);
    for (const exit of room.exits) {
      assert(roomIds.has(exit), `房间 ${room.id} 指向未知出口 ${exit}`);
      const back = canon.rooms.find((candidate) => candidate.id === exit);
      assert(back?.exits.includes(room.id), `出口不互逆: ${room.id} -> ${exit}`);
    }
  }

  for (const route of canon.routes) {
    assert(roomIds.has(route.fromRoomId), `路线 ${route.id} 起点不存在`);
    assert(roomIds.has(route.toRoomId), `路线 ${route.id} 终点不存在`);
    assert(route.travelTicks > 0, `路线 ${route.id} travelTicks 必须为正`);
    assert(route.traffic >= 0 && route.danger >= 0 && route.danger <= 1, `路线 ${route.id} 参数非法`);
    assert(route.patrol >= 0 && route.patrol <= 1, `路线 ${route.id} patrol 非法`);
  }

  const connected = new Set<string>();
  const queue = [canon.rooms[0].id];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (connected.has(id)) continue;
    connected.add(id);
    const room = canon.rooms.find((candidate) => candidate.id === id);
    for (const exit of room?.exits ?? []) if (!connected.has(exit)) queue.push(exit);
  }
  assert(connected.size === canon.rooms.length, `房间图不连通: ${connected.size}/${canon.rooms.length}`);

  const characterIds = new Set(canon.characters.map((character) => character.id));
  for (const character of canon.characters) {
    assert(roomIds.has(character.homeRoomId), `${character.id} homeRoomId 不存在`);
    assert(roomIds.has(character.startRoomId), `${character.id} startRoomId 不存在`);
    assert(character.attention >= 0 && character.attention <= 1, `${character.id} attention 非法`);
    for (const key of ["hunger", "fatigue", "safety", "social", "coin"] as const) {
      assert(character.needs[key] >= 0 && character.needs[key] <= 100, `${character.id}.needs.${key} 非法`);
    }
    for (const relationId of Object.keys(character.relationships)) {
      assert(characterIds.has(relationId), `${character.id} 关系指向未知角色 ${relationId}`);
    }
    validateSchedule(character.id, character.schedule, roomIds, canon.ticksPerDay);
  }

  for (const crowd of canon.crowds) {
    assert(roomIds.has(crowd.roomId), `群体 ${crowd.id} 房间不存在`);
    assert(crowd.size > 0, `群体 ${crowd.id} size 必须为正`);
  }

  for (const commodity of canon.commodities) {
    assert(Number.isFinite(canon.prices[commodity]) && canon.prices[commodity] > 0, `价格 ${commodity} 非法`);
  }
  for (const [roomId, stock] of Object.entries(canon.stocks)) {
    assert(roomIds.has(roomId), `库存指向未知房间 ${roomId}`);
    for (const [commodity, amount] of Object.entries(stock)) {
      assert((canon.commodities as string[]).includes(commodity), `库存商品未知 ${commodity}`);
      assert(Number.isFinite(amount) && amount >= 0, `库存 ${roomId}.${commodity} 非法`);
    }
  }

  for (const plan of canon.specialPlans) {
    assert(roomIds.has(plan.roomId), `特殊计划 ${plan.id} 房间不存在`);
    assert(plan.startTick >= 0 && plan.endTick > plan.startTick, `特殊计划 ${plan.id} 时间窗非法`);
    assert(plan.endTick <= canon.ticksPerDay * 4, `特殊计划 ${plan.id} 超出场景范围`);
  }
}

function initialMood(mood: Mood, rng: () => number): Mood {
  const jitter = () => (rng() - 0.5) * 0.08;
  return {
    fear: clamp(mood.fear + jitter()),
    anger: clamp(mood.anger + jitter()),
    trust: clamp(mood.trust + jitter()),
    hope: clamp(mood.hope + jitter()),
    suspicion: clamp(mood.suspicion + jitter()),
  };
}

function initialClimate(
  placeId: string,
  characters: Character[],
  crowds: Crowd[],
  tick: number,
): SocialClimate {
  const entries: Array<{ mood: Mood; weight: number }> = [];
  for (const character of characters) {
    if (!character.currentRoomId.startsWith("house_") && character.currentRoomId !== "alley") {
      // 按角色当前地点归属；房间到 place 的映射由调用方的 characters 已经带有 currentRoomId。
    }
    const weight = character.tier === "T0" ? 1 : character.tier === "T1" ? 0.7 : 0.4;
    entries.push({ mood: character.mood, weight });
  }
  for (const crowd of crowds) {
    entries.push({ mood: crowd.mood, weight: crowd.size / 20 });
  }
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  const average = (key: keyof Mood) =>
    entries.reduce((sum, entry) => sum + entry.mood[key] * entry.weight, 0) / total;
  return {
    placeId,
    fear: clamp(average("fear")),
    anger: clamp(average("anger")),
    trust: clamp(average("trust")),
    hope: clamp(average("hope")),
    suspicion: clamp(average("suspicion")),
    updatedAtTick: tick,
    dominantNarrative: "日常",
  };
}

export function buildWorld(canon: CanonFile, config: WorldConfig): WorldState {
  validateCanon(canon);
  const rng = makeRng(`${config.worldSeed}:builder`);
  const next = () => rng.next();
  const priceFactor = () => 0.9 + next() * 0.2;
  const stockFactor = () => 0.85 + next() * 0.3;

  const prices = {} as Record<Commodity, number>;
  for (const commodity of COMMODITIES) {
    prices[commodity] = round2(canon.prices[commodity] * priceFactor());
  }
  const basePrices = { ...prices };

  const stocks: Record<string, Partial<Record<Commodity, number>>> = {};
  for (const [roomId, stock] of Object.entries(canon.stocks)) {
    const copy: Partial<Record<Commodity, number>> = {};
    for (const [commodity, amount] of Object.entries(stock)) {
      copy[commodity as Commodity] = Math.max(0, Math.floor(amount * stockFactor()));
    }
    stocks[roomId] = copy;
  }

  const characters: Character[] = canon.characters.map((source) => {
    const relationships: Character["relationships"] = {};
    for (const [id, relation] of Object.entries(source.relationships ?? {})) {
      relationships[id] = {
        trust: clamp((relation.trust ?? 0) + (next() - 0.5) * 0.06),
        affinity: clamp((relation.affinity ?? 0) + (next() - 0.5) * 0.06),
        fear: clamp((relation.fear ?? 0) + (next() - 0.5) * 0.06),
      };
    }
    return {
      id: source.id,
      name: source.name,
      role: source.role,
      tier: source.tier,
      homeRoomId: source.homeRoomId,
      currentRoomId: source.startRoomId,
      attention: source.attention,
      skills: { ...source.skills },
      needs: { ...source.needs },
      mood: initialMood(source.mood, next),
      coins: Math.max(0, Math.round(source.coins * (0.9 + next() * 0.2))),
      relationships,
      schedule: structuredClone(source.schedule),
      beliefs: [],
      observations: [],
      jailed: false,
      deviations: 0,
      detailLevel: source.tier === "T0" ? "full" : source.tier === "T1" ? "summary" : "index",
      lastTierChangeTick: -999,
      lastTierEvalTick: -999,
      observed: false,
      keyMemories: [],
    };
  });

  const crowds: Crowd[] = canon.crowds.map((source) => ({
    ...source,
    tier: "T3",
    mood: initialMood(source.mood, next),
    beliefs: [],
    cohesion: 0.6,
    representativeIds: [],
    individualizedCount: 0,
    mergedCount: 0,
    initialSize: source.size,
  }));

  for (const character of characters) {
    for (const other of characters) {
      if (other.id === character.id) continue;
      character.relationships[other.id] ??= {
        trust: clamp(0.4 + (next() - 0.5) * 0.2),
        affinity: clamp(0.2 + (next() - 0.5) * 0.2),
        fear: clamp((next() - 0.5) * 0.1),
      };
    }
    // 观察者也是社会关系的一端；没有它，importance 的 relationship 项只能为 0。
    character.relationships["pc_observer"] ??= {
      trust: clamp(0.3 + (next() - 0.5) * 0.1),
      affinity: clamp(0.15 + (next() - 0.5) * 0.1),
      fear: 0,
    };
  }

  const rooms: Room[] = structuredClone(canon.rooms);
  const roomPlace = new Map(rooms.map((room) => [room.id, room.placeId]));
  const routes: RouteSegment[] = structuredClone(canon.routes);
  const placeIds = [...new Set(rooms.map((room) => room.placeId))];
  const climate: Record<string, SocialClimate> = {};
  for (const placeId of placeIds) {
    const localCharacters = characters.filter((character) => roomPlace.get(character.currentRoomId) === placeId);
    const localCrowds = crowds.filter((crowd) => roomPlace.get(crowd.roomId) === placeId);
    climate[placeId] = initialClimate(placeId, localCharacters, localCrowds, config.startTick);
  }

  const metrics: WorldMetrics = {
    ticks: 0,
    npcDecisions: 0,
    ruleDecisions: 0,
    llmCalls: 0,
    directorProposals: 0,
    events: 0,
    eventsBySource: { ambient: 0, actor: 0, special: 0, system: 0 },
    eventsByType: {},
    schedule: { npcTicks: 0, adhered: 0, transit: 0, excused: 0, violations: 0 },
    travelEncounters: 0,
    rumors: 0,
    maxRumorHops: 0,
    plans: { created: 0, resolved: 0, aborted: 0 },
    runtimeDecisions: 0,
    tierChanges: 0,
    promotions: 0,
    demotions: 0,
    crowdIndividualizations: 0,
    crowdMerges: 0,
    offstageCharacterCalls: 0,
    budgetDegraded: 0,
  };

  const plans = canon.specialPlans.map((special) => specialToPlan(special, config.startTick));
  metrics.plans.created = plans.length;

  return {
    config,
    rooms,
    routes,
    characters,
    crowds,
    pc: {
      id: "pc_observer",
      name: "观察者",
      currentRoomId: "temple",
      beliefs: [],
      observations: [],
      status: "resting",
    },
    prices,
    basePrices,
    stocks,
    facts: [],
    traces: [],
    plans,
    individuals: [],
    climate,
    budget: {
      directorCallsByDay: {},
      characterCallsByDay: {},
      highSalienceByPlaceDay: {},
      characterCallsByLod: {},
      characterCallsByNpc: {},
      characterCallsByTick: {},
      directorCallsByReason: {},
      degradedByReason: {},
    },
    eventLog: [],
    tick: config.startTick,
    nextEventId: 1,
    nextFactId: 1,
    nextTraceId: 1,
    nextPlanId: plans.length + 1,
    nextProposalId: 1,
    nextIndividualId: 1,
    metrics,
    canon: canon.canon as unknown as Record<string, unknown>,
  };
}

function specialToPlan(special: CanonSpecialPlan, createdAtTick: number): WorldState["plans"][number] {
  return {
    id: special.id,
    source: "special",
    type: special.type,
    placeId: special.placeId,
    roomId: special.roomId,
    actorIds: [],
    targetIds: [],
    factionIds: [],
    timeWindow: { startTick: special.startTick, endTick: special.endTick },
    direction: special.direction,
    stakes: special.stakes,
    preconditions: [...special.preconditions],
    branches: { ...special.branches },
    visibility: special.visibility,
    createdBy: "canon",
    state: "scheduled",
    payload: {},
    createdAtTick,
  };
}

export function defaultConfig(worldSeed = "7", days = 3): WorldConfig {
  return {
    worldId: "ferry-market",
    worldSeed,
    startTick: 0,
    days,
    tickMinutes: 10,
    ticksPerDay: 144,
    injections: { theftTick: 180, fireTick: 306 },
    observer: { enabled: true, departTick: 200, returnTick: 250 },
  };
}

export function scheduleAt(character: Character, tickOfDay: number): ScheduleBlock {
  const block = character.schedule.find(
    (candidate) => tickOfDay >= candidate.startTick && tickOfDay < candidate.endTick,
  );
  if (!block) throw new Error(`${character.id} 在 tickOfDay=${tickOfDay} 没有日程`);
  return block;
}

export function activityLabel(activity: Activity): string {
  const labels: Record<Activity, string> = {
    sleep: "睡觉",
    eat: "吃饭",
    work: "工作",
    trade: "交易",
    patrol: "巡逻",
    worship: "祭拜",
    drink: "喝酒",
    home: "在家",
    beg: "乞讨",
    play: "玩耍",
    case: "踩点",
    hide: "躲藏",
    travel: "赶路",
  };
  return labels[activity];
}
