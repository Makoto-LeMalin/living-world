import test from "node:test";
import assert from "node:assert/strict";

import type { ChatClient, ChatRequest, ChatResponse } from "../../../llm/types.ts";
import type { CheckLogEntry } from "../src/log.ts";
import { replayLog } from "../src/log.ts";
import { runTabletNightLlm } from "../src/scenario-llm.ts";

function isDm(request: ChatRequest): boolean {
  return (request.messages[0]?.content ?? "").includes("裁判");
}

function payload(request: ChatRequest): Record<string, unknown> {
  return JSON.parse(request.messages[1]?.content ?? "{}") as Record<string, unknown>;
}

class RoutingStub implements ChatClient {
  calls = 0;
  private readonly dmValid: boolean;

  constructor(dmValid = true) {
    this.dmValid = dmValid;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.calls++;
    if (isDm(request)) {
      const content = this.dmValid
        ? JSON.stringify({
            difficulty: 60,
            factors: [],
            stakes: "medium",
            consequenceHint: "none",
            rationale: "测试",
          })
        : JSON.stringify({ difficulty: 99, factors: [], stakes: "medium" });
      return { content, model: request.model };
    }

    const allowed = payload(request).allowedClaims as string[] | undefined;
    return {
      content: JSON.stringify({
        text: "门外的脚步声停了一瞬。",
        claims: allowed?.[0] ? [allowed[0]] : [],
      }),
      model: request.model,
    };
  }
}

function checkOf(
  result: Awaited<ReturnType<typeof runTabletNightLlm>>,
  beatId: string,
): CheckLogEntry {
  const entry = result.entries.find((e) => e.kind === "check" && e.beatId === beatId);
  assert.ok(entry && entry.kind === "check", `missing ${beatId}`);
  return entry as CheckLogEntry;
}

test("LLM 场景：2 拍走 DM，可尝试的结果走 Narrator", async () => {
  const stub = new RoutingStub(true);
  const result = await runTabletNightLlm("42", { client: stub });

  assert.equal(result.dmCalls, 2);
  assert.ok(result.narratorCalls >= 6, `narratorCalls=${result.narratorCalls}`);

  assert.equal(checkOf(result, "speak-guard").llm?.dm?.source, "dm");
  assert.equal(checkOf(result, "speak-guard").llm?.narration?.source, "narrator");
  assert.ok(result.transcript.includes("门外的脚步声停了一瞬"));
  assert.ok(result.transcript.includes("DM: dm D=60"));
});

test("LLM 场景日志仍可无 LLM 回放", async () => {
  const result = await runTabletNightLlm("42", { client: new RoutingStub(true) });
  const report = replayLog(result.entries);
  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.equal(report.checks, 9);
});

test("DM 非法输出回退基线，场景不中断", async () => {
  const result = await runTabletNightLlm("42", { client: new RoutingStub(false) });
  const speak = checkOf(result, "speak-guard");

  assert.equal(speak.llm?.dm?.source, "fallback");
  assert.ok(speak.llm?.dm?.error?.includes("DM_INVALID"), speak.llm?.dm?.error);
  assert.equal(speak.input.difficulty, 70); // speak + hostile 的规则基线
  assert.equal(replayLog(result.entries).ok, true);
});

test("关闭 DM 时仍能跑完整场景", async () => {
  const result = await runTabletNightLlm("42", {
    client: new RoutingStub(true),
    dmEnabled: false,
  });

  assert.equal(result.dmCalls, 2);
  assert.equal(checkOf(result, "hide-tablet").llm?.dm?.source, "fallback");
  assert.ok(result.narratorCalls >= 6);
});
