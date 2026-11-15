/**
 * 世界 demo 的共享类型。
 *
 * 设计约束：
 * - 世界状态是 EventLog 的投影；规则只能通过 World.emit 写状态。
 * - Fact 是 canonical；角色只持有 Observation / Belief。
 * - 每个 gameplay 事件都带 provenance，至少能追到 source。
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

export type Commodity = "bread" | "grain" | "fish" | "cloth" | "tools";

export type Activity =
  | "sleep"
  | "eat"
  | "work"
  | "trade"
  | "patrol"
  | "worship"
  | "drink"
  | "home"
  | "beg"
  | "play"
  | "case"
  | "hide"
  | "travel";

export interface ScheduleBlock {
  startTick: number;
  endTick: number;
  activity: Activity;
  roomId: string;
  priority: number;
}

export interface Landmark {
  id: string;
  name: string;
  description: string;
}

export interface Room {
  id: string;
  name: string;
  placeId: string;
  kind: string;
  light: "bright" | "dim" | "dark";
  exits: string[];
  landmarks: Landmark[];
}

export interface RouteSegment {
  id: string;
  fromRoomId: string;
  toRoomId: string;
  travelTicks: number;
  traffic: number;
  danger: number;
  patrol: number;
  terrain: "road" | "ferry" | "forest" | "checkpoint";
}

export interface Needs {
  hunger: number;
  fatigue: number;
  safety: number;
  social: number;
  coin: number;
}

export interface Mood {
  fear: number;
  anger: number;
  trust: number;
  hope: number;
  suspicion: number;
}

export interface Relationship {
  trust: number;
  affinity: number;
  fear: number;
}

export interface Skills {
  theft: number;
  perception: number;
  combat: number;
  persuasion: number;
  stealth: number;
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
  /** 可选：听者以为是某人干的；允许与 canonical culpritId 不同。 */
  suspectId?: string;
  lastToldAtTick?: number;
}

export interface Observation {
  factId: string;
  observerId: string;
  channel: "sight" | "hearing" | "rumor" | "inference";
  confidence: number;
  sourceEventId: string;
  learnedAtTick: number;
}

export interface RumorPacket {
  factId: string;
  content: string;
  confidence: number;
  hops: number;
  originPlaceId: string;
  carrierId: string;
  lastToldAtTick: number;
  suspectId?: string;
}

export type DetailLevel = "full" | "summary" | "index" | "aggregate" | "none";
export type LodLevel = "focus" | "near" | "ambient" | "offstage";

/** 降级后的压缩记录：身份、关系、关键记忆、位置、日程、最后状态。 */
export interface CharacterRecord {
  id: string;
  name: string;
  role: string;
  tier: Character["tier"];
  homeRoomId: string;
  currentRoomId: string;
  identityHash: string;
  relationships: Record<string, Relationship>;
  keyMemories: Belief[];
  needs: Needs;
  mood: Mood;
  coins: number;
  schedule: ScheduleBlock[];
  lastState: string;
  lastTick: number;
  tombstone: boolean;
  crowdId?: string;
  observed: boolean;
  reusedCount: number;
}

export interface Character {
  id: string;
  name: string;
  role: string;
  tier: "T0" | "T1" | "T2" | "T3";
  homeRoomId: string;
  currentRoomId: string;
  attention: number;
  skills: Skills;
  needs: Needs;
  mood: Mood;
  coins: number;
  relationships: Record<string, Relationship>;
  schedule: ScheduleBlock[];
  beliefs: Belief[];
  observations: Observation[];
  /** 被拘禁后不按日程行动，但仍在世界内。 */
  jailed: boolean;
  /** 正在进行的计划，避免同一角色每 tick 重复发起。 */
  busyPlanId?: string;
  lastSocialTick?: number;
  lastWorkTick?: number;
  lastActTick?: number;
  lastLawTick?: number;
  /** 临时偏离日程（例如醉汉去集市听消息）；由场景/规则显式设置。 */
  detour?: { untilTick: number; reason: string };
  deviations: number;
  /** B3：当前细节层级；由 tier 决定，降级时压缩。 */
  detailLevel?: DetailLevel;
  lastTierEvalTick?: number;
  lastTierChangeTick?: number;
  tierReason?: string;
  /** 最近一次降级时的压缩记录；晋升时用于恢复。 */
  record?: CharacterRecord;
  /** 是否被观察者直接看过/说过话。 */
  observed?: boolean;
  /** 从哪个群体个体化而来。 */
  crowdId?: string;
  /** 关键记忆（降级保留、晋升恢复）。 */
  keyMemories?: Belief[];
}

