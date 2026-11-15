/**
 * 「泥板之夜」的 LLM 版：DM 定难度，Narrator 写叙述。
 *
 * 与 scenario.ts 共用 beats；区别：
 * - 带 dm 配置的拍先问 DM（只看环境/事实，不看能力）；
 * - 每个可尝试的结果交给 Narrator，claims 由 ClaimCheck 校验；
 * - 日志仍记录最终 difficulty，所以 replay 不需要 LLM。
 *
 * LLM 输出的可复现靠 cassette（llm/cassette.ts），不靠模型温度。
 */

import type { ChatClient } from "../../../llm/types.ts";
import {
  ACTION_SPECS,
  baseDifficulty,
  type CheckEnv,
  type Verb,
} from "./actions.ts";
import { interoception, type Body } from "./body.ts";
import { evaluateCheck } from "./check.ts";
import {
  DmSession,
  categoryFromBase,
  type DmInput,
  type DmResult,
} from "./dm.ts";
import { loadFixture } from "./fixture.ts";
import {
  bodyHash,
  type CheckLogEntry,
  type EventLogEntry,
  type LlmTraceEntry,
  type LogEntry,
} from "./log.ts";
import { narrate, type NarratorResult } from "./narrator.ts";
import { TABLET_NIGHT_BEATS, type Beat, type ScenarioResult } from "./scenario.ts";
import type { Tracer } from "./trace.ts";

export interface LlmScenarioOptions {
  client: ChatClient;
  dmModel?: string;
  narratorModel?: string;
  dmEnabled?: boolean;
  trace?: Tracer;
}

export interface LlmScenarioResult extends ScenarioResult {
  dmCalls: number;
  narratorCalls: number;
}

const ALLOWED_CONSEQUENCES = ["none", "noise_alert", "time_loss"] as const;

function dmInputFor(beat: Beat, base: number, env: CheckEnv): DmInput {
  const spec = ACTION_SPECS[beat.verb as Verb];
  return {
    intent: {
      verb: spec.verb,
      target: beat.dm?.opposition?.name ?? beat.label,
      manner: beat.manner,
      goal: beat.dm?.goal,
    },
    baseDifficulty: base,
    category: categoryFromBase(base),
    attemptable: true,
    environment: {
      place: "牢房",
      light: env.light ?? "昏暗",
      noise: "远处水滴",
    },
    opposition: beat.dm?.opposition,
    facts: beat.dm?.facts ?? [],
    allowedConsequences: [...ALLOWED_CONSEQUENCES],
  };
}

export async function runTabletNightLlm(
  seed = "42",
  options: LlmScenarioOptions,
): Promise<LlmScenarioResult> {
  const fixture = loadFixture("akha");
  let body: Body = structuredClone(fixture);
  const entries: LogEntry[] = [];
  const lines: string[] = [`# 泥板之夜 · LLM · seed=${seed}`, ""];

  const dmSession = new DmSession(options.client, {
    model: options.dmModel,
    enabled: options.dmEnabled ?? true,
  });
  const tracer = options.trace;

  let seq = 0;
  let checkId = 0;
  let dmCalls = 0;
  let narratorCalls = 0;

  for (const beat of TABLET_NIGHT_BEATS) {
    if (beat.body) body = beat.body(body);
    seq++;
    tracer?.step(seq, beat.tick, beat.id, beat.label);

    if (beat.event !== undefined) {
      const entry: EventLogEntry = {
        kind: "event",
        seq,
        scene: "tablet-night-llm",
        beatId: beat.id,
        tick: beat.tick,
        text: beat.event,
      };
      entries.push(entry);
      tracer?.event(beat.event);
      lines.push(`**${beat.tick}｜${beat.label}**`);
      lines.push(beat.event);
      lines.push("");
      continue;
    }

    if (!beat.verb) throw new Error(`${beat.id}: 缺少 verb 或 event`);
    tracer?.body(body);

    const spec = ACTION_SPECS[beat.verb];
    const env = beat.env ?? {};
    const base = beat.dm
      ? baseDifficulty(spec, env)
      : (beat.difficulty ?? baseDifficulty(spec, env));

    const llmTrace: LlmTraceEntry = {};
    let difficulty = base;
    let dmResult: DmResult | undefined;

    if (beat.dm) {
      dmResult = await dmSession.propose(dmInputFor(beat, base, env), {
        onTrace: tracer === undefined ? undefined : (event) => tracer.dm(event),
      });
      dmCalls++;
      difficulty = dmResult.difficulty;
      llmTrace.dm = {
        difficulty: dmResult.difficulty,
        source: dmResult.source,
        ...(dmResult.error === undefined ? {} : { error: dmResult.error }),
      };
    }

    checkId++;
    const input = {
      body: structuredClone(body),
      verb: beat.verb,
      ...(beat.manner === undefined ? {} : { manner: beat.manner }),
      ...(beat.env === undefined ? {} : { env: beat.env }),
      difficulty,
      seed,
      checkId,
    };

    const result = evaluateCheck({
      ...input,
      onTrace: tracer === undefined ? undefined : (event) => tracer.check(event),
    });

    if (beat.expectFeasible !== undefined && result.feasible !== beat.expectFeasible) {
      throw new Error(
        `${beat.id}: 期望 feasible=${beat.expectFeasible}，实际 ${result.feasible}（${result.reason ?? "ok"}）`,
      );
    }
    if (beat.expectReason && !result.reason?.includes(beat.expectReason)) {
      throw new Error(`${beat.id}: 期望理由包含「${beat.expectReason}」，实际「${result.reason}」`);
    }

    let narration: NarratorResult | undefined;
    if (result.feasible && result.outcome) {
      narration = await narrate(
        options.client,
        {
          verb: beat.verb,
          outcome: result.outcome,
          facts: result.facts,
          body: interoception(body).slice(0, 2),
          allowedClaims: result.claimIds,
        },
        { model: options.narratorModel, onTrace: tracer === undefined ? undefined : (event) => tracer.narrator(event) },
      );
      narratorCalls++;
      llmTrace.narration = {
        text: narration.text,
        claims: narration.claims,
        source: narration.source,
        ...(narration.error === undefined ? {} : { error: narration.error }),
      };
    }

    const entry: CheckLogEntry = {
      kind: "check",
      seq,
      scene: "tablet-night-llm",
      beatId: beat.id,
      tick: beat.tick,
      bodyHash: bodyHash(body),
      input,
      result,
      ...(llmTrace.dm || llmTrace.narration ? { llm: llmTrace } : {}),
    };
    entries.push(entry);
    tracer?.result(result);
    tracer?.log(entry);

    lines.push(`**${beat.tick}｜${beat.label}**`);
    if (dmResult) lines.push(`DM: ${dmResult.source} D=${dmResult.difficulty}`);
    if (!result.feasible) {
      lines.push(`不可尝试：${result.reason ?? "身体做不到"}`);
    } else if (result.outcome) {
      lines.push(
        `C=${result.capability?.toFixed(1)} p=${result.probability?.toFixed(3)} ` +
          `u=${result.roll?.toFixed(3)} → ${result.outcome}`,
      );
      lines.push(narration?.text ?? result.facts.join(" "));
    } else {
      lines.push(result.facts.join(" "));
    }
    lines.push("");
  }

  tracer?.done(
    `tablet-night-llm seed=${seed} entries=${entries.length} dm=${dmCalls} narrator=${narratorCalls}`,
  );

  return {
    name: "tablet-night-llm",
    seed,
    entries,
    transcript: lines.join("\n"),
    dmCalls,
    narratorCalls,
  };
}
