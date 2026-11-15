/**
 * 路途不是背景：谁正好在这条路上，决定 PC 遇到谁、听到什么。
 * 没有遭遇也是合法结果；空路会写 EncounterResolved? 不，空路只记录 travel tick。
 */

import { clamp } from "../world/canon.ts";
import { provenance, type World } from "../world/world.ts";
import { spreadRumor } from "./rumor.ts";
import type { Belief, Fact, RouteSegment } from "../types.ts";

export function routeBetween(world: World, fromRoomId: string, toRoomId: string): RouteSegment | undefined {
  return world.space.routeBetween(fromRoomId, toRoomId);
}

function timeOfDayFactor(world: World): number {
  const tod = world.state.tick % world.state.config.ticksPerDay;
  return tod >= 96 || tod < 6 ? 0.5 : 1;
}

function eventPressure(world: World): number {
  let pressure = 1;
  if (world.state.facts.some((fact) => fact.kind === "crime" && fact.status === "active")) pressure += 0.3;
  if (world.state.facts.some((fact) => fact.kind === "fire" && fact.status === "active")) pressure += 0.5;
  if (world.state.facts.some((fact) => fact.kind === "law" && fact.detail.reason === "theft")) pressure += 0.3;
  return pressure;
}

export function encounterProbability(world: World, route: RouteSegment): number {
  return clamp(
    0.55 * (route.traffic / 1.2) * (route.danger + 0.15) * timeOfDayFactor(world) * eventPressure(world),
    0,
    0.9,
  );
}

function latestFact(world: World, predicate: (fact: Fact) => boolean): Fact | undefined {
  return [...world.state.facts].reverse().find(predicate);
}

interface EncounterChoice {
  kind: string;
  name: string;
  fact?: Fact;
  content: string;
  confidence: number;
  reason: string;
}

function chooseEncounter(
  world: World,
  route: RouteSegment,
  excludeFactKinds: Fact["kind"][] = [],
): EncounterChoice | undefined {
  const allowed = (fact: Fact) => !excludeFactKinds.includes(fact.kind);
  const fire = latestFact(world, (fact) => fact.kind === "fire" && fact.status === "active" && allowed(fact));
  const arrest = latestFact(
    world,
    (fact) => fact.kind === "law" && fact.detail.reason === "theft" && fact.status === "active" && allowed(fact),
  );
  const crime = latestFact(world, (fact) => fact.kind === "crime" && fact.status === "active" && allowed(fact));

  if (fire) {
    return {
      kind: "refugee",
      name: "从码头出来的妇人",
      fact: fire,
      content: "码头那边起火了，仓库的人都在往外搬东西。",
      confidence: 0.6,
      reason: "fire pressure",
    };
  }
  if (arrest) {
    return {
      kind: "traveller",
      name: "赶集的妇人",
      fact: arrest,
      content: "乞丐还关着，可东西没找回来。",
      confidence: 0.58,
      reason: "arrest pressure",
    };
  }
  if (crime) {
    return {
      kind: "salt-trader",
      name: "盐商",
      fact: crime,
      content: "集市的面包摊出了事，我路过时看见有人在议论。",
      confidence: 0.42,
      reason: "crime pressure",
    };
  }
  const trade = latestFact(world, (fact) => fact.kind === "trade" && allowed(fact));
  if (trade) {
    return {
      kind: "pilgrim",
      name: "朝圣者",
      fact: trade,
      content: "今年集市的东西不便宜，路上要多带点干粮。",
      confidence: 0.4,
      reason: "trade pressure",
    };
  }
  if (route.terrain === "checkpoint") {
    return {
      kind: "patrol",
      name: "城门守卫",
      content: "城门今天查得紧，别在巷子里逗留。",
      confidence: 0.3,
      reason: "checkpoint patrol",
    };
  }
  return undefined;
}

export interface EncounterResult {
  eventId: string;
  routeId: string;
  kind: string;
  name: string;
  factId?: string;
  rumorEventId?: string;
}

export interface EncounterOptions {
  excludeFactKinds?: Fact["kind"][];
}

export function tryEncounter(
  world: World,
  actorId: string,
  fromRoomId: string,
  toRoomId: string,
  tick = world.state.tick,
  options: EncounterOptions = {},
): EncounterResult | undefined {
  const route = routeBetween(world, fromRoomId, toRoomId);
  if (!route) return undefined;
  const probability = encounterProbability(world, route);
  if (world.rng("encounter", route.id, fromRoomId, toRoomId, tick, actorId).next() >= probability) {
    return undefined;
  }

  const choice = chooseEncounter(world, route, options.excludeFactKinds);
  if (!choice) return undefined;
  const actorRoom = world.maybeCharacter(actorId)?.currentRoomId ?? world.state.pc.currentRoomId;
  const encounterId = `enc_${route.id}_${tick}_${actorId}`;
  const event = world.emit({
    type: "EncounterResolved",
    tick,
    actorId,
    roomId: fromRoomId,
    visibility: "room",
    witnesses: [actorId],
    sourceEventIds: choice.fact ? [choice.fact.sourceEventId] : [],
    payload: {
      encounterId,
      routeId: route.id,
      kind: choice.kind,
      name: choice.name,
      reason: choice.reason,
      factId: choice.fact?.id,
      content: choice.content,
      probability,
    },
    facts: choice.fact
      ? [
          {
            kind: "event",
            subjectId: encounterId,
            placeId: world.placeOfRoom(actorRoom),
            detail: { routeId: route.id, encounterKind: choice.kind, factId: choice.fact.id },
            salience: 0.18,
            summary: `路上遇到${choice.name}，听说：${choice.content}`,
          },
        ]
      : [],
    provenance: provenance("ambient", { seed: world.seed }),
  });

  let rumorEventId: string | undefined;
  if (choice.fact) {
    const belief: Belief = {
      factId: choice.fact.id,
      content: choice.content,
      confidence: choice.confidence,
      sourceEventId: choice.fact.sourceEventId,
      learnedAtTick: tick,
      version: 1,
      hops: 0,
      originPlaceId: choice.fact.placeId,
    };
    if (spreadRumor(world, encounterId, [actorId], belief, {
      tick,
      content: choice.content,
      confidence: choice.confidence,
    })) {
      rumorEventId = world.state.eventLog[world.state.eventLog.length - 1].id;
    }
  }
  return {
    eventId: event.id,
    routeId: route.id,
    kind: choice.kind,
    name: choice.name,
    factId: choice.fact?.id,
    rumorEventId,
  };
}

export function maybeTravelNpc(world: World, characterId: string, path: string[], tick: number): void {
  const character = world.character(characterId);
  if (character.jailed || path.length === 0) return;
  const next = path[0];
  const from = character.currentRoomId;
  world.moveCharacter(characterId, next, "travel", tick);
  tryEncounter(world, characterId, from, next, tick);
}
