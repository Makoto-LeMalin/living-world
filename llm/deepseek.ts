/**
 * DeepSeek 适配（OpenAI 兼容）。
 *
 * - key 只从环境变量读取，不落日志、不进 cassette。
 * - 错误信息只保留服务端返回的正文（截断），不打印 headers。
 * - JSON 模式通过 response_format 请求；解析失败由调用方兜底。
 */

import type { ChatClient, ChatRequest, ChatResponse } from "./types.ts";

export class LlmError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

export interface DeepSeekOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** 测试注入用 */
  fetchImpl?: typeof fetch;
}

interface DeepSeekResponse {
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string; reasoning_content?: string };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export function createDeepSeekClient(options: DeepSeekOptions = {}): ChatClient {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
  const baseUrl = (
    options.baseUrl ??
    process.env.DEEPSEEK_BASE_URL ??
    "https://api.deepseek.com"
  ).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 60_000;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!apiKey) {
    throw new LlmError("DEEPSEEK_API_KEY 未设置（应放在 .env，不要写进代码）");
  }

  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const body: Record<string, unknown> = {
          model: request.model,
          messages: request.messages,
          stream: false,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens ?? 800,
        };
        if (request.responseFormat === "json") {
          body.response_format = { type: "json_object" };
        }
        // 显式关闭/开启：默认关闭，避免 reasoning 吃掉 max_tokens。
        body.thinking = { type: request.thinking ? "enabled" : "disabled" };

        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const text = await response.text();
        if (!response.ok) {
          throw new LlmError(
            `DeepSeek HTTP ${response.status}: ${text.slice(0, 300)}`,
            response.status,
          );
        }

        let data: DeepSeekResponse;
        try {
          data = JSON.parse(text) as DeepSeekResponse;
        } catch {
          throw new LlmError(`DeepSeek 返回不是 JSON: ${text.slice(0, 200)}`);
        }

        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== "string" || content.length === 0) {
          const finish = data.choices?.[0]?.finish_reason ?? "?";
          const reasoning = data.choices?.[0]?.message?.reasoning_content?.length ?? 0;
          throw new LlmError(
            `DeepSeek 返回缺少 content（finish_reason=${finish}, reasoning_chars=${reasoning}）` +
              (data.error?.message ? `: ${data.error.message}` : ""),
          );
        }

        return {
          content,
          model: data.model ?? request.model,
          usage: {
            promptTokens: data.usage?.prompt_tokens,
            completionTokens: data.usage?.completion_tokens,
          },
        };
      } catch (error) {
        if (error instanceof LlmError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new LlmError(`DeepSeek 请求超时（${timeoutMs}ms）`);
        }
        throw new LlmError(
          `DeepSeek 请求失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
