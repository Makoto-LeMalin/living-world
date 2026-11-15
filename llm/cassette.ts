/**
 * LLM 响应录制/回放。
 *
 * 键 = sha256(规范化请求)，文件里只有 request + response，没有 headers/key。
 * 回放模式不请求模型；未命中直接报错，不静默走真实调用。
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson } from "../engine/json.ts";
import type { ChatClient, ChatRequest, ChatResponse } from "./types.ts";

export type CassetteMode = "off" | "record" | "replay";

export interface CassetteRecord {
  request: ChatRequest;
  response: ChatResponse;
}

export interface CassetteOptions {
  dir?: string;
  mode?: CassetteMode;
}

export function cassetteKey(request: ChatRequest): string {
  return createHash("sha256").update(canonicalJson(request)).digest("hex").slice(0, 16);
}

export function cassetteModeFromEnv(): CassetteMode {
  const value = process.env.LLM_CASSETTE;
  if (value === "record" || value === "replay") return value;
  return "off";
}

export class CassetteClient implements ChatClient {
  private readonly inner?: ChatClient;
  private readonly dir: string;
  readonly mode: CassetteMode;

  constructor(inner: ChatClient | undefined, options: CassetteOptions = {}) {
    this.inner = inner;
    this.dir = options.dir ?? process.env.LLM_CASSETTE_DIR ?? ".cassette";
    this.mode = options.mode ?? "off";
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (this.mode === "off") {
      if (!this.inner) throw new Error("cassette=off 需要 inner client");
      return this.inner.chat(request);
    }

    const path = join(this.dir, `${cassetteKey(request)}.json`);

    if (this.mode === "replay") {
      const record = JSON.parse(readFileSync(path, "utf8")) as CassetteRecord;
      return record.response;
    }

    if (!this.inner) throw new Error("cassette=record 需要 inner client");
    const response = await this.inner.chat(request);
    mkdirSync(this.dir, { recursive: true });
    const record: CassetteRecord = { request, response };
    writeFileSync(path, JSON.stringify(record, null, 2), "utf8");
    return response;
  }
}
