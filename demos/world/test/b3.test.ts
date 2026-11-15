import test from "node:test";
import assert from "node:assert/strict";

import type { ChatClient, ChatRequest, ChatResponse } from "../../../llm/types.ts";
import { buildWorld, defaultConfig, loadCanon } from "../src/world/canon.ts";
import { World } from "../src/world/world.ts";
import { Budget } from "../src/rules/budget.ts";
import { LlmWorldDirector, buildDirectorMessages } from "../src/world/llm-director.ts";
import { focusDialogue, buildDialogueInput, FOCUS_NPCS } from "../src/agents/dialogue.ts";
import { runSimulation, runSimulationAsync } from "../src/sim.ts";
import type { EventProposal } from "../src/types.ts";

function stubClient(respond: (request: ChatRequest) => string): ChatClient {
  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const content = respond(request);
      return { content, model: "stub", usage: { promptTokens: 1, completionTokens: 1 } };
    },
  };
}

function directorResponse(request: ChatRequest): string {
  const user = JSON.parse(request.messages[request.messages.length - 1].content) as {
    allowedTypes: string[];
    placeId: string;
    roomId: string;
    time: { tick: number };
  };
  const type = user.allowedTypes[0];
  return JSON.stringify({
    proposals: [
      {
        type,
        placeId: user.placeId,
        roomId: user.roomId,
        actorIds: [],
        targetIds: [],
        timeWindow: { startTick: user.time.tick, endTick: user.time.tick + 1 },
        direction: "码头栈桥在人群踩踏后进一步松动。",
        stakes: 0.4,
        preconditions: [],
        branches: { onSuccess: "栈桥需要修。", onFailure: "只是晃了一下。" },
        visibility: "place",
        reason: "压力与 LOD 摘要",
        confidence: 0.6,
      },
    ],
  });
}

test("LlmWorldDirector 生成合法 proposal，并带上 LLM 来源 id", async () => {
  const world = new World(buildWorld(loadCanon(), defaultConfig("7")));
  const director = new LlmWorldDirector(world, stubClient(directorResponse));
  const proposals = await director.propose({
    tick: 6,
    placeId: "wharf",
    roomId: "wharf",
    type: "structural",
    lod: "fine",
    pressure: 1.2,
    reason: "test",
    allowedTypes: ["structural"],
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].type, "structural");
  assert.equal(proposals[0].placeId, "wharf");
  assert.match(proposals[0].id, /^proposal_llm_/);
  assert.ok(proposals[0].actorIds.length === 0);
});

test("LlmWorldDirector 拒绝已定结果/错误 type", async () => {
  const world = new World(buildWorld(loadCanon(), defaultConfig("7")));
  const bad = stubClient(() =>
    JSON.stringify({
      proposals: [
        {
          type: "theft",
          placeId: "wharf",
          roomId: "wharf",
          actorIds: [],
          targetIds: [],
          timeWindow: { startTick: 6, endTick: 7 },
          direction: "他成功偷了面包。",
          stakes: 0.5,
          preconditions: [],
          branches: { onSuccess: "x", onFailure: "y" },
          visibility: "place",
          reason: "bad",
          confidence: 0.5,
        },
      ],
    }),
  );
  const director = new LlmWorldDirector(world, bad);
  await assert.rejects(
    () =>
      director.propose({
        tick: 6,
        placeId: "wharf",
        roomId: "wharf",
        type: "structural",
        lod: "fine",
        pressure: 1,
        reason: "test",
        allowedTypes: ["structural"],
      }),
    /DIRECTOR_INVALID/,
  );
});

test("director prompt 只包含摘要，不包含 NPC 私有 thought", () => {
  const world = new World(buildWorld(loadCanon(), defaultConfig("7")));
  const messages = buildDirectorMessages(world, {
    tick: 6,
    placeId: "market",
    roomId: "market_square",
    type: "illness",
    lod: "fine",
    pressure: 1,
    reason: "test",
    allowedTypes: ["illness"],
  });
  const text = messages.map((message) => message.content).join("\n");
  assert.ok(text.includes("allowedTypes"));
  assert.ok(!text.includes("thought"));
  assert.ok(!text.includes("DEEPSEEK_API_KEY"));
});

test("focus 对话：LLM claims ⊆ knownFacts，并写 Spoke 事件", async () => {
  const result = runSimulation({ seed: "7" });
  const world = result.world;
  const merchant = world.character("npc_merchant");
  world.state.tick = 432;
  world.moveCharacter(merchant.id, world.state.pc.currentRoomId, "test-focus");
  const client = stubClient((request) => {
    const user = JSON.parse(request.messages[request.messages.length - 1].content) as {
      allowedClaims: string[];
    };
    return JSON.stringify({
      speech: "我只知道该抓的人已经关起来了。",
      claims: user.allowedClaims.slice(0, 1),
      tone: "guarded",
    });
  });
  const budget = new Budget(world);
  const before = world.state.metrics.events;
  const answer = await focusDialogue(world, "npc_merchant", "这里发生过什么？", { client, budget });
  assert.equal(answer.source, "llm");
  assert.ok(answer.claims.every((claim) => merchant.beliefs.some((belief) => belief.factId === claim)));
  assert.ok(world.state.eventLog.some((event) => event.type === "Spoke" && event.id === answer.eventId));
  assert.ok(world.state.metrics.events > before);
  assert.equal(world.state.metrics.llmCalls, 1);
});

