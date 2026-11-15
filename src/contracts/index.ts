/**
 * P0 冻结契约（仅类型，不依赖 demos/）。
 *
 * 这些接口是 ARCHITECTURE §4 的执行版本。M1 之后共享模块应 import 这里，
 * 而不是继续复制 demo 的局部类型。字段可以向后兼容地扩展，但方向不能反转：
 * 世界 → 事件 → 投影/知识 → 感知 → 心智 → 意图 → 规则 → 事件。
 */

export type EventSource = "ambient" | "actor" | "special" | "system";
export type Visibility = "private" | "room" | "place" | "public";
export type FactStatus = "active" | "resolved" | "superseded";
export type PlanState =
  | "proposed"
  | "validated"
  | "scheduled"
  | "pending"
  | "resolving"
  | "resolved"
  | "aborted";

export type CharacterKind = "companion" | "npc" | "crowd";
export type CharacterTier = "T0" | "T1" | "T2" | "T3" | "companion";
export type LodLevel = "focus" | "near" | "ambient" | "offstage";
export type DetailLevel = "full" | "summary" | "index" | "aggregate" | "none";

export interface Fact {
  id: string;
  kind: string;
  subjectId: string;
  objectId?: string;
  placeId: string;
  detail: Record<string, string | number | boolean | string[]>;
  status: FactStatus;
  salience: number;
  summary: string;
  sourceEventId: string;
  validFromTick: number;
  validToTick?: number;
}

export interface Observation {
  factId: string;
  observerId: string;
  channel: "sight" | "hearing" | "rumor" | "inference";
  confidence: number;
  sourceEventId: string;
  learnedAtTick: number;
}

export interface Belief {
  factId: string;
  content: string;
  confidence: number;
  sourceEventId: string;
  learnedAtTick: number;
  version: number;
  hops: number;
  originPlaceId: string;
  suspectId?: string;
}

export interface Trace {
  id: string;
  kind: string;
  placeId: string;
  roomId: string;
  description: string;
  sourceEventId: string;
  factId?: string;
  createdTick: number;
  expiresTick?: number;
  visible: boolean;
}

export interface Provenance {
  source: EventSource;
  planId?: string;
  proposalId?: string;
  model?: string;
  seed?: string;
  ruleVersion: string;
  injected?: boolean;
}

export interface WorldEvent {
  id: string;
  tick: number;
  type: string;
  actorId?: string;
  roomId: string;
  placeId: string;
  witnesses: string[];
  sourceEventIds: string[];
  visibility: Visibility;
  facts: Fact[];
  traces: Trace[];
  payload: Record<string, unknown>;
  provenance: Provenance;
}

export interface EventProposal {
  id: string;
  type: string;
  placeId: string;
  roomId: string;
  actorIds: string[];
  targetIds: string[];
  timeWindow: { startTick: number; endTick: number };
  direction: string;
  stakes: number;
  preconditions: string[];
  branches: { onSuccess: string; onFailure: string; onPartial?: string };
  visibility: Visibility;
  reason: string;
  confidence: number;
}

export interface EventPlan {
  id: string;
  source: EventSource;
  type: string;
  placeId: string;
  roomId: string;
  actorIds: string[];
  targetIds: string[];
  factionIds: string[];
  timeWindow: { startTick: number; endTick: number };
  direction: string;
  stakes: number;
  preconditions: string[];
  branches: { onSuccess: string; onFailure: string; onPartial?: string };
  visibility: Visibility;
  createdBy: "rule" | "action-dm" | "world-director" | "canon";
  proposalId?: string;
  parentPlanId?: string;
  state: PlanState;
  payload: Record<string, unknown>;
  createdAtTick: number;
}

export interface Intent {
  verb: string;
  targetId?: string;
  instrumentId?: string;
  manner?: string;
  goal?: string;
  source: "mind" | "script" | "utility" | "channel";
}

export interface ActionDemand {
  actionId: string;
  verb: string;
  dims: Record<string, number>;
  assist: Record<string, number>;
  ontologyTags: string[];
  channels: string[];
}

