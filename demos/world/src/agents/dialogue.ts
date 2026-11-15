/**
 * B3 focus 对话：只给 3 个 NPC 生成台词，LLM 只填 speech，不选动作、不改世界。
 *
 * 校验：claims ⊆ knownFacts；不能出现元词/数值；失败回退模板。
 * 预算：角色对话 ≤22/日，且总 ≤30；offstage 角色 0 次。
 */

import type { ChatClient, ChatMessage } from "../../../../llm/types.ts";
import { checkNarration } from "../../../../harness/claim.ts";
import { Budget } from "../rules/budget.ts";
import type { Belief, Character, Fact, LodLevel, Mood, WorldState } from "../types.ts";
import type { World } from "../world/world.ts";

export const FOCUS_NPCS = ["npc_merchant", "npc_guard", "npc_child"] as const;
export type FocusNpc = (typeof FOCUS_NPCS)[number];

export interface DialogueIdentity {
  id: string;
  name: string;
  role: string;
}

export interface DialoguePerception {
  roomId: string;
  placeId: string;
  presentIds: string[];
  light: string;
}

export interface DialogueKnownFact {
  id: string;
  content: string;
  confidence: number;
  hops: number;
  kind: string;
  salience: number;
}

export interface DialogueInput {
  identity: DialogueIdentity;
  perception: DialoguePerception;
  knownFacts: DialogueKnownFact[];
  relationship: { trust: number; affinity: number; fear: number };
  mood: Mood;
  question: string;
  allowedClaims: string[];
}

export type DialogueTone = "calm" | "afraid" | "angry" | "guarded";

export interface DialogueOutput {
  speech: string;
  claims: string[];
  tone: DialogueTone;
}

export interface DialogueResult extends DialogueOutput {
  source: "llm" | "template" | "fallback";
  error?: string;
  eventId?: string;
  calls: number;
  npcId: string;
  lod: LodLevel;
  allowedClaims: string[];
  claimsValid: boolean;
}

function toneFromMood(mood: Mood): DialogueTone {
  if (mood.fear > 0.65) return "afraid";
  if (mood.anger > 0.65) return "angry";
  if (mood.trust < 0.3 || mood.suspicion > 0.65) return "guarded";
  return "calm";
}

export function buildDialogueInput(world: World, npcId: string, question: string): DialogueInput {
  const character = world.character(npcId);
  const beliefs = [...character.beliefs]
    .map((belief) => ({
      belief,
      fact: world.state.facts.find((fact) => fact.id === belief.factId),
    }))
    .filter((entry): entry is { belief: Belief; fact: Fact } => Boolean(entry.fact))
    .sort((a, b) => b.fact.salience * b.belief.confidence - a.fact.salience * a.belief.confidence)
    .slice(0, 8);
  const room = world.room(character.currentRoomId);
  return {
    identity: { id: character.id, name: character.name, role: character.role },
    perception: {
      roomId: room.id,
      placeId: room.placeId,
      presentIds: world.occupants(room.id).filter((id) => id !== character.id),
      light: room.light,
    },
    knownFacts: beliefs.map(({ belief, fact }) => ({
      id: fact.id,
      content: belief.content,
      confidence: belief.confidence,
      hops: belief.hops,
      kind: fact.kind,
      salience: fact.salience,
    })),
    relationship: character.relationships[world.state.pc.id] ?? { trust: 0.3, affinity: 0.1, fear: 0 },
    mood: { ...character.mood },
    question,
    allowedClaims: beliefs.map(({ fact }) => fact.id),
  };
}

export class TemplateDialoguePolicy {
  reply(input: DialogueInput): DialogueOutput {
    if (input.knownFacts.length === 0) {
      return { speech: "我不知道。", claims: [], tone: "guarded" };
    }
    const top = input.knownFacts.slice(0, 2);
    const lead = top[0].hops > 0 ? "我听说" : "我知道";
    const speech = `${lead}：${top.map((fact) => fact.content).join(" ")}`;
    return {
      speech,
      claims: top.map((fact) => fact.id),
      tone: toneFromMood(input.mood),
    };
  }
}

const SYSTEM_PROMPT = `你在一个文字世界里扮演一个 NPC，回答观察者的问题。你只能说这个 NPC 已经知道的事。

规则：
- 只输出 JSON：{"speech":"...","claims":["fact_id"],"tone":"calm|afraid|angry|guarded"}。
- speech 是 1–3 句世界内的话；不要解释规则，不要提用户/玩家/系统/AI/提示词/系统消息。
- claims 只能从 allowedClaims 里选；不能编造 fact_id。
- 不知道就直说“我不知道”，不要补全。
- 不要出现能力值、评分、数字/100。
- 语气由 mood 决定，但不能因此编造事实。`;

export function buildDialogueMessages(input: DialogueInput): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify(
        {
          identity: input.identity,
          perception: input.perception,
          knownFacts: input.knownFacts,
          relationship: input.relationship,
          mood: input.mood,
          question: input.question,
          allowedClaims: input.allowedClaims,
        },
        null,
        2,
      ),
    },
  ];
}

function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("输出里没有 JSON 对象");
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

export interface LlmDialogueOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  onTrace?: (trace: { phase: string; content?: string; error?: string }) => void;
}

