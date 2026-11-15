/**
 * 传闻：一条 Speech 事件，带 factId / sourceEventId / hops。
 * 不广播、不改 canonical Fact；听者只得到 Belief。
 */

import { clamp } from "../world/canon.ts";
import { provenance, type World } from "../world/world.ts";
import type { Belief, Character, Fact } from "../types.ts";

export const MAX_RUMOR_HOPS = 5;

export function factFor(world: World, factId: string): Fact | undefined {
  return world.state.facts.find((fact) => fact.id === factId);
}

function recentEnough(world: World, belief: Belief, tick: number): boolean {
  return tick - (belief.lastToldAtTick ?? -999) >= 36;
}

/** 传闻会变形，但变形仍必须挂在一个真实 factId 上。 */
export function distortedContent(world: World, belief: Belief, speakerId: string): { content: string; suspectId?: string } {
  const fact = factFor(world, belief.factId);
  if (!fact) return { content: belief.content, suspectId: belief.suspectId };
  const culpritId = typeof fact.detail.culpritId === "string" ? fact.detail.culpritId : undefined;
  const beggar = world.maybeCharacter("npc_beggar");
  const speaker = world.maybeCharacter(speakerId);
  const speakerIsChild = speakerId === "npc_child" || speaker?.role === "孩子";
  const speakerIsCrowd = Boolean(world.maybeCrowd(speakerId));

  if (fact.kind === "crime" && culpritId) {
    if (belief.suspectId) return { content: belief.content, suspectId: belief.suspectId };
    if ((speakerIsChild || speakerIsCrowd) && beggar && world.placeOfRoom(beggar.currentRoomId) === fact.placeId) {
      return { content: "听说是集市那个乞丐干的。", suspectId: beggar.id };
    }
    return { content: "集市的面包摊出了事，有人看见一个瘦小的人影。", suspectId: undefined };
  }
  if (fact.kind === "fire") {
    return { content: `${fact.summary} 有人说整座仓库都烧光了。`, suspectId: undefined };
  }
  return { content: belief.content, suspectId: belief.suspectId };
}

export function spreadRumor(
  world: World,
  speakerId: string,
  listenerIds: string[],
  belief: Belief,
  options: { content?: string; suspectId?: string; confidence?: number; tick?: number } = {},
): boolean {
  const fact = factFor(world, belief.factId);
  if (!fact) return false;
  const listeners = [...new Set(listenerIds)].filter((id) => id !== speakerId);
  if (listeners.length === 0) return false;
  const hops = belief.hops + 1;
  if (hops > MAX_RUMOR_HOPS) return false;

  const defaultContent = distortedContent(world, belief, speakerId);
  const content = options.content ?? defaultContent.content;
  const suspectId = options.suspectId ?? defaultContent.suspectId;
  const originPlace = belief.originPlaceId || fact.placeId;
  const speakerPlace = world.placeOfActor(speakerId) ?? fact.placeId;
  const localPenalty = speakerPlace === originPlace ? 0 : 0.15;
  const confidence = clamp(
    options.confidence ?? belief.confidence - 0.12 - localPenalty,
    0.12,
    0.95,
  );

  const speakerName =
    world.maybeCharacter(speakerId)?.name ?? world.maybeCrowd(speakerId)?.name ?? speakerId;

  world.emit({
    type: "RumorTold",
    tick: options.tick ?? world.state.tick,
    roomId: world.maybeCharacter(speakerId)?.currentRoomId ?? world.maybeCrowd(speakerId)?.roomId ?? world.state.pc.currentRoomId,
    visibility: "private",
    witnesses: listeners,
    sourceEventIds: [belief.sourceEventId],
    payload: {
      speakerId,
      speakerName,
      listenerIds: listeners,
      factId: belief.factId,
      content,
      confidence,
      hops,
      originPlaceId: originPlace,
      suspectId,
      distortion: content !== fact.summary,
      claims: [belief.factId],
    },
    provenance: provenance("actor", { seed: world.seed }),
  });
  return true;
}

function eligibleBeliefs(world: World, holderId: string, tick: number): Belief[] {
  const relevantKinds = new Set(["crime", "law", "fire", "testimony", "suspicion", "trade"]);
  return world
    .beliefsOf(holderId)
    .filter((belief) => {
      const fact = factFor(world, belief.factId);
      if (!fact) return false;
      return (
        fact.status !== "superseded" &&
        relevantKinds.has(fact.kind) &&
        fact.salience >= 0.45 &&
        recentEnough(world, belief, tick)
      );
    })
    .sort((a, b) => {
      const fa = factFor(world, a.factId)?.salience ?? 0;
      const fb = factFor(world, b.factId)?.salience ?? 0;
      return fb * b.confidence - fa * a.confidence;
    });
}

function priorityListeners(world: World, character: Character): string[] {
  const occupants = world.occupants(character.currentRoomId).filter((id) => id !== character.id);
  const score = (id: string): number => {
    if (world.maybeCrowd(id)) return 0;
    if (id === world.state.pc.id) return 1;
    if (id === "npc_guard") return 2;
    return 3;
  };
  return occupants.sort((a, b) => score(a) - score(b)).slice(0, 2);
}

export function gossip(world: World, character: Character, tick: number): boolean {
  if (character.jailed) return false;
  const activity = world.scheduleActivity(character);
  if (activity === "sleep") return false;
  if (tick - (character.lastSocialTick ?? -999) < 12) return false;
  const beliefs = eligibleBeliefs(world, character.id, tick);
  if (beliefs.length === 0) return false;

  const listeners = priorityListeners(world, character);
  if (listeners.length === 0) return false;
  character.lastSocialTick = tick;
  return spreadRumor(world, character.id, listeners, beliefs[0], { tick });
}

/** 机构脉冲可以无视“刚说过”的冷却；它本来就是每小时一次的放大。 */
function pulseBeliefs(world: World, holderId: string): Belief[] {
  const relevantKinds = new Set(["crime", "law", "fire", "testimony", "suspicion", "trade"]);
  return world
    .beliefsOf(holderId)
    .filter((belief) => {
      const fact = factFor(world, belief.factId);
      if (!fact) return false;
      return fact.status !== "superseded" && relevantKinds.has(fact.kind) && fact.salience >= 0.45;
    })
    .sort((a, b) => {
      const fa = factFor(world, a.factId)?.salience ?? 0;
      const fb = factFor(world, b.factId)?.salience ?? 0;
      return fb * b.confidence - fa * a.confidence;
    });
}

/** 市场/码头的群体每小时把已知传闻放大一次。 */
export function institutionPulse(world: World, tick: number): number {
  if (tick % 6 !== 0) return 0;
  let sent = 0;
  for (const crowd of world.state.crowds) {
    if (tick - (crowd.lastPulseTick ?? -999) < 6) continue;
    const beliefs = pulseBeliefs(world, crowd.id);
    if (beliefs.length === 0) continue;
    const listeners = world.occupants(crowd.roomId).filter((id) => id !== crowd.id).slice(0, 4);
    if (listeners.length === 0) continue;
    crowd.lastPulseTick = tick;
    if (spreadRumor(world, crowd.id, listeners, beliefs[0], { tick })) sent++;
  }
  return sent;
}

export function tellDirectly(
  world: World,
  speakerId: string,
  listenerId: string,
  belief: Belief,
  tick: number,
  content?: string,
): boolean {
  return spreadRumor(world, speakerId, [listenerId], belief, { tick, content });
}
