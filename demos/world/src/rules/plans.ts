/**
 * EventPlan 状态机与校验。
 *
 * 关键边界：模型（WorldDirector / ActionDM）只能提出 direction/难度/分支，
 * 不能提出“成功/失败”的结果；结果必须由 EventResolver 掷骰后决定。
 */

import type {
  EventPlan,
  EventProposal,
  EventSource,
  Visibility,
} from "../types.ts";
import type { World } from "../world/world.ts";

export type PlanDraft = Omit<EventPlan, "state" | "createdAtTick"> & {
  state?: EventPlan["state"];
};

export interface PlanValidation {
  ok: boolean;
  errors: string[];
}

const ALLOWED_TRANSITIONS: Record<EventPlan["state"], EventPlan["state"][]> = {
  proposed: ["validated", "aborted"],
  validated: ["scheduled", "aborted"],
  scheduled: ["pending", "aborted"],
  pending: ["resolving", "aborted"],
  resolving: ["resolved", "aborted"],
  resolved: [],
  aborted: [],
};

const RESULT_PATTERNS: RegExp[] = [
  /成功(偷|杀|抓|逃|骗|放火|纵火)/,
  /(已经|结果)(成功|失败)/,
  /偷到了/,
  /杀死了/,
  /抓住了/,
  /完成了/,
  /结果已定/,
];

const CREATED_BY = new Set(["rule", "action-dm", "world-director", "canon"]);
const SOURCES = new Set(["ambient", "actor", "special", "system"]);
const VISIBILITIES = new Set(["private", "room", "place", "public"]);

export function hasResultClaim(text: string): boolean {
  return RESULT_PATTERNS.some((pattern) => pattern.test(text));
}

function knownEntity(world: World, id: string): boolean {
  if (id === world.state.pc.id) return true;
  if (world.maybeCharacter(id)) return true;
  if (world.maybeCrowd(id)) return true;
  if (world.state.rooms.some((room) => room.id === id)) return true;
  if (world.state.facts.some((fact) => fact.id === id)) return true;
  if (world.state.traces.some((trace) => trace.id === id)) return true;
  return false;
}

function validateCommon(
  world: World,
  plan: Pick<
    EventPlan,
    | "id"
    | "source"
    | "type"
    | "placeId"
    | "roomId"
    | "actorIds"
    | "targetIds"
    | "timeWindow"
    | "direction"
    | "stakes"
    | "branches"
    | "visibility"
    | "createdBy"
    | "proposalId"
  >,
): PlanValidation {
  const errors: string[] = [];
  if (!plan.id) errors.push("缺少 id");
  if (!plan.type) errors.push("缺少 type");
  if (!SOURCES.has(plan.source)) errors.push(`未知 source: ${plan.source}`);
  if (!CREATED_BY.has(plan.createdBy)) errors.push(`未知 createdBy: ${plan.createdBy}`);
  if (!VISIBILITIES.has(plan.visibility)) errors.push(`未知 visibility: ${plan.visibility}`);
  if (!plan.direction.trim()) errors.push("缺少 direction");
  if (hasResultClaim(plan.direction)) errors.push("direction 含已定结果，只允许方向");
  if (!(plan.stakes >= 0 && plan.stakes <= 1)) errors.push("stakes 必须在 0..1");
  if (!plan.branches.onSuccess?.trim()) errors.push("缺少 onSuccess 分支");
  if (!plan.branches.onFailure?.trim()) errors.push("缺少 onFailure 分支");

  if (!world.state.rooms.some((room) => room.id === plan.roomId)) {
    errors.push(`未知房间: ${plan.roomId}`);
  } else if (world.placeOfRoom(plan.roomId) !== plan.placeId) {
    errors.push(`placeId 与房间不一致: ${plan.placeId} vs ${world.placeOfRoom(plan.roomId)}`);
  }

  if (plan.timeWindow.startTick < 0) errors.push("时间窗起点为负");
  if (plan.timeWindow.endTick < plan.timeWindow.startTick) errors.push("时间窗终点早于起点");
  const maxTick = world.state.config.days * world.state.config.ticksPerDay + world.state.config.ticksPerDay;
  if (plan.timeWindow.endTick > maxTick) errors.push(`时间窗超出场景: ${plan.timeWindow.endTick} > ${maxTick}`);

  if (plan.source === "actor" && plan.actorIds.length === 0) errors.push("actor 事件必须有 actorIds");
  if (plan.source === "ambient" && plan.actorIds.length > 0) errors.push("ambient 事件不能有主动 actor");
  if (plan.createdBy === "world-director" && !plan.proposalId) errors.push("WorldDirector 计划必须有 proposalId");
  for (const actorId of plan.actorIds) {
    if (!knownEntity(world, actorId)) errors.push(`未知 actorId: ${actorId}`);
  }
  for (const targetId of plan.targetIds) {
    if (!knownEntity(world, targetId)) errors.push(`未知 targetId: ${targetId}`);
  }

  return { ok: errors.length === 0, errors };
}

