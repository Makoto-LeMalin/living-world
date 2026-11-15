/**
 * 离开 / 返回：DepartureSnapshot → ReturnDiff → Echo。
 * 返回时不“现场生成”A 地发生了什么；全部从事件日志和投影读取。
 */

import type {
  Belief,
  DepartureSnapshot,
  Echo,
  Fact,
  Mood,
  ReturnChange,
  ReturnDiff,
  WorldEvent,
} from "../types.ts";
import type { World } from "../world/world.ts";

export function snapshotPlace(world: World, placeId: string, tick = world.state.tick): DepartureSnapshot {
  const pcBeliefs = world.state.pc.beliefs
    .map((belief) => world.state.facts.find((fact) => fact.id === belief.factId))
    .filter((fact): fact is Fact => Boolean(fact) && fact?.placeId === placeId)
    .map((fact) => fact.id);
  return {
    placeId,
    tick,
    visibleIds: world.visibleIdsAt(placeId),
    prices: { ...world.state.prices },
    climate: { ...world.state.climate[placeId] },
    pcBeliefs,
  };
}

function eventsInWindow(world: World, fromTick: number, toTick: number, type?: string): WorldEvent[] {
  return world.state.eventLog.filter(
    (event) => event.tick > fromTick && event.tick <= toTick && (!type || event.type === type),
  );
}

function priceChanges(world: World, snapshot: DepartureSnapshot, tick: number): ReturnChange[] {
  const changes: ReturnChange[] = [];
  const priceEvents = eventsInWindow(world, snapshot.tick, tick, "PriceChanged");
  for (const commodity of Object.keys(world.state.prices) as Array<keyof typeof world.state.prices>) {
    if (Math.abs(world.state.prices[commodity] - snapshot.prices[commodity]) < 0.01) continue;
    const related = priceEvents.filter((event) => event.payload.commodity === commodity);
    changes.push({
      id: `price:${commodity}`,
      eventIds: related.map((event) => event.id),
      summary: `${commodity} 从 ${snapshot.prices[commodity]} 变成 ${world.state.prices[commodity]}。`,
    });
  }
  return changes;
}

function factChanges(world: World, placeId: string, fromTick: number, tick: number): ReturnChange[] {
  const changes: ReturnChange[] = [];
  for (const fact of world.state.facts) {
    if (fact.placeId !== placeId) continue;
    if (fact.kind === "relationship") continue;
    if (fact.salience < 0.3) continue;
    if (fact.validFromTick <= fromTick && fact.status === "active") continue;
    changes.push({
      id: fact.id,
      eventIds: [fact.sourceEventId],
      summary: fact.summary,
    });
  }
  return changes;
}

function traceChanges(world: World, placeId: string, fromTick: number): ReturnChange[] {
  return world.state.traces
    .filter((trace) => trace.placeId === placeId && trace.createdTick > fromTick && trace.visible)
    .map((trace) => ({
      id: trace.id,
      eventIds: [trace.sourceEventId],
      summary: trace.description,
    }));
}

function statusChanges(world: World, placeId: string, snapshot: DepartureSnapshot, tick: number): ReturnChange[] {
  const changes: ReturnChange[] = [];
  const events = world.state.eventLog.filter(
    (event) => event.tick > snapshot.tick && event.tick <= tick && event.placeId === placeId,
  );
  for (const event of events) {
    const characterId =
      typeof event.payload.characterId === "string"
        ? event.payload.characterId
        : typeof event.payload.suspectId === "string"
          ? event.payload.suspectId
          : undefined;
    if (!characterId) continue;
    if (event.type !== "Jailed" && event.type !== "Released") continue;
    changes.push({
      id: characterId,
      eventIds: [event.id],
      summary: event.type === "Jailed" ? `${world.maybeCharacter(characterId)?.name ?? characterId} 被关进了拘留所。` : `${characterId} 被释放了。`,
    });
  }
  return changes;
}

function climateDelta(snapshot: DepartureSnapshot, current: Mood): Partial<Mood> {
  const delta: Partial<Mood> = {};
  for (const key of ["fear", "anger", "trust", "hope", "suspicion"] as const) {
    const diff = Math.round((current[key] - snapshot.climate[key]) * 100) / 100;
    if (Math.abs(diff) >= 0.01) delta[key] = diff;
  }
  return delta;
}

function latestEventOfType(world: World, type: string, predicate: (event: WorldEvent) => boolean): WorldEvent | undefined {
  return [...world.state.eventLog].reverse().find((event) => event.type === type && predicate(event));
}