export async function llmDialogue(
  client: ChatClient,
  input: DialogueInput,
  options: LlmDialogueOptions = {},
): Promise<{ output: DialogueOutput; error?: string }> {
  const emit = options.onTrace ?? (() => {});
  try {
    const messages = buildDialogueMessages(input);
    emit({ phase: "request" });
    const response = await client.chat({
      model: options.model ?? process.env.DEEPSEEK_MODEL_DIALOGUE ?? "deepseek-flash",
      messages,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 320,
      responseFormat: "json",
      thinking: false,
    });
    emit({ phase: "response", content: response.content });
    const raw = parseJsonObject(response.content);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("不是对象");
    const record = raw as Record<string, unknown>;
    const speech = record.speech;
    const claims = record.claims;
    const tone = record.tone;
    if (typeof speech !== "string" || !Array.isArray(claims)) throw new Error("缺少 speech/claims");
    if (!claims.every((claim): claim is string => typeof claim === "string")) throw new Error("claims 非字符串");
    if (!["calm", "afraid", "angry", "guarded"].includes(String(tone))) throw new Error("非法 tone");
    const output: DialogueOutput = { speech, claims, tone: tone as DialogueTone };
    const check = checkNarration({ text: output.speech, claims: output.claims }, input.allowedClaims);
    if (!check.ok) throw new Error(check.errors.join("; "));
    emit({ phase: "valid" });
    return { output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ phase: "fallback", error: message });
    return { output: new TemplateDialoguePolicy().reply(input), error: message.slice(0, 240) };
  }
}

export interface FocusDialogueOptions {
  client?: ChatClient;
  budget?: Budget;
  model?: string;
  onTrace?: LlmDialogueOptions["onTrace"];
  /** B3 完整运行时允许任意同房间 NPC 进入 focus；默认仍只允许 3 个固定 NPC。 */
  allowAnyNpc?: boolean;
  lod?: LodLevel;
  reason?: string;
}

export function dialogueLod(world: World, npc: Character): LodLevel {
  const pcRoom = world.state.pc.currentRoomId;
  if (npc.currentRoomId === pcRoom) return "focus";
  if (world.placeOfRoom(npc.currentRoomId) === world.placeOfRoom(pcRoom)) return "near";
  return "offstage";
}

export async function focusDialogue(
  world: World,
  npcId: string,
  question: string,
  options: FocusDialogueOptions = {},
): Promise<DialogueResult> {
  if (!options.allowAnyNpc && !FOCUS_NPCS.includes(npcId as FocusNpc)) {
    throw new Error(`不是 focus NPC: ${npcId}`);
  }
  const pc = world.state.pc;
  const npc = world.character(npcId);
  const lod = options.lod ?? dialogueLod(world, npc);
  if (lod === "offstage" || npc.currentRoomId !== pc.currentRoomId) {
    const offstageInput = buildDialogueInput(world, npcId, question);
    return {
      ...new TemplateDialoguePolicy().reply(offstageInput),
      source: "template",
      error: "OFFSTAGE_FOCUS: 角色不在观察者所在房间",
      calls: 0,
      npcId,
      lod: "offstage",
      allowedClaims: offstageInput.allowedClaims,
      claimsValid: true,
    };
  }

  npc.observed = true;
  const input = buildDialogueInput(world, npcId, question);
  const budget = options.budget ?? new Budget(world);
  let result: DialogueResult;
  if (options.client && budget.canUseCharacter(world.state.tick, lod)) {
    budget.consumeCharacter(world.state.tick, {
      lod,
      npcId,
      reason: options.reason ?? "focus-dialogue",
    });
    const llm = await llmDialogue(options.client, input, {
      model: options.model,
      onTrace: options.onTrace,
    });
    result = {
      ...llm.output,
      source: llm.error ? "fallback" : "llm",
      error: llm.error,
      calls: 1,
      npcId,
      lod,
      allowedClaims: input.allowedClaims,
      claimsValid: llm.output.claims.every((claim) => input.allowedClaims.includes(claim)),
    };
  } else {
    if (options.client) {
      budget.degrade(
        "character-budget",
        { kind: "character", lod, npcId },
        world.state.tick,
      );
    }
    result = {
      ...new TemplateDialoguePolicy().reply(input),
      source: "template",
      calls: 0,
      npcId,
      lod,
      allowedClaims: input.allowedClaims,
      claimsValid: true,
    };
  }

  const event = world.emit({
    type: "Spoke",
    actorId: npcId,
    roomId: npc.currentRoomId,
    visibility: "private",
    witnesses: [pc.id],
    payload: {
      speakerId: npcId,
      listenerId: pc.id,
      question,
      speech: result.speech,
      claims: result.claims,
      tone: result.tone,
      source: result.source,
      lod: result.lod,
      error: result.error,
    },
    provenance: {
      source: "actor",
      ruleVersion: "world-b3.0",
      model: result.source === "llm" ? (options.model ?? "deepseek-flash") : undefined,
      seed: world.seed,
    },
  });
  return { ...result, eventId: event.id };
}

/** 完整 B3 的通用入口：任何同房间 NPC 都可被观察者问到。 */
export async function characterDialogue(
  world: World,
  npcId: string,
  question: string,
  options: Omit<FocusDialogueOptions, "allowAnyNpc"> = {},
): Promise<DialogueResult> {
  return focusDialogue(world, npcId, question, { ...options, allowAnyNpc: true });
}

export function focusView(world: World, npcId: string): { id: string; name: string; roomId: string; knownFacts: DialogueKnownFact[] } {
  const character = world.character(npcId);
  return {
    id: character.id,
    name: character.name,
    roomId: character.currentRoomId,
    knownFacts: buildDialogueInput(world, npcId, "").knownFacts,
  };
}

export function isFocusNpc(id: string): id is FocusNpc {
  return (FOCUS_NPCS as readonly string[]).includes(id);
}

export function moodTone(mood: Mood): DialogueTone {
  return toneFromMood(mood);
}

export type { Character, Fact, WorldState };
