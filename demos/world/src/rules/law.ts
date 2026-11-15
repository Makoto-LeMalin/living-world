/**
 * 执法：传闻 → 调查 → 问证 → 指控 → 拘禁。
 * 守卫只依据自己知道的 belief 行动；抓错人时 canonical 仍然保留真实 culpritId。
 */

import { clamp } from "../world/canon.ts";
import { provenance, type World } from "../world/world.ts";
import { nextRoomToward } from "../agents/runtime.ts";
import type { Belief, Fact } from "../types.ts";

export function theftFact(world: World): Fact | undefined {
  return [...world.state.facts]
    .reverse()
    .find((fact) => fact.kind === "crime" && fact.detail.culpritId);
}

export function guardKnowledge(world: World, guardId: string, factId: string): Belief | undefined {
  return world.character(guardId).beliefs.find((belief) => belief.factId === factId);
}

export function investigate(
  world: World,
  guardId: string,
  crimeFactId: string,
  suspectId: string,
  basisEventId: string,
): string {
  const guard = world.character(guardId);
  const crime = world.state.facts.find((fact) => fact.id === crimeFactId);
  const confidence = guardKnowledge(world, guardId, crimeFactId)?.confidence ?? 0.4;
  const suspectName = world.maybeCharacter(suspectId)?.name ?? suspectId;
  const event = world.emit({
    type: "Investigated",
    actorId: guardId,
    roomId: guard.currentRoomId,
    visibility: "room",
    sourceEventIds: [basisEventId],
    payload: { crimeFactId, suspectId, evidence: "rumor", confidence },
    facts: [
      {
        kind: "law",
        subjectId: guardId,
        objectId: suspectId,
        placeId: world.placeOfRoom(guard.currentRoomId),
        detail: {
          crimeFactId,
          suspectId,
          evidence: "rumor",
          confidence,
          actualCulpritId: String(crime?.detail.culpritId ?? ""),
        },
        salience: 0.62,
        summary: `守卫罗恩开始调查集市失窃，先盯上了${suspectName}。`,
      },
    ],
    provenance: provenance("actor", { seed: world.seed }),
  });
  return event.id;
}

export function questionWitness(
  world: World,
  guardId: string,
  witnessId: string,
  crimeFactId: string,
  actualCulpritId: string,
): string {
  const guard = world.character(guardId);
  const witness = world.character(witnessId);
  const crime = world.state.facts.find((fact) => fact.id === crimeFactId);
  const event = world.emit({
    type: "WitnessStatement",
    actorId: guardId,
    roomId: guard.currentRoomId,
    visibility: "room",
    witnesses: [witness.id, "npc_merchant"],
    sourceEventIds: [crime?.sourceEventId ?? ""].filter(Boolean),
    payload: {
      witnessId,
      crimeFactId,
      actualCulpritId,
      relation: "船夫的儿子",
    },
    facts: [
      {
        kind: "testimony",
        subjectId: witnessId,
        objectId: actualCulpritId,
        placeId: world.placeOfRoom(guard.currentRoomId),
        detail: {
          witnessId,
          crimeFactId,
          suspectId: actualCulpritId,
          actualCulpritId,
          relation: "船夫的儿子",
          certainty: 0.7,
        },
        salience: 0.74,
        summary: `小满告诉罗恩：偷面包的是船夫的儿子阿潜，不是那个乞丐。`,
      },
    ],
    provenance: provenance("actor", { seed: world.seed }),
  });
  // 证词会修正小满自己的说法；但不自动修正守卫已经形成的怀疑。
  world.emit({
    type: "BeliefRevised",
    actorId: witnessId,
    roomId: witness.currentRoomId,
    visibility: "private",
    payload: {
      holderId: witnessId,
      factId: crimeFactId,
      content: "偷面包的是船夫的儿子阿潜。",
      confidence: 0.85,
      suspectId: actualCulpritId,
    },
    provenance: provenance("actor", { seed: world.seed }),
  });
  return event.id;
}

export function accuse(
  world: World,
  guardId: string,
  suspectId: string,
  crimeFactId: string,
  basisEventId: string,
): string {
  const guard = world.character(guardId);
  const event = world.emit({
    type: "Accused",
    actorId: guardId,
    roomId: guard.currentRoomId,
    visibility: "room",
    sourceEventIds: [basisEventId],
    payload: { suspectId, crimeFactId, basisEventId },
    facts: [
      {
        kind: "suspicion",
        subjectId: guardId,
        objectId: suspectId,
        placeId: world.placeOfRoom(guard.currentRoomId),
        detail: { suspectId, crimeFactId, basisEventId },
        salience: 0.7,
        summary: `罗恩当众指认乞丐灰耳偷了面包，灰耳没有辩解。`,
      },
    ],
    provenance: provenance("actor", { seed: world.seed }),
  });
  return event.id;
}

