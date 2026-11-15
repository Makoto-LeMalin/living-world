/**
 * 终端 trace：把每一步的输入/中间量/LLM 原始输出打出来，同时收集成文本。
 * 默认 full；`off` 时完全静默。
 *
 * 设计原则：
 * - 只读：trace 不改变任何状态；
 * - 不打印 key/headers；
 * - 每一步都有 tag，便于 grep 和对比。
 */

import {
  PART_IDS,
  PART_LABELS,
  capabilities,
  type Body,
} from "./body.ts";
import type { CheckResult, CheckTraceEvent } from "./check.ts";
import type { DmTraceEvent } from "./dm.ts";
import type { NarratorTraceEvent } from "./narrator.ts";

export type TraceLevel = "off" | "summary" | "full";

export function parseTraceLevel(value: string | undefined): TraceLevel {
  if (value === "off" || value === "summary" || value === "full") return value;
  if (value === undefined) return "full";
  throw new Error(`--trace 只能是 off / summary / full，收到 ${value}`);
}

function fixed(value: number | undefined, digits = 1): string {
  return value === undefined ? "-" : value.toFixed(digits);
}

export function formatBody(body: Body): string {
  const parts = PART_IDS.map((id) => {
    const part = body.parts[id];
    const missing = part.exists ? "" : "缺";
    return `${PART_LABELS[id]}${missing}:${part.integrity}/${part.function}/p${part.pain}/b${part.bleeding}`;
  }).join(" ");

  const globals = [
    `疲劳${body.fatigue}`,
    `饿${body.hunger}`,
    `渴${body.thirst}`,
    `烧${body.fever}`,
    `醉${body.intoxication}`,
    `意识${body.consciousness}`,
  ].join(" ");

  return `${parts}\n           ${globals} | 状态: ${body.statuses.join(",") || "无"}`;
}

export function formatCapabilities(body: Body): string {
  const caps = capabilities(body);
  return (Object.entries(caps) as Array<[string, number]>)
    .map(([key, value]) => `${key}=${value.toFixed(1)}`)
    .join("  ");
}

export class Tracer {
  readonly level: TraceLevel;
  private readonly echo: boolean;
  private readonly lines: string[] = [];

  constructor(level: TraceLevel = "full", echo = true) {
    this.level = level;
    this.echo = echo;
  }

  get active(): boolean {
    return this.level !== "off";
  }

  get full(): boolean {
    return this.level === "full";
  }

  private out(line = ""): void {
    if (!this.active) return;
    this.lines.push(line);
    if (this.echo) console.log(line);
  }

  private detail(tag: string, value: unknown): void {
    if (!this.full) return;
    let text = typeof value === "string" ? value : JSON.stringify(value);
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // 不是 JSON 就原样打印
    }
    this.out(`[${tag}]`);
    for (const line of String(text).split(/\r?\n/)) this.out(`  ${line}`);
  }

  step(seq: number, tick: number, id: string, label: string): void {
    if (!this.active) return;
    this.out("");
    this.out(
      `━━━ [${String(seq).padStart(2, "0")}] tick ${tick} · ${id} · ${label} ━━━`,
    );
  }

  event(text: string): void {
    this.out(`[event] ${text}`);
  }

  body(body: Body): void {
    if (!this.full) return;
    this.out(`[body] ${formatBody(body)}`);
    this.out(`[caps] ${formatCapabilities(body)}`);
  }

  dm(event: DmTraceEvent): void {
    switch (event.phase) {
      case "request":
        this.out(
          `[dm.request] base=${fixed(event.input.baseDifficulty)} category=${event.input.category} ` +
            `facts=${event.input.facts.map((fact) => fact.id).join(",") || "无"} ` +
            `allowed=${event.input.allowedConsequences.join(",")}`,
        );
        this.detail("dm.prompt", event.messages[1]?.content ?? "");
        break;
      case "response":
        this.detail("dm.raw", event.content);
        break;
      case "valid": {
        const factors = event.output.factors
          .map(
            (factor) =>
              `${factor.kind}${factor.value >= 0 ? "+" : ""}${factor.value}(${factor.factId})`,
          )
          .join(" ");
        this.out(
          `[dm.valid] D=${fixed(event.output.difficulty)} stakes=${event.output.stakes} ` +
            `hint=${event.output.consequenceHint} factors=${factors || "无"}`,
        );
        break;
      }
      case "fallback":
        this.out(`[dm.fallback] ${event.error}`);
        break;
      case "cache":
        this.out(`[dm.cache] D=${fixed(event.result.difficulty)} source=${event.result.source}`);
        break;
    }
  }

  check(event: CheckTraceEvent): void {
    switch (event.phase) {
      case "blocked":
        this.out(`[check.blocked] ${event.reason}`);
        break;
      case "feasible":
        this.out("[check.hard] 通过");
        break;
      case "capability":
        this.out(
          `[check.capability] C=${fixed(event.capability)} min=${event.minCapability}`,
        );
        break;
      case "difficulty":
        this.out(
          `[check.difficulty] base=${fixed(event.base)} final=${fixed(event.final)}`,
        );
        break;
      case "roll":
        this.out(
          `[check.roll] p=${event.probability.toFixed(3)} u=${event.roll.toFixed(3)} ` +
            `→ ${event.outcome}`,
        );
        break;
      case "no-roll":
        this.out("[check.no-roll] 该动作不需要掷骰");
        break;
    }
  }

  result(result: CheckResult): void {
    this.out(
      `[result] feasible=${result.feasible} C=${fixed(result.capability)} ` +
        `D=${fixed(result.difficulty)} p=${result.probability?.toFixed(3) ?? "-"} ` +
        `u=${result.roll?.toFixed(3) ?? "-"} outcome=${result.outcome ?? "-"}`,
    );
    if (result.facts.length > 0) this.out(`[facts] ${result.facts.join(" / ")}`);
  }

  narrator(event: NarratorTraceEvent): void {
    switch (event.phase) {
      case "request":
        this.out(
          `[narrator.request] facts=${event.input.facts.length} ` +
            `body=${event.input.body.length} allowedClaims=${event.input.allowedClaims.join(",")}`,
        );
        this.detail("narrator.prompt", event.messages[1]?.content ?? "");
        break;
      case "response":
        this.detail("narrator.raw", event.content);
        break;
      case "valid":
        this.out(`[narrator.valid] claims=${event.claims.join(",") || "无"}`);
        this.out(`[narrator.text] ${event.text}`);
        break;
      case "fallback":
        this.out(`[narrator.fallback] ${event.error}`);
        break;
    }
  }

  log(entry: { seq: number; scene: string; beatId: string }): void {
    this.out(`[log] seq=${entry.seq} scene=${entry.scene} beat=${entry.beatId}`);
  }

  done(summary: string): void {
    if (!this.active) return;
    this.out("");
    this.out(`=== done: ${summary} ===`);
  }

  text(): string {
    return this.lines.join("\n");
  }
}