function echoFor(world: World, belief: Belief, placeId: string, snapshot: DepartureSnapshot): Echo | undefined {
  const fact = world.state.facts.find((candidate) => candidate.id === belief.factId);
  if (!fact) {
    return {
      factId: belief.factId,
      belief,
      verdict: "refuted",
      note: "没有对应的 canonical fact；这条说法无法在返回时找到证据。",
    };
  }
  if (!["crime", "law", "fire", "trade", "testimony"].includes(fact.kind)) return undefined;

  const culpritId = typeof fact.detail.culpritId === "string" ? fact.detail.culpritId : undefined;
  const factSuspectId = typeof fact.detail.suspectId === "string" ? fact.detail.suspectId : undefined;
  const evidenceAfter = latestEventOfType(
    world,
    fact.kind === "crime" ? "WitnessStatement" : fact.kind === "law" ? "Jailed" : "FireDamaged",
    (event) => event.tick > snapshot.tick,
  );

  if (belief.suspectId && culpritId && belief.suspectId !== culpritId) {
    return {
      factId: fact.id,
      belief,
      verdict: "distorted",
      observedEventId: evidenceAfter?.id ?? fact.sourceEventId,
      note: `传闻把 ${world.maybeCharacter(belief.suspectId)?.name ?? belief.suspectId} 当成肇事者；canonical culprit 是 ${world.maybeCharacter(culpritId)?.name ?? culpritId}。`,
    };
  }
  if (fact.kind === "law" && factSuspectId && belief.content.includes("乞丐") && factSuspectId === "npc_beggar") {
    return {
      factId: fact.id,
      belief,
      verdict: "confirmed",
      observedEventId: fact.sourceEventId,
      note: "拘留所里的乞丐与传闻一致；但这是否是真正的肇事者是另一条事实。",
    };
  }
  if (belief.content.includes("烧光") && fact.detail.spreads === false) {
    return {
      factId: fact.id,
      belief,
      verdict: "distorted",
      observedEventId: fact.sourceEventId,
      note: "火被控制住了，并没有整座仓库烧光。",
    };
  }
  if (fact.kind === "trade" && belief.content.includes("贵")) {
    return {
      factId: fact.id,
      belief,
      verdict: "confirmed",
      observedEventId: fact.sourceEventId,
      note: "价格确实变了。",
    };
  }
  if (fact.status === "active" || fact.status === "resolved") {
    return {
      factId: fact.id,
      belief,
      verdict: "confirmed",
      observedEventId: fact.sourceEventId,
      note: "返回时能找到对应的事件或痕迹。",
    };
  }
  return {
    factId: fact.id,
    belief,
    verdict: "refuted",
    observedEventId: undefined,
    note: "对应事实已被取代，现场没有留下可验证的证据。",
  };
}

export function computeReturnDiff(world: World, snapshot: DepartureSnapshot, tick = world.state.tick): ReturnDiff {
  const placeId = snapshot.placeId;
  const currentVisible = new Set(world.visibleIdsAt(placeId));
  const beforeVisible = new Set(snapshot.visibleIds);
  const stableIds = [...snapshot.visibleIds]
    .filter((id) => currentVisible.has(id))
    .filter((id) => id.startsWith("lm_") || id.startsWith("t_"))
    .sort();
  const addedIds = [...currentVisible].filter((id) => !beforeVisible.has(id)).sort();
  const removedIds = [...beforeVisible].filter((id) => !currentVisible.has(id)).sort();

  const changed = [
    ...priceChanges(world, snapshot, tick),
    ...factChanges(world, placeId, snapshot.tick, tick),
    ...traceChanges(world, placeId, snapshot.tick),
    ...statusChanges(world, placeId, snapshot, tick),
  ];
  const deduped = new Map<string, ReturnChange>();
  for (const change of changed) {
    const existing = deduped.get(change.id);
    if (existing) {
      existing.eventIds = [...new Set([...existing.eventIds, ...change.eventIds])];
      existing.summary = `${existing.summary} ${change.summary}`;
    } else {
      deduped.set(change.id, { ...change, eventIds: [...new Set(change.eventIds)] });
    }
  }

  const currentClimate = world.state.climate[placeId];
  const echoes: Echo[] = [];
  for (const belief of world.state.pc.beliefs) {
    const echo = echoFor(world, belief, placeId, snapshot);
    if (echo) echoes.push(echo);
  }

  return {
    placeId,
    departureTick: snapshot.tick,
    returnTick: tick,
    stableIds,
    changed: [...deduped.values()],
    addedIds,
    removedIds,
    climateDelta: currentClimate ? climateDelta(snapshot, currentClimate) : {},
    echoes,
  };
}

export function diffSummary(diff: ReturnDiff): string {
  const changedIds = diff.changed.map((change) => change.id).join(", ");
  return [
    `stable=${diff.stableIds.length}`,
    `changed=${diff.changed.length}${changedIds ? ` (${changedIds})` : ""}`,
    `added=${diff.addedIds.length}`,
    `removed=${diff.removedIds.length}`,
    `echoes=${diff.echoes.length}`,
  ].join("; ");
}