export function jail(
  world: World,
  guardId: string,
  suspectId: string,
  crimeFactId: string,
  basisEventId: string,
  actualCulpritId: string,
): string {
  const guard = world.character(guardId);
  const suspect = world.character(suspectId);
  const crime = world.state.facts.find((fact) => fact.id === crimeFactId);
  const wrongful = suspectId !== actualCulpritId;
  const event = world.emit({
    type: "Jailed",
    actorId: guardId,
    roomId: suspect.currentRoomId,
    visibility: "public",
    sourceEventIds: [basisEventId, crime?.sourceEventId ?? ""].filter(Boolean),
    payload: {
      characterId: suspectId,
      roomId: "jail",
      reason: "theft",
      crimeFactId,
      wrongful,
      actualCulpritId,
    },
    facts: [
      {
        kind: "law",
        subjectId: suspectId,
        objectId: "jail",
        placeId: "market",
        detail: {
          crimeFactId,
          suspectId,
          actualCulpritId,
          wrongful,
          reason: "theft",
        },
        salience: 0.88,
        summary: wrongful
          ? "守卫把乞丐灰耳关进了拘留所；孩子后来却说，偷面包的是船夫的儿子。"
          : "守卫把偷面包的人关进了拘留所。",
      },
    ],
    traces: [
      {
        kind: "jail",
        roomId: "jail",
        description: "拘留所的铁栏后多了一个蜷着的人影。",
      },
    ],
    provenance: provenance("actor", { seed: world.seed }),
  });
  // 被拘禁者的情绪与关系。
  suspect.mood.fear = clamp(suspect.mood.fear + 0.25);
  suspect.mood.anger = clamp(suspect.mood.anger + 0.2);
  suspect.relationships[guardId] = {
    trust: clamp((suspect.relationships[guardId]?.trust ?? 0.2) - 0.3),
    affinity: clamp((suspect.relationships[guardId]?.affinity ?? 0) - 0.2),
    fear: clamp((suspect.relationships[guardId]?.fear ?? 0.5) + 0.3),
  };
  world.refreshClimate("market", wrongful ? "守卫抓了乞丐，但有人说是抓错了" : "守卫抓了偷面包的人");
  return event.id;
}

export interface LawStepResult {
  investigated?: string;
  statement?: string;
  accused?: string;
  jailed?: string;
  skipped?: string;
}

/** 规则驱动的执法节拍；不再依赖固定 tick。 */
export function runLawChain(world: World, tick: number): LawStepResult {
  const result: LawStepResult = {};
  const guard = world.maybeCharacter("npc_guard");
  if (!guard || guard.jailed) return { skipped: "no guard" };
  const crime = theftFact(world);
  if (!crime) return { skipped: "no crime fact" };
  const actualCulpritId = String(crime.detail.culpritId);
  const guardBelief = guardKnowledge(world, guard.id, crime.id);
  if (!guardBelief) return { skipped: "guard has no knowledge" };
  if (guard.lastLawTick !== undefined && tick - guard.lastLawTick < 6) {
    return { skipped: "cooldown" };
  }

  const investigation = world.state.facts.find(
    (fact) => fact.kind === "law" && fact.detail.crimeFactId === crime.id && fact.detail.evidence === "rumor",
  );
  if (!investigation) {
    if (guard.currentRoomId !== "market_square") {
      const next = nextRoomToward(world, guard.currentRoomId, "market_square");
      if (next) {
        world.moveCharacter(guard.id, next, "follow up rumor");
        return { skipped: "moving to market" };
      }
    }
    result.investigated = investigate(world, guard.id, crime.id, guardBelief.suspectId ?? "npc_beggar", guardBelief.sourceEventId);
    guard.lastLawTick = tick;
    return result;
  }

  const statement = world.state.facts.find(
    (fact) => fact.kind === "testimony" && fact.detail.crimeFactId === crime.id,
  );
  if (!statement) {
    const child = world.maybeCharacter("npc_child");
    if (!child || child.currentRoomId !== guard.currentRoomId) return { skipped: "witness not present" };
    result.statement = questionWitness(world, guard.id, child.id, crime.id, actualCulpritId);
    guard.lastLawTick = tick;
    return result;
  }

  const accusation = world.state.facts.find(
    (fact) => fact.kind === "suspicion" && fact.detail.crimeFactId === crime.id,
  );
  const jailed = world.state.facts.find(
    (fact) => fact.kind === "law" && fact.detail.reason === "theft" && fact.detail.suspectId,
  );
  if (!accusation) {
    const suspectId = String(investigation.detail.suspectId ?? "npc_beggar");
    result.accused = accuse(world, guard.id, suspectId, crime.id, investigation.sourceEventId);
    guard.lastLawTick = tick;
    return result;
  }

  if (!jailed) {
    const suspectId = String(accusation.detail.suspectId ?? "npc_beggar");
    result.jailed = jail(world, guard.id, suspectId, crime.id, accusation.sourceEventId, actualCulpritId);
    guard.lastLawTick = tick;
    return result;
  }

  return result;
}