export function validatePlan(world: World, plan: EventPlan): PlanValidation {
  return validateCommon(world, plan);
}

export function validateProposal(world: World, proposal: EventProposal): PlanValidation {
  return validateCommon(world, {
    id: proposal.id,
    source: "ambient",
    type: proposal.type,
    placeId: proposal.placeId,
    roomId: proposal.roomId,
    actorIds: proposal.actorIds,
    targetIds: proposal.targetIds,
    timeWindow: proposal.timeWindow,
    direction: proposal.direction,
    stakes: proposal.stakes,
    branches: proposal.branches,
    visibility: proposal.visibility,
    createdBy: "world-director",
    proposalId: proposal.id,
  });
}

export function canTransition(from: EventPlan["state"], to: EventPlan["state"]): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transitionPlan(
  world: World,
  planId: string,
  to: EventPlan["state"],
  reason: string,
): EventPlan {
  const plan = world.plan(planId);
  if (!plan) throw new Error(`未知计划: ${planId}`);
  if (!canTransition(plan.state, to)) {
    throw new Error(`非法计划状态: ${plan.id} ${plan.state} -> ${to}`);
  }
  world.setPlanState(planId, to, reason);
  return plan;
}

export function allocatePlanId(world: World): string {
  return `p_${String(world.state.nextPlanId++).padStart(5, "0")}`;
}

export interface CreatePlanOptions {
  source: EventSource;
  type: string;
  placeId: string;
  roomId: string;
  actorIds?: string[];
  targetIds?: string[];
  factionIds?: string[];
  timeWindow: { startTick: number; endTick: number };
  direction: string;
  stakes: number;
  preconditions?: string[];
  branches: { onSuccess: string; onFailure: string; onPartial?: string };
  visibility?: Visibility;
  createdBy: EventPlan["createdBy"];
  proposalId?: string;
  parentPlanId?: string;
  payload?: Record<string, unknown>;
}

/** 创建 → 校验 → 排期；校验失败会进入 aborted，而不是静默丢弃。 */
export function createPlan(world: World, options: CreatePlanOptions): EventPlan {
  const plan: EventPlan = {
    id: allocatePlanId(world),
    source: options.source,
    type: options.type,
    placeId: options.placeId,
    roomId: options.roomId,
    actorIds: options.actorIds ?? [],
    targetIds: options.targetIds ?? [],
    factionIds: options.factionIds ?? [],
    timeWindow: options.timeWindow,
    direction: options.direction,
    stakes: options.stakes,
    preconditions: options.preconditions ?? [],
    branches: options.branches,
    visibility: options.visibility ?? "room",
    createdBy: options.createdBy,
    proposalId: options.proposalId,
    parentPlanId: options.parentPlanId,
    state: "proposed",
    payload: options.payload ?? {},
    createdAtTick: world.state.tick,
  };
  world.createPlan(plan);

  const validation = validatePlan(world, plan);
  if (!validation.ok) {
    transitionPlan(world, plan.id, "aborted", validation.errors.join("; "));
    return world.plan(plan.id) as EventPlan;
  }
  transitionPlan(world, plan.id, "validated", "plan validation passed");
  transitionPlan(world, plan.id, "scheduled", "plan scheduled");
  return world.plan(plan.id) as EventPlan;
}

export function planFromProposal(world: World, proposal: EventProposal): EventPlan {
  return createPlan(world, {
    source: "ambient",
    type: proposal.type,
    placeId: proposal.placeId,
    roomId: proposal.roomId,
    actorIds: proposal.actorIds,
    targetIds: proposal.targetIds,
    timeWindow: proposal.timeWindow,
    direction: proposal.direction,
    stakes: proposal.stakes,
    preconditions: proposal.preconditions,
    branches: proposal.branches,
    visibility: proposal.visibility,
    createdBy: "world-director",
    proposalId: proposal.id,
    payload: { proposalReason: proposal.reason, confidence: proposal.confidence },
  });
}