test("focus 对话：非法 claims/元词回退模板，不写坏台词", async () => {
  const result = runSimulation({ seed: "7" });
  const world = result.world;
  world.state.tick = 432;
  world.moveCharacter("npc_merchant", world.state.pc.currentRoomId, "test-focus");
  const client = stubClient(() =>
    JSON.stringify({ speech: "玩家应该去问系统。", claims: ["f_fake"], tone: "calm" }),
  );
  const budget = new Budget(world);
  const answer = await focusDialogue(world, "npc_merchant", "这里发生过什么？", { client, budget });
  assert.equal(answer.source, "fallback");
  assert.ok(answer.error?.includes("claim") || answer.error?.includes("元词"));
  assert.ok(!answer.speech.includes("玩家"));
});

test("offstage focus 不调用 LLM", async () => {
  const world = new World(buildWorld(loadCanon(), defaultConfig("7")));
  // PC 默认在神庙，守卫在拘留所/城门，先确保不同 place 或不同 room。
  const guard = world.character("npc_guard");
  const client = stubClient(() => JSON.stringify({ speech: "不该被调用", claims: [], tone: "calm" }));
  const answer = await focusDialogue(world, "npc_guard", "你好", { client });
  assert.equal(answer.calls, 0);
  assert.equal(answer.source, "template");
  assert.ok(answer.error?.includes("OFFSTAGE"));
  assert.ok(guard.beliefs.length === 0);
});

test("focus NPC 列表是 3 个，且 dialogue input 带知识边界", () => {
  assert.equal(FOCUS_NPCS.length, 3);
  const result = runSimulation({ seed: "7" });
  const input = buildDialogueInput(result.world, "npc_guard", "你们抓了谁？");
  assert.ok(input.allowedClaims.length > 0);
  assert.deepEqual(
    input.allowedClaims,
    input.knownFacts.map((fact) => fact.id),
  );
});

test("B3 异步仿真可跑，且 WorldDirector 计划/预算/链路仍成立", async () => {
  const result = await runSimulationAsync({ seed: "7" });
  assert.deepEqual(result.errors, []);
  assert.equal(result.invariants.ok, true, result.invariants.errors.join("\n"));
  assert.ok(result.theft);
  assert.ok(result.fireEventId);
  assert.ok(result.world.state.plans.some((plan) => plan.createdBy === "world-director"));
  assert.ok(result.budget.maxDirectorDay <= 8);
  assert.ok(result.returnDiff);
});

test("预算：角色调用 22/日上限，超限不再调用 LLM", async () => {
  const result = runSimulation({ seed: "7" });
  const world = result.world;
  world.state.tick = 432;
  world.moveCharacter("npc_merchant", world.state.pc.currentRoomId, "test-budget");
  const budget = new Budget(world);
  // 把今日预算直接记满。
  for (let i = 0; i < 30; i++) budget.consumeCharacter();
  const client = stubClient(() => JSON.stringify({ speech: "x", claims: [], tone: "calm" }));
  const answer = await focusDialogue(world, "npc_merchant", "这里发生过什么？", { client, budget });
  assert.equal(answer.calls, 0);
  assert.equal(answer.source, "template");
  assert.ok(world.state.metrics.llmCalls >= 30);
});

test("B3 轨迹：记录 director/dialogue 的 request/response/valid", async () => {
  const world = new World(buildWorld(loadCanon(), defaultConfig("7")));
  const trace: string[] = [];
  const director = new LlmWorldDirector(world, stubClient(directorResponse), {
    onTrace: (event) => trace.push(event.phase),
  });
  await director.propose({
    tick: 6,
    placeId: "wharf",
    roomId: "wharf",
    type: "structural",
    lod: "fine",
    pressure: 1,
    reason: "test",
    allowedTypes: ["structural"],
  });
  assert.deepEqual(trace, ["request", "response", "valid"]);
});

test("异步仿真两次事件日志一致（模板 director）", async () => {
  const a = await runSimulationAsync({ seed: "7" });
  const b = await runSimulationAsync({ seed: "7" });
  assert.equal(JSON.stringify(a.world.state.eventLog), JSON.stringify(b.world.state.eventLog));
});

test("EventProposal 结构不会被 LLM 用来生成 actor 主动事件", async () => {
  const world = new World(buildWorld(loadCanon(), defaultConfig("7")));
  const client = stubClient(() =>
    JSON.stringify({
      proposals: [
        {
          type: "structural",
          placeId: "wharf",
          roomId: "wharf",
          actorIds: ["npc_thief"],
          targetIds: [],
          timeWindow: { startTick: 6, endTick: 7 },
          direction: "小偷决定去仓库。",
          stakes: 0.5,
          preconditions: [],
          branches: { onSuccess: "x", onFailure: "y" },
          visibility: "place",
          reason: "bad",
          confidence: 0.5,
        },
      ],
    }),
  );
  const director = new LlmWorldDirector(world, client);
  await assert.rejects(
    () =>
      director.propose({
        tick: 6,
        placeId: "wharf",
        roomId: "wharf",
        type: "structural",
        lod: "fine",
        pressure: 1,
        reason: "test",
        allowedTypes: ["structural"],
      }),
    /actorIds/,
  );
});