export interface OutcomeFact {
  kind: string;
  subjectId: string;
  objectId?: string;
  placeId: string;
  detail?: Record<string, string | number | boolean | string[]>;
  salience: number;
  summary: string;
}

export interface Outcome {
  intent: Intent;
  success: boolean;
  grade: "critical" | "success" | "partial" | "failure" | "critical-failure";
  facts: OutcomeFact[];
  traceIds: string[];
  witnessIds: string[];
  summary: string;
}

export interface ChannelEvent {
  id: string;
  channelId: string;
  ownerId: string;
  rawText: string;
  percept: string;
  arriveTick: number;
  integrity: number;
  exposure: number;
}

export interface MemoryRecord {
  id: string;
  ownerId: string;
  kind: "episodic" | "semantic" | "relationship" | "body" | "commitment";
  text: string;
  sourceEventId: string;
  factIds: string[];
  salience: number;
  confidence: number;
  createdAtTick: number;
  lastRecalledAtTick?: number;
  consolidatedInto?: string;
  redacted?: boolean;
}

export interface PersonaState {
  version: number;
  anchors: { values: string[]; taboos: string[]; voice: string };
  axes: Record<string, number>;
  updatedAtTick: number;
  sourceEventIds: string[];
}

export interface CharacterRecord {
  id: string;
  name: string;
  role: string;
  tier: CharacterTier;
  identityHash: string;
  relationships: Record<string, { trust: number; affinity: number; fear: number }>;
  keyMemories: MemoryRecord[];
  needs: Record<string, number>;
  mood: Record<string, number>;
  currentRoomId: string;
  schedule: Array<{ startTick: number; endTick: number; activity: string; roomId: string; priority: number }>;
  lastState: string;
  lastTick: number;
  tombstone: boolean;
}

export interface Perception {
  self: {
    id: string;
    body: Record<string, unknown>;
    social: Record<string, unknown>;
  };
  place: { regionId: string; settlementId: string; roomId: string; light: string };
  present: Array<{ id: string; kind: CharacterKind }>;
  audible: Array<{ sourceId?: string; text: string; clarity: number }>;
  visibleFacts: Array<{ id: string; kind: string; summary: string; confidence: number }>;
  channelEvents: ChannelEvent[];
  gaps: string[];
  uncertainty: number;
}

export interface DecisionContext {
  tick: number;
  viewLevel: LodLevel;
  observerRoomId?: string;
  question?: string;
}

export interface CharacterSnapshot {
  id: string;
  name: string;
  kind: CharacterKind;
  tier: CharacterTier;
  identityHash: string;
  roomId: string;
  activity: string;
  relationships: CharacterRecord["relationships"];
  keyMemories: MemoryRecord[];
  needs?: Record<string, number>;
  mood?: Record<string, number>;
  memberCount?: number;
  detailLevel: DetailLevel;
  lastEventId?: string;
  observed: boolean;
}

/**
 * `decide` 必须同步：规则 tick 要可确定回放。
 * LLM 的“想做什么”由 Mind.propose() 在异步注意力点先算，再把 Intent 交给 runtime。
 */
export interface CharacterRuntime {
  readonly id: string;
  readonly kind: CharacterKind;
  perceive(world: unknown, level?: LodLevel): Perception;
  decide(world: unknown, context: DecisionContext): Intent | null;
  act(world: unknown, intent: Intent, tick: number): { ok: boolean; eventIds: string[]; detail: string };
  onEvent(event: Pick<WorldEvent, "id" | "type" | "tick">): void;
  snapshot(world: unknown): CharacterSnapshot;
}

export interface Mind {
  propose(perception: Perception, memory: MemoryRecord[], persona: PersonaState): Promise<Intent | null>;
}

export interface LlmPort {
  chat(request: {
    model: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: "text" | "json";
    thinking?: boolean;
  }): Promise<{ content: string; model: string; usage?: { promptTokens?: number; completionTokens?: number } }>;
}
