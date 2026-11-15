/**
 * World 是事件日志 + 投影的唯一入口。
 *
 * 规则层只调用 emit；emit 负责：
 *   计算目击者 → 生成 fact/trace id → 追加 WorldEvent → apply 投影。
 * 这样状态不是“规则随手改的”，而是可以从日志重建的。
 */

import { hashCanonical } from "../../../../src/kernel/canonical-json.ts";
import { dayOf, tickOfDay } from "../../../../src/kernel/clock.ts";
import { formatId } from "../../../../src/kernel/ids.ts";
import { roll, stream } from "../../../../src/kernel/rng.ts";
import {
  readJsonLines,
  readSnapshotFile,
  writeJsonLines,
  writeSnapshotFile,
} from "../../../../src/kernel/snapshot.ts";
import { Space } from "../../../../src/space/index.ts";
import { EventStore } from "../../../../src/world/event-store.ts";
import type { Projection } from "../../../../src/world/projection.ts";
import {
  clamp,
  RULE_VERSION,
} from "./canon.ts";
import type {
  Belief,
  Character,
  Commodity,
  Crowd,
  EventPlan,
  EventSource,
  Fact,
  FactStatus,
  Mood,
  Observation,
  Provenance,
  Room,
  RouteSegment,
  SocialClimate,
  Trace,
  Visibility,
  WorldEvent,
  WorldState,
} from "../types.ts";

export interface FactDraft {
  kind: Fact["kind"];
  subjectId: string;
  objectId?: string;
  placeId?: string;
  detail?: Fact["detail"];
  salience: number;
  summary: string;
  validFromTick?: number;
  validToTick?: number;
}

export interface TraceDraft {
  kind: string;
  roomId?: string;
  placeId?: string;
  description: string;
  factId?: string;
  expiresTick?: number;
  visible?: boolean;
}

export interface EmitSpec {
  type: string;
  tick?: number;
  actorId?: string;
  roomId?: string;
  placeId?: string;
  visibility?: Visibility;
  witnesses?: string[];
  excludeIds?: string[];
  sourceEventIds?: string[];
  facts?: FactDraft[];
  traces?: TraceDraft[];
  payload?: Record<string, unknown>;
  provenance: Provenance;
}

const SOURCE_ORDER: EventSource[] = ["ambient", "actor", "special", "system"];

function provenance(source: EventSource, extra: Partial<Provenance> = {}): Provenance {
  return { source, ruleVersion: RULE_VERSION, ...extra };
}

export class World implements Projection<WorldEvent> {
  state: WorldState;
  readonly space: Space<Room, RouteSegment>;
  readonly events: EventStore<WorldEvent>;

  constructor(state: WorldState, events: WorldEvent[] = state.eventLog ?? []) {
    this.state = state;
    this.state.eventLog = events;
    this.space = new Space(state.rooms, state.routes);
    this.events = new EventStore(events);
  }

  static fromSnapshot(snapshot: WorldState, events: WorldEvent[] = []): World {
    return new World(structuredClone(snapshot), events);
  }

  get seed(): string {
    return this.state.config.worldSeed;
  }

  room(id: string): Room {
    return this.space.room(id);
  }