export interface Crowd {
  id: string;
  name: string;
  tier: "T3";
  roomId: string;
  size: number;
  attention: number;
  mood: Mood;
  beliefs: Belief[];
  lastPulseTick?: number;
  cohesion: number;
  representativeIds: string[];
  individualizedCount: number;
  mergedCount: number;
  initialSize: number;
}

export interface PcState {
  id: string;
  name: string;
  currentRoomId: string;
  beliefs: Belief[];
  observations: Observation[];
  status: "active" | "traveling" | "resting";
  route?: TravelState;
}

export interface TravelState {
  actorId: string;
  routeId: string;
  fromRoomId: string;
  toRoomId: string;
  departTick: number;
  arriveTick: number;
  segmentIndex: number;
}

export interface Fact {
  id: string;
  kind:
    | "crime"
    | "fire"
    | "trade"
    | "relationship"
    | "law"
    | "weather"
    | "event"
    | "suspicion"
    | "testimony";
  subjectId: string;
  objectId?: string;
  placeId: string;
  detail: Record<string, string | number | boolean | string[]>;
  status: FactStatus;
  salience: number;
  traceIds: string[];
  summary: string;
  validFromTick: number;
  validToTick?: number;
  sourceEventId: string;
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

export interface SocialClimate extends Mood {
  placeId: string;
  updatedAtTick: number;
  dominantNarrative: string;
}

export interface Provenance {
  source: EventSource;
  planId?: string;
  proposalId?: string;
  model?: string;
  seed?: string;
  ruleVersion: string;
  /** 脚本注入只允许决定“起火/盗窃尝试”，不允许决定结果。 */
  injected?: boolean;
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
  branches: {
    onSuccess: string;
    onFailure: string;
    onPartial?: string;
  };
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
  branches: {
    onSuccess: string;
    onFailure: string;
    onPartial?: string;
  };
  visibility: Visibility;
  createdBy: "rule" | "action-dm" | "world-director" | "canon";
  proposalId?: string;
  parentPlanId?: string;
  state: PlanState;
  payload: Record<string, unknown>;
  createdAtTick: number;
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

export interface WorldMetrics {
  ticks: number;
  npcDecisions: number;
  ruleDecisions: number;
  llmCalls: number;
  directorProposals: number;
  events: number;
  eventsBySource: Record<EventSource, number>;
  eventsByType: Record<string, number>;
  schedule: {
    npcTicks: number;
    adhered: number;
    transit: number;
    excused: number;
    violations: number;
  };
  travelEncounters: number;
  rumors: number;
  maxRumorHops: number;
  plans: {
    created: number;
    resolved: number;
    aborted: number;
  };
  runtimeDecisions: number;
  tierChanges: number;
  promotions: number;
  demotions: number;
  crowdIndividualizations: number;
  crowdMerges: number;
  offstageCharacterCalls: number;
  budgetDegraded: number;
}

export interface BudgetState {
  directorCallsByDay: Record<string, number>;
  characterCallsByDay: Record<string, number>;
  highSalienceByPlaceDay: Record<string, number>;
  characterCallsByLod: Record<string, number>;
  characterCallsByNpc: Record<string, number>;
  characterCallsByTick: Record<string, number>;
  directorCallsByReason: Record<string, number>;
  degradedByReason: Record<string, number>;
}

export interface WorldConfig {
  worldId: string;
  worldSeed: string;
  startTick: number;
  days: number;
  tickMinutes: number;
  ticksPerDay: number;
  /** 脚本注入的“事件尝试”；结果由规则决定。 */
  injections: {
    theftTick: number;
    fireTick: number;
  };
  observer: {
    enabled: boolean;
    departTick: number;
    returnTick: number;
  };
}

export interface WorldState {
  config: WorldConfig;
  rooms: Room[];
  routes: RouteSegment[];
  characters: Character[];
  crowds: Crowd[];
  pc: PcState;
  prices: Record<Commodity, number>;
  basePrices: Record<Commodity, number>;
  stocks: Record<string, Partial<Record<Commodity, number>>>;
  facts: Fact[];
  traces: Trace[];
  plans: EventPlan[];
  /** 群体成员合并后的墓碑记录；再次观察时复用同一身份。 */
  individuals: CharacterRecord[];
  climate: Record<string, SocialClimate>;
  budget: BudgetState;
  eventLog: WorldEvent[];
  tick: number;
  nextEventId: number;
  nextFactId: number;
  nextTraceId: number;
  nextPlanId: number;
  nextProposalId: number;
  nextIndividualId: number;
  metrics: WorldMetrics;
  canon: Record<string, unknown>;
}

export interface DepartureSnapshot {
  placeId: string;
  tick: number;
  visibleIds: string[];
  prices: Record<string, number>;
  climate: SocialClimate;
  pcBeliefs: string[];
}

export interface ReturnChange {
  id: string;
  eventIds: string[];
  summary: string;
}

export interface Echo {
  factId: string;
  belief: Belief;
  verdict: "confirmed" | "distorted" | "refuted";
  observedEventId?: string;
  note: string;
}

export interface ReturnDiff {
  placeId: string;
  departureTick: number;
  returnTick: number;
  stableIds: string[];
  changed: ReturnChange[];
  addedIds: string[];
  removedIds: string[];
  climateDelta: Partial<Mood>;
  echoes: Echo[];
}

export interface QueryAnswer {
  npcId: string;
  question: string;
  answer: string;
  claims: string[];
  confidence: number;
  sourceEventIds: string[];
  /** true 表示该 NPC 没有任何相关信念，答案只能是“不知道”。 */
  unknown: boolean;
}

export interface ValidationGate {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
  blocking: boolean;
}

/** 手写 canon 的输入形状；运行时状态由 WorldBuilder 补齐。 */
export interface CanonCharacter {
  id: string;
  name: string;
  role: string;
  tier: "T0" | "T1" | "T2" | "T3";
  homeRoomId: string;
  startRoomId: string;
  attention: number;
  skills: Skills;
  needs: Needs;
  mood: Mood;
  coins: number;
  relationships: Record<string, Partial<Relationship>>;
  schedule: ScheduleBlock[];
}

export interface CanonCrowd {
  id: string;
  name: string;
  roomId: string;
  size: number;
  attention: number;
  mood: Mood;
}

export interface CanonSpecialPlan {
  id: string;
  type: string;
  placeId: string;
  roomId: string;
  startTick: number;
  endTick: number;
  direction: string;
  stakes: number;
  preconditions: string[];
  branches: {
    onSuccess: string;
    onFailure: string;
    onPartial?: string;
  };
  visibility: Visibility;
  createdBy: "canon";
}

export interface CanonFile {
  id: string;
  name: string;
  summary: string;
  dayStartHour: number;
  tickMinutes: number;
  ticksPerDay: number;
  canon: Record<string, unknown>;
  commodities: Commodity[];
  prices: Record<Commodity, number>;
  rooms: Room[];
  routes: RouteSegment[];
  characters: CanonCharacter[];
  crowds: CanonCrowd[];
  stocks: Record<string, Partial<Record<Commodity, number>>>;
  specialPlans: CanonSpecialPlan[];
}
