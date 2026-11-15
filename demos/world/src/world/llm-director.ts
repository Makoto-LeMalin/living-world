/**
 * LLM WorldDirector。
 *
 * 模型只做“中立世界事件提案”：给 canon/地区摘要/时间/压力，
 * 返回方向、stakes、分支和理由；不返回成功/失败，也不返回 actor 主动事件。
 * 所有输出必须过 EventValidator，失败回退到模板。
 */

import type { ChatClient, ChatMessage } from "../../../../llm/types.ts";
import type { EventProposal } from "../types.ts";
import type { DirectorContext, AsyncWorldDirector } from "./director.ts";
import type { World } from "./world.ts";
import { formatTick } from "../../../../src/kernel/clock.ts";
import { validateProposal } from "../rules/plans.ts";
import { BUDGET_LIMITS } from "../rules/budget.ts";

export interface LlmDirectorTrace {
  phase: "request" | "response" | "valid" | "fallback";
  messages?: ChatMessage[];
  content?: string;
  proposals?: EventProposal[];
  error?: string;
}

export interface LlmDirectorOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  onTrace?: (trace: LlmDirectorTrace) => void;
}

const SYSTEM_PROMPT = `你是文字世界的中立事件导演（WorldDirector）。你只提出“世界上可能发生什么”的方向，不写结果。

硬规则：
- 只能提出 allowedTypes 里的类型；不能提出 actor 主动事件（不能写“某人决定去偷/杀/抓”）。
- 只给 direction、stakes、preconditions、branches、visibility、reason、confidence；
- direction 不能包含“成功了/失败了/他偷到了/她被抓住了”这类已定结果；结果由规则掷骰。
- 只使用输入里出现的 place/room/actor/target ID；不要编造 ID。
- 不读 PC 私有思想、NPC 隐藏记忆、未公开能力值。
- 时间窗必须在 [tick, tick+6]，地点必须在给定 place/room。
- 输出 1–3 个提案，JSON 对象，不要 markdown。

只输出：
{"proposals":[{"type":"fog","placeId":"market","roomId":"market_square","actorIds":[],"targetIds":[],"timeWindow":{"startTick":0,"endTick":6},"direction":"...","stakes":0.3,"preconditions":[],"branches":{"onSuccess":"...","onFailure":"..."},"visibility":"place","reason":"...","confidence":0.6}]}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("输出里没有 JSON 对象");
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

function placeSummary(world: World, placeId: string) {
  const rooms = world.state.rooms.filter((room) => room.placeId === placeId);
  const roomIds = new Set(rooms.map((room) => room.id));
  const stocks: Record<string, Record<string, number>> = {};
  for (const room of rooms) stocks[room.id] = { ...(world.state.stocks[room.id] ?? {}) };
  const activeFacts = world.state.facts
    .filter((fact) => fact.placeId === placeId && fact.status === "active")
    .slice(-8)
    .map((fact) => ({ id: fact.id, kind: fact.kind, salience: fact.salience, summary: fact.summary }));
  const activePlans = world.state.plans
    .filter((plan) => plan.placeId === placeId && ["scheduled", "pending", "resolving"].includes(plan.state))
    .map((plan) => ({ id: plan.id, type: plan.type, state: plan.state, window: plan.timeWindow, direction: plan.direction }));
  const climate = world.state.climate[placeId];
  return {
    id: placeId,
    rooms: rooms.map((room) => ({ id: room.id, name: room.name, kind: room.kind, light: room.light })),
    stocks,
    prices: world.state.prices,
    climate,
    activeFacts,
    activePlans,
    population: world.placeOccupants(placeId).length,
    roomIds: [...roomIds],
  };
}

export function buildDirectorMessages(
  world: World,
  context: DirectorContext,
): ChatMessage[] {
  const allowedTypes = context.allowedTypes ?? [context.type];
  const summary = {
    canon: world.state.canon,
    place: placeSummary(world, context.placeId),
    time: {
      tick: context.tick,
      label: formatTick(
        context.tick,
        world.state.config.ticksPerDay,
        world.state.config.tickMinutes,
        6,
      ),
      lod: context.lod,
      pressure: context.pressure,
    },
    allowedTypes,
    roomId: context.roomId,
    placeId: context.placeId,
    budgetRemaining: BUDGET_LIMITS.directorPerDay,
    privacy: "不要读取观察者的私有想法、NPC 的隐藏记忆或未公开能力值。",
  };
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(summary, null, 2) },
  ];
}

export class LlmWorldDirector implements AsyncWorldDirector {
  private readonly world: World;
  private readonly client: ChatClient;
  private readonly options: LlmDirectorOptions;

  constructor(world: World, client: ChatClient, options: LlmDirectorOptions = {}) {
    this.world = world;
    this.client = client;
    this.options = options;
  }

  async propose(context: DirectorContext): Promise<EventProposal[]> {
    const emit = this.options.onTrace ?? (() => {});
    const messages = buildDirectorMessages(this.world, context);
    emit({ phase: "request", messages });

    const response = await this.client.chat({
      model: this.options.model ?? process.env.DEEPSEEK_MODEL_DIRECTOR ?? "deepseek-flash",
      messages,
      temperature: this.options.temperature ?? 0.7,
      maxTokens: this.options.maxTokens ?? 900,
      responseFormat: "json",
      thinking: false,
    });
    emit({ phase: "response", content: response.content });

    const raw = parseJsonObject(response.content);
    if (!isRecord(raw) || !Array.isArray(raw.proposals)) {
      throw new Error("DIRECTOR_INVALID: 缺少 proposals 数组");
    }
    if (raw.proposals.length === 0 || raw.proposals.length > 3) {
      throw new Error(`DIRECTOR_INVALID: proposals 数量 ${raw.proposals.length} 不在 1..3`);
    }

    const allowed = new Set(context.allowedTypes ?? [context.type]);
    const proposals: EventProposal[] = [];
    for (let index = 0; index < raw.proposals.length; index++) {
      const item = raw.proposals[index];
      if (!isRecord(item)) throw new Error("DIRECTOR_INVALID: proposal 不是对象");
      const type = String(item.type ?? "");
      if (!allowed.has(type)) throw new Error(`DIRECTOR_INVALID: type ${type} 不在 allowedTypes`);
      if (String(item.placeId ?? "") !== context.placeId) {
        throw new Error(`DIRECTOR_INVALID: placeId 必须是 ${context.placeId}`);
      }
      const roomId = String(item.roomId ?? context.roomId);
      const room = this.world.state.rooms.find((candidate) => candidate.id === roomId);
      if (!room || room.placeId !== context.placeId) {
        throw new Error(`DIRECTOR_INVALID: roomId 必须是 ${context.placeId} 内的房间`);
      }
      const actorIds = Array.isArray(item.actorIds) ? item.actorIds : [];
      if (actorIds.length > 0) throw new Error("DIRECTOR_INVALID: 自然事件不能带 actorIds");
      const timeWindow = isRecord(item.timeWindow) ? item.timeWindow : {};
      const startTick = Number(timeWindow.startTick ?? context.tick);
      const endTick = Number(timeWindow.endTick ?? context.tick + 1);
      const proposal: EventProposal = {
        id: `proposal_llm_${context.placeId}_${type}_${context.tick}_${index}`,
        type,
        placeId: context.placeId,
        roomId,
        actorIds: [],
        targetIds: Array.isArray(item.targetIds) ? (item.targetIds as string[]) : [],
        timeWindow: {
          startTick: Number.isFinite(startTick) ? startTick : context.tick,
          endTick: Number.isFinite(endTick) ? endTick : context.tick + 1,
        },
        direction: String(item.direction ?? ""),
        stakes: Number(item.stakes ?? 0.4),
        preconditions: Array.isArray(item.preconditions) ? (item.preconditions as string[]) : [],
        branches: isRecord(item.branches)
          ? {
              onSuccess: String(item.branches.onSuccess ?? ""),
              onFailure: String(item.branches.onFailure ?? ""),
              onPartial:
                typeof item.branches.onPartial === "string" ? item.branches.onPartial : undefined,
            }
          : { onSuccess: "", onFailure: "" },
        visibility: (item.visibility as EventProposal["visibility"]) ?? "place",
        reason: String(item.reason ?? ""),
        confidence: Number(item.confidence ?? 0.5),
      };
      const validation = validateProposal(this.world, proposal);
      if (!validation.ok) throw new Error(`DIRECTOR_INVALID: ${validation.errors.join("; ")}`);
      proposals.push(proposal);
    }
    if (proposals.length === 0) throw new Error("DIRECTOR_INVALID: 没有合法提案");
    emit({ phase: "valid", proposals });
    return proposals;
  }
}
