import test from "node:test";
import assert from "node:assert/strict";

import { createDeepSeekClient, LlmError } from "../../../llm/deepseek.ts";

const OK_BODY = JSON.stringify({
  model: "deepseek-flash",
  choices: [{ message: { content: "OK" } }],
  usage: { prompt_tokens: 3, completion_tokens: 1 },
});

test("请求带 Authorization，JSON 模式生效", async () => {
  let captured: { url: string; init?: RequestInit } | undefined;

  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), init };
    return new Response(OK_BODY, { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;

  const client = createDeepSeekClient({
    apiKey: "test-key",
    baseUrl: "https://example.test/",
    fetchImpl: fakeFetch,
  });

  const response = await client.chat({
    model: "deepseek-flash",
    messages: [{ role: "user", content: "只回复 OK" }],
    responseFormat: "json",
    temperature: 0,
    maxTokens: 8,
  });

  assert.equal(response.content, "OK");
  assert.equal(response.usage?.promptTokens, 3);
  assert.ok(captured);
  assert.equal(captured.url, "https://example.test/chat/completions");

  const headers = captured.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer test-key");

  const body = JSON.parse(String(captured.init?.body)) as Record<string, unknown>;
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.model, "deepseek-flash");
});

test("HTTP 错误只保留服务端正文，不带 key", async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ error: { message: "invalid key" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

  const client = createDeepSeekClient({
    apiKey: "test-key",
    baseUrl: "https://example.test",
    fetchImpl: fakeFetch,
  });

  await assert.rejects(
    () => client.chat({ model: "deepseek-flash", messages: [{ role: "user", content: "hi" }] }),
    (error: unknown) => {
      assert.ok(error instanceof LlmError);
      assert.equal(error.status, 401);
      assert.ok(!error.message.includes("test-key"));
      return true;
    },
  );
});

test("缺少 key 时构造报错", () => {
  assert.throws(() => createDeepSeekClient({ apiKey: "" }), /DEEPSEEK_API_KEY/);
});

test("超时被转换为 LlmError", async () => {
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  }) as unknown as typeof fetch;

  const client = createDeepSeekClient({
    apiKey: "test-key",
    baseUrl: "https://example.test",
    fetchImpl: fakeFetch,
    timeoutMs: 5,
  });

  await assert.rejects(
    () => client.chat({ model: "deepseek-flash", messages: [{ role: "user", content: "hi" }] }),
    /超时/,
  );
});