  character(id: string): Character {
    const found = this.state.characters.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`未知角色: ${id}`);
    return found;
  }

  maybeCharacter(id: string): Character | undefined {
    return this.state.characters.find((candidate) => candidate.id === id);
  }

  crowd(id: string): Crowd {
    const found = this.state.crowds.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`未知群体: ${id}`);
    return found;
  }

  maybeCrowd(id: string): Crowd | undefined {
    return this.state.crowds.find((candidate) => candidate.id === id);
  }

  placeOfRoom(roomId: string): string {
    return this.space.placeOfRoom(roomId);
  }

  placeOfActor(actorId: string): string | undefined {
    if (actorId === this.state.pc.id) return this.placeOfRoom(this.state.pc.currentRoomId);
    const character = this.maybeCharacter(actorId);
    if (character) return this.placeOfRoom(character.currentRoomId);
    const crowd = this.maybeCrowd(actorId);
    if (crowd) return this.placeOfRoom(crowd.roomId);
    return undefined;
  }

  occupants(roomId: string): string[] {
    const result: string[] = [];
    for (const character of this.state.characters) {
      if (character.currentRoomId === roomId) result.push(character.id);
    }
    for (const crowd of this.state.crowds) {
      if (crowd.roomId === roomId) result.push(crowd.id);
    }
    if (this.state.pc.currentRoomId === roomId) result.push(this.state.pc.id);
    return result;
  }

  placeOccupants(placeId: string): string[] {
    const result: string[] = [];
    for (const character of this.state.characters) {
      if (this.placeOfRoom(character.currentRoomId) === placeId) result.push(character.id);
    }
    for (const crowd of this.state.crowds) {
      if (this.placeOfRoom(crowd.roomId) === placeId) result.push(crowd.id);
    }
    if (this.placeOfRoom(this.state.pc.currentRoomId) === placeId) result.push(this.state.pc.id);
    return result;
  }

  /** 指定房间集合内的在场者；保留 characters → crowds → pc 的全局顺序。 */
  occupantsIn(roomIds: ReadonlySet<string>): string[] {
    const result: string[] = [];
    for (const character of this.state.characters) {
      if (roomIds.has(character.currentRoomId)) result.push(character.id);
    }
    for (const crowd of this.state.crowds) {
      if (roomIds.has(crowd.roomId)) result.push(crowd.id);
    }
    if (roomIds.has(this.state.pc.currentRoomId)) result.push(this.state.pc.id);
    return result;
  }

  beliefsOf(id: string): Belief[] {
    if (id === this.state.pc.id) return this.state.pc.beliefs;
    const character = this.maybeCharacter(id);
    if (character) return character.beliefs;
    const crowd = this.maybeCrowd(id);
    if (crowd) return crowd.beliefs;
    return [];
  }

  moodOf(id: string): Mood | undefined {
    if (id === this.state.pc.id) return undefined;
    return this.maybeCharacter(id)?.mood ?? this.maybeCrowd(id)?.mood;
  }

  currentActivity(character: Character): string {
    if (character.jailed) return "jailed";
    return this.scheduleActivity(character);
  }

  scheduleActivity(character: Character): string {
    const tod = tickOfDay(this.state.tick, this.state.config.ticksPerDay);
    const block = character.schedule.find(
      (candidate) => tod >= candidate.startTick && tod < candidate.endTick,
    );
    return block?.activity ?? "home";
  }

  activeFacts(): Fact[] {
    return this.state.facts.filter((fact) => fact.status === "active");
  }

  tracesIn(placeId: string): Trace[] {
    return this.state.traces.filter((trace) => trace.placeId === placeId);
  }

  visibleIdsAt(placeId: string): string[] {
    const landmarks = this.space
      .roomsInPlace(placeId)
      .flatMap((room) => room.landmarks.map((landmark) => landmark.id));
    const characters = this.state.characters
      .filter((character) => this.placeOfRoom(character.currentRoomId) === placeId)
      .map((character) => character.id);
    const crowds = this.state.crowds
      .filter((crowd) => this.placeOfRoom(crowd.roomId) === placeId)
      .map((crowd) => crowd.id);
    const traces = this.state.traces
      .filter((trace) => trace.placeId === placeId && trace.visible)
      .map((trace) => trace.id);
    return [...new Set([...landmarks, ...characters, ...crowds, ...traces])].sort();
  }

  /** 目击者不是“所有在场者”，而是经过注意力/光线/遮挡过滤后的集合。 */
  computeWitnesses(spec: EmitSpec, eventId: number): string[] {
    const roomId = spec.roomId ?? this.state.pc.currentRoomId;
    const visibility = spec.visibility ?? "room";
    if (visibility === "private") return [];

    const scope = new Set(this.space.scopeRoomIds(visibility, roomId));
    const candidates = this.occupantsIn(scope);
    const room = this.room(roomId);
    const lightFactor = room.light === "bright" ? 1 : room.light === "dim" ? 0.72 : 0.32;
    const concealment = typeof spec.payload?.concealment === "string" ? 0.62 : 1;
    const excluded = new Set([spec.actorId, ...(spec.excludeIds ?? [])].filter(Boolean));

    const witnesses: string[] = [];
    for (const candidate of candidates) {
      if (excluded.has(candidate)) continue;
      if (candidate === this.state.pc.id) {
        // 观察者不是全知；如果它不在场，不会出现在 candidate 里。
        witnesses.push(candidate);
        continue;
      }
      const character = this.maybeCharacter(candidate);
      if (character) {
        const sleeping = this.scheduleActivity(character) === "sleep";
        const base = character.attention * lightFactor * concealment * (sleeping ? 0.05 : 1);
        if (roll(this.seed, "witness", eventId, character.id) < base) witnesses.push(candidate);
        continue;
      }
      const crowd = this.maybeCrowd(candidate);
      if (crowd) {
        const base = crowd.attention * lightFactor * concealment;
        if (roll(this.seed, "witness", eventId, crowd.id) < base) witnesses.push(candidate);
      }
    }
    return witnesses;
  }

  emit(spec: EmitSpec): WorldEvent {
    const tick = spec.tick ?? this.state.tick;
    const actor = spec.actorId ? this.maybeCharacter(spec.actorId) : undefined;
    const roomId = spec.roomId ?? actor?.currentRoomId ?? this.state.pc.currentRoomId;
    const room = this.room(roomId);
    const placeId = spec.placeId ?? room.placeId;
    const eventNumber = this.state.nextEventId++;
    const id = formatId("e", eventNumber, 6);

    const witnesses = spec.witnesses ? [...new Set(spec.witnesses)] : this.computeWitnesses(spec, eventNumber);

    const facts: Fact[] = (spec.facts ?? []).map((draft) => {
      const factId = formatId("f", this.state.nextFactId++, 5);
      return {
        id: factId,
        kind: draft.kind,
        subjectId: draft.subjectId,
        objectId: draft.objectId,
        placeId: draft.placeId ?? placeId,
        detail: draft.detail ?? {},
        status: "active",
        salience: clamp(draft.salience),
        traceIds: [],
        summary: draft.summary,
        validFromTick: draft.validFromTick ?? tick,
        validToTick: draft.validToTick,
        sourceEventId: id,
      };
    });

    const traces: Trace[] = (spec.traces ?? []).map((draft) => {
      const traceId = formatId("t", this.state.nextTraceId++, 5);
      return {
        id: traceId,
        kind: draft.kind,
        placeId: draft.placeId ?? placeId,
        roomId: draft.roomId ?? roomId,
        description: draft.description,
        sourceEventId: id,
        factId: draft.factId,
        createdTick: tick,
        expiresTick: draft.expiresTick,
        visible: draft.visible ?? true,
      };
    });

    for (const trace of traces) {
      if (!trace.factId) continue;
      const fact = facts.find((candidate) => candidate.id === trace.factId);
      fact?.traceIds.push(trace.id);
    }

    const event: WorldEvent = {
      id,
      tick,
      type: spec.type,
      actorId: spec.actorId,
      roomId,
      placeId,
      witnesses,
      sourceEventIds: spec.sourceEventIds ?? [],
      visibility: spec.visibility ?? "room",
      facts,
      traces,
      payload: spec.payload ?? {},
      provenance: spec.provenance,
    };

    this.events.append(event);
    this.apply(event);
    this.state.metrics.events++;
    this.state.metrics.eventsBySource[event.provenance.source] =
      (this.state.metrics.eventsBySource[event.provenance.source] ?? 0) + 1;
    this.state.metrics.eventsByType[event.type] = (this.state.metrics.eventsByType[event.type] ?? 0) + 1;
    return event;
  }

  apply(event: WorldEvent): void {
    for (const fact of event.facts) this.state.facts.push(fact);
    for (const trace of event.traces) this.state.traces.push(trace);

    if (event.facts.length > 0) {
      for (const witness of event.witnesses) this.recordObservation(witness, event);
      // 行动者知道自己在做什么；即使没有被自己“目击”，也要有对应的信念。
      if (event.actorId && !event.witnesses.includes(event.actorId)) {
        this.recordObservation(event.actorId, event, "inference", 0.95);
      }
    }

    const payload = event.payload;
    switch (event.type) {
      case "FactStatusChanged": {
        const fact = this.state.facts.find((candidate) => candidate.id === payload.factId);
        if (fact) {
          fact.status = payload.status as FactStatus;
          if (typeof payload.tick === "number") fact.validToTick = payload.tick;
        }
        break;
      }
      case "Moved": {
        const toRoomId = String(payload.toRoomId);
        if (event.actorId === this.state.pc.id) {
          this.state.pc.currentRoomId = toRoomId;
        } else if (event.actorId) {
          const character = this.maybeCharacter(event.actorId);
          if (character) character.currentRoomId = toRoomId;
        }
        break;
      }
      case "Jailed": {
        const characterId = String(payload.characterId);
        const character = this.maybeCharacter(characterId);
        if (character) {
          character.jailed = true;
          character.busyPlanId = undefined;
          character.currentRoomId = String(payload.roomId ?? "jail");
        }
        break;
      }
      case "Released": {
        const character = this.maybeCharacter(String(payload.characterId));
        if (character) {
          character.jailed = false;
          character.currentRoomId = character.homeRoomId;
        }
        break;
      }
      case "PriceChanged": {
        const commodity = payload.commodity as Commodity;
        const to = Number(payload.to);
        if (Number.isFinite(to)) this.state.prices[commodity] = Math.max(0.5, Math.round(to * 100) / 100);
        break;
      }
      case "StockChanged": {
        const roomStocks = this.state.stocks[String(payload.roomId)] ?? {};
        const commodity = payload.commodity as Commodity;
        const current = roomStocks[commodity] ?? 0;
        roomStocks[commodity] = Math.max(0, Math.floor(current + Number(payload.delta)));
        this.state.stocks[String(payload.roomId)] = roomStocks;
        break;
      }
      case "CoinsChanged": {
        const character = this.maybeCharacter(String(payload.characterId));
        if (character) character.coins = Math.max(0, character.coins + Number(payload.delta));
        break;
      }
      case "MoodChanged": {
        const holder = this.maybeCharacter(String(payload.holderId)) ?? this.maybeCrowd(String(payload.holderId));
        if (holder) {
          for (const [key, value] of Object.entries(payload.delta as Partial<Mood>)) {
            if (key in holder.mood) holder.mood[key as keyof Mood] = clamp(holder.mood[key as keyof Mood] + Number(value));
          }
        }
        break;
      }
      case "ClimateUpdated": {
        this.state.climate[String(payload.placeId)] = payload.climate as SocialClimate;
        break;
      }
      case "PlanCreated": {
        const plan = payload.plan as EventPlan;
        if (!this.state.plans.some((candidate) => candidate.id === plan.id)) {
          this.state.plans.push(structuredClone(plan));
          this.state.metrics.plans.created++;
        }
        break;
      }
      case "PlanStateChanged": {
        const plan = this.state.plans.find((candidate) => candidate.id === payload.planId);
        if (plan) {
          plan.state = payload.to as EventPlan["state"];
          if (plan.state === "resolved") this.state.metrics.plans.resolved++;
          if (plan.state === "aborted") this.state.metrics.plans.aborted++;
        }
        break;
      }
      case "RumorTold": {
        this.applyRumorTold(event);
        break;
      }
      case "BeliefRevised": {
        const holder = String(payload.holderId);
        const beliefs = this.beliefsOf(holder);
        const existing = beliefs.find((belief) => belief.factId === payload.factId);
        if (existing) {
          existing.content = String(payload.content);
          existing.confidence = clamp(Number(payload.confidence));
          existing.version++;
          existing.learnedAtTick = event.tick;
          existing.suspectId = typeof payload.suspectId === "string" ? payload.suspectId : existing.suspectId;
        }
        break;
      }
      case "ScheduleDeviation": {
        const character = this.maybeCharacter(String(payload.characterId));
        if (character) character.deviations++;
        this.state.metrics.schedule.violations++;
        break;
      }
      case "EncounterResolved": {
        this.state.metrics.travelEncounters++;
        break;
      }
      case "BudgetConsumed": {
        const kind = String(payload.kind);
        const key = String(payload.key);
        const amount = Number(payload.amount ?? 1);
        if (kind === "director") {
          this.state.budget.directorCallsByDay[key] = (this.state.budget.directorCallsByDay[key] ?? 0) + amount;
          const reason = String(payload.reason ?? "ambient");
          const reasonKey = `${reason}:${key}`;
          this.state.budget.directorCallsByReason[reasonKey] =
            (this.state.budget.directorCallsByReason[reasonKey] ?? 0) + amount;
        } else if (kind === "character") {
          this.state.budget.characterCallsByDay[key] = (this.state.budget.characterCallsByDay[key] ?? 0) + amount;
          const lod = String(payload.lod ?? "focus");
          const lodKey = `${lod}:${key}`;
          this.state.budget.characterCallsByLod[lodKey] = (this.state.budget.characterCallsByLod[lodKey] ?? 0) + amount;
          const npcId = String(payload.npcId ?? "unknown");
          const npcKey = `${npcId}:${key}`;
          this.state.budget.characterCallsByNpc[npcKey] = (this.state.budget.characterCallsByNpc[npcKey] ?? 0) + amount;
          const tickKey = String(event.tick);
          this.state.budget.characterCallsByTick[tickKey] =
            (this.state.budget.characterCallsByTick[tickKey] ?? 0) + amount;
        } else if (kind === "high-salience") {
          this.state.budget.highSalienceByPlaceDay[key] = (this.state.budget.highSalienceByPlaceDay[key] ?? 0) + amount;
        }
        break;
      }
      case "BudgetDegraded": {
        const reason = String(payload.reason ?? "unknown");
        this.state.budget.degradedByReason[reason] = (this.state.budget.degradedByReason[reason] ?? 0) + 1;
        this.state.metrics.budgetDegraded++;
        break;
      }
      default:
        break;
    }
  }

  private recordObservation(
    witnessId: string,
    event: WorldEvent,
    channel: "sight" | "hearing" | "rumor" | "inference" = "sight",
    confidenceOverride?: number,
  ): void {
    for (const fact of event.facts) {
      const content = fact.summary;
      const baseConfidence = confidenceOverride ?? (channel === "sight" ? 0.8 : 0.95);
      // 犯罪事实的 canonical culpritId 不自动进入目击者信念：
      // 目击者只看见“一个瘦小的人影”，名字要靠证词/传闻补。
      const suspectId =
        channel === "inference" || fact.kind === "law" || fact.kind === "testimony" || fact.kind === "suspicion"
          ? typeof fact.detail.suspectId === "string"
            ? fact.detail.suspectId
            : typeof fact.detail.culpritId === "string"
              ? fact.detail.culpritId
              : undefined
          : undefined;

      if (witnessId === this.state.pc.id) {
        this.addBelief(this.state.pc.beliefs, {
          factId: fact.id,
          content,
          confidence: event.visibility === "public" ? 0.9 : baseConfidence,
          sourceEventId: event.id,
          learnedAtTick: event.tick,
          version: 1,
          hops: 0,
          originPlaceId: fact.placeId,
          suspectId,
        });
        this.state.pc.observations.push({
          factId: fact.id,
          observerId: witnessId,
          channel,
          confidence: baseConfidence,
          sourceEventId: event.id,
          learnedAtTick: event.tick,
        });
        continue;
      }

      const character = this.maybeCharacter(witnessId);
      if (character) {
        this.addBelief(character.beliefs, {
          factId: fact.id,
          content,
          confidence: baseConfidence,
          sourceEventId: event.id,
          learnedAtTick: event.tick,
          version: 1,
          hops: 0,
          originPlaceId: fact.placeId,
          suspectId,
        });
        character.observations.push({
          factId: fact.id,
          observerId: witnessId,
          channel,
          confidence: baseConfidence,
          sourceEventId: event.id,
          learnedAtTick: event.tick,
        });
        this.appraise(character.mood, fact, character.id === fact.subjectId);
        continue;
      }

      const crowd = this.maybeCrowd(witnessId);
      if (crowd) {
        this.addBelief(crowd.beliefs, {
          factId: fact.id,
          content,
          confidence: Math.min(baseConfidence, 0.6),
          sourceEventId: event.id,
          learnedAtTick: event.tick,
          version: 1,
          hops: 0,
          originPlaceId: fact.placeId,
          suspectId,
        });
        this.appraise(crowd.mood, fact, false);
      }
    }
  }

  private appraise(mood: Mood, fact: Fact, isSubject: boolean): void {
    if (fact.kind === "crime") {
      mood.fear = clamp(mood.fear + (isSubject ? 0.18 : 0.07));
      mood.anger = clamp(mood.anger + (isSubject ? 0.2 : 0.05));
      mood.trust = clamp(mood.trust - (isSubject ? 0.1 : 0.02));
    } else if (fact.kind === "fire") {
      mood.fear = clamp(mood.fear + 0.16);
      mood.hope = clamp(mood.hope - 0.06);
    } else if (fact.kind === "law") {
      mood.suspicion = clamp(mood.suspicion + 0.05);
      mood.trust = clamp(mood.trust - 0.02);
    } else if (fact.kind === "trade") {
      mood.hope = clamp(mood.hope + 0.01);
    }
  }

  private addBelief(beliefs: Belief[], incoming: Belief): void {
    const existing = beliefs.find((belief) => belief.factId === incoming.factId);
    if (!existing) {
      beliefs.push(incoming);
      return;
    }
    // 更高置信度的版本覆盖旧版本；如果新版本给出了具体的“谁”，
    // 允许它在置信度略低时纠正泛泛的传闻。低置信度的泛泛版本不能覆盖具体版本。
    const moreConfident = incoming.confidence > existing.confidence + 0.02;
    const addsSuspect = Boolean(incoming.suspectId) && !existing.suspectId && incoming.confidence >= existing.confidence - 0.05;
    if (moreConfident || addsSuspect) {
      incoming.version = existing.version + 1;
      const index = beliefs.indexOf(existing);
      beliefs[index] = incoming;
    }
  }

  private applyRumorTold(event: WorldEvent): void {
    const payload = event.payload;
    const factId = String(payload.factId);
    const content = String(payload.content);
    const confidence = clamp(Number(payload.confidence));
    const hops = Number(payload.hops);
    const originPlaceId = String(payload.originPlaceId);
    const suspectId = typeof payload.suspectId === "string" ? payload.suspectId : undefined;
    const speakerId = String(payload.speakerId);
    const listenerIds = (payload.listenerIds as string[] | undefined) ?? [];

    const speakerBeliefs = this.beliefsOf(speakerId);
    const speakerBelief = speakerBeliefs.find((belief) => belief.factId === factId);
    if (speakerBelief) speakerBelief.lastToldAtTick = event.tick;

    for (const listenerId of listenerIds) {
      const beliefs = this.beliefsOf(listenerId);
      if (beliefs.length === 0 && listenerId !== this.state.pc.id && !this.maybeCharacter(listenerId) && !this.maybeCrowd(listenerId)) {
        continue;
      }
      this.addBelief(beliefs, {
        factId,
        content,
        confidence,
        sourceEventId: event.id,
        learnedAtTick: event.tick,
        version: 1,
        hops,
        originPlaceId,
        suspectId,
      });
    }

    this.state.metrics.rumors++;
    this.state.metrics.maxRumorHops = Math.max(this.state.metrics.maxRumorHops, hops);
  }

  plan(id: string): EventPlan | undefined {
    return this.state.plans.find((candidate) => candidate.id === id);
  }

  setPlanState(planId: string, to: EventPlan["state"], reason: string, tick = this.state.tick): WorldEvent {
    const plan = this.plan(planId);
    if (!plan) throw new Error(`未知计划: ${planId}`);
    const from = plan.state;
    return this.emit({
      type: "PlanStateChanged",
      tick,
      roomId: plan.roomId,
      placeId: plan.placeId,
      payload: { planId, from, to, reason },
      provenance: provenance("system", { planId }),
    });
  }

  createPlan(plan: Omit<EventPlan, "createdAtTick">, tick = this.state.tick): EventPlan {
    const full: EventPlan = { ...plan, createdAtTick: tick };
    this.emit({
      type: "PlanCreated",
      tick,
      roomId: full.roomId,
      placeId: full.placeId,
      visibility: "private",
      payload: { plan: full },
      provenance: provenance(full.source, {
        planId: full.id,
        proposalId: full.proposalId,
        seed: this.seed,
      }),
    });
    return full;
  }

  changeFactStatus(factId: string, status: FactStatus, reason: string, tick = this.state.tick): WorldEvent {
    return this.emit({
      type: "FactStatusChanged",
      tick,
      payload: { factId, status, reason, tick },
      provenance: provenance("system"),
    });
  }

  moveCharacter(characterId: string, toRoomId: string, reason: string, tick = this.state.tick): WorldEvent {
    const character = this.maybeCharacter(characterId);
    if (!character) throw new Error(`未知角色: ${characterId}`);
    const from = character.currentRoomId;
    return this.emit({
      type: "Moved",
      tick,
      actorId: characterId,
      roomId: from,
      payload: { fromRoomId: from, toRoomId, reason },
      provenance: provenance("actor", { seed: this.seed }),
    });
  }

  movePc(toRoomId: string, reason: string, tick = this.state.tick): WorldEvent {
    const from = this.state.pc.currentRoomId;
    return this.emit({
      type: "Moved",
      tick,
      actorId: this.state.pc.id,
      roomId: from,
      payload: { fromRoomId: from, toRoomId, reason },
      provenance: provenance("actor", { seed: this.seed }),
    });
  }

  rng(...parts: Array<string | number>) {
    return stream(this.seed, ...parts);
  }

  day(): number {
    return dayOf(this.state.tick, this.state.config.ticksPerDay);
  }

  projectionHash(): string {
    const { eventLog: _eventLog, ...projection } = this.state;
    return hashCanonical(projection);
  }

  fullHash(): string {
    return hashCanonical(this.state);
  }

  writeEventLog(path: string): void {
    writeJsonLines(path, this.state.eventLog);
  }

  writeSnapshot(path: string): void {
    const { eventLog: _eventLog, ...snapshot } = this.state;
    writeSnapshotFile(path, snapshot);
  }

  static readSnapshot(path: string, events: WorldEvent[] = []): World {
    const snapshot = readSnapshotFile<WorldState>(path);
    snapshot.eventLog = events;
    return new World(snapshot, events);
  }

  static readEventLog(path: string): WorldEvent[] {
    return readJsonLines<WorldEvent>(path, "事件日志");
  }

  refreshClimate(placeId: string, narrative = "日常"): SocialClimate {
    const roomIds = new Set(this.state.rooms.filter((room) => room.placeId === placeId).map((room) => room.id));
    const entries: Array<{ mood: Mood; weight: number }> = [];
    for (const character of this.state.characters) {
      if (!roomIds.has(character.currentRoomId)) continue;
      const weight = character.tier === "T0" ? 1 : character.tier === "T1" ? 0.7 : 0.4;
      entries.push({ mood: character.mood, weight });
    }
    for (const crowd of this.state.crowds) {
      if (!roomIds.has(crowd.roomId)) continue;
      entries.push({ mood: crowd.mood, weight: crowd.size / 20 });
    }
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0) || 1;
    const average = (key: keyof Mood) =>
      entries.reduce((sum, entry) => sum + entry.mood[key] * entry.weight, 0) / total;
    const climate: SocialClimate = {
      placeId,
      fear: clamp(average("fear")),
      anger: clamp(average("anger")),
      trust: clamp(average("trust")),
      hope: clamp(average("hope")),
      suspicion: clamp(average("suspicion")),
      updatedAtTick: this.state.tick,
      dominantNarrative: narrative,
    };
    this.state.climate[placeId] = climate;
    return climate;
  }

  ensurePlanIds(): void {
    for (const plan of this.state.plans) {
      if (plan.state === "proposed") plan.state = "validated";
    }
  }
}

export { provenance, SOURCE_ORDER };
