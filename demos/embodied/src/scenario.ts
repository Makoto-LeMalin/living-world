/**
 * 「泥板之夜」场景脚本（A1）。
 *
 * 没有 LLM：动作序列是写死的，用来验证
 *   身体状态 → 硬约束/能力值 → 难度 → 概率 → 结果 → 日志 → 回放
 * 整条链在固定 seed 下可复现。
 *
 * 第 7 拍之前，双手反绑 + 铁链：手动动作全不可尝试；
 * 绳子被割断之后，同样的 take 变成可尝试。
 */

import type { CheckEnv, Verb } from "./actions.ts";
import type { Body } from "./body.ts";
import { evaluateCheck } from "./check.ts";
import { loadFixture } from "./fixture.ts";
import { bodyHash, type CheckLogEntry, type EventLogEntry, type LogEntry } from "./log.ts";
import type { Tracer } from "./trace.ts";

export interface BeatDm {
  facts: Array<{ id: string; text: string }>;
  opposition?: { name: string; attitude?: string };
  goal?: string;
}

export interface Beat {
  id: string;
  label: string;
  tick: number;
  /** 没有 verb 的是世界事件 */
  verb?: Verb;
  manner?: string;
  env?: CheckEnv;
  difficulty?: number;
  body?: (body: Body) => Body;
  event?: string;
  expectFeasible?: boolean;
  expectReason?: string;
  /** 该拍是否交给 DM 定价；缺省用 beats 里的 difficulty */
  dm?: BeatDm;
}

export const TABLET_NIGHT_BEATS: Beat[] = [
  {
    id: "look-cell",
    label: "借着门缝的光看牢房",
    tick: 1,
    verb: "look",
    env: { light: "dim" },
    difficulty: 30,
    expectFeasible: true,
  },
  {
    id: "listen-guard",
    label: "听门外的动静",
    tick: 1,
    verb: "listen",
    env: { distanceM: 2 },
    expectFeasible: true,
  },
  {
    id: "move-door",
    label: "想挪到门边",
    tick: 2,
    verb: "move",
    env: { distanceM: 2 },
    expectFeasible: false,
    expectReason: "短链",
  },
  {
    id: "take-stylus-bound",
    label: "想用被绑的手拿炭笔",
    tick: 2,
    verb: "take",
    expectFeasible: false,
    expectReason: "反绑",
  },
  {
    id: "channel-1",
    label: "信道出现",
    tick: 3,
    event: "牢房角落的泥板上，浮出一行歪斜的字：「你还记得我吗？」",
  },
  {
    id: "speak-guard",
    label: "隔着门跟老石说话",
    tick: 3,
    verb: "speak",
    env: { attitude: "hostile", distanceM: 2 },
    difficulty: 67,
    expectFeasible: true,
    dm: {
      facts: [
        { id: "f_blood", text: "老石刚看见地上的血" },
        { id: "f_footsteps", text: "走廊另一头有脚步声" },
      ],
      opposition: { name: "老石", attitude: "敌意" },
      goal: "让他开门",
    },
  },
  {
    id: "cut-ropes",
    label: "老石割断麻绳",
    tick: 4,
    event: "老石蹲下来，割断了你手腕上的麻绳；脚踝的短链还在。",
    body: (body) => ({ ...structuredClone(body), statuses: ["tether"] }),
  },
  {
    id: "take-stylus",
    label: "用空出来的手拿炭笔",
    tick: 4,
    verb: "take",
    difficulty: 45,
    expectFeasible: true,
  },
  {
    id: "hide-tablet",
    label: "把泥板塞进草堆",
    tick: 5,
    verb: "hide",
    env: { watched: true },
    difficulty: 65,
    expectFeasible: true,
    dm: {
      facts: [{ id: "f_watched", text: "老石正隔着门缝看着你" }],
      goal: "别让他看见泥板",
    },
  },
  {
    id: "listen-blind-woman",
    label: "听隔壁盲眼妇的低语",
    tick: 5,
    verb: "listen",
    env: { distanceM: 4 },
    difficulty: 75,
    expectFeasible: true,
  },
  {
    id: "tend-wound",
    label: "用袖子压住左臂的伤口",
    tick: 6,
    verb: "tend",
    difficulty: 60,
    expectFeasible: true,
  },
  {
    id: "dawn",
    label: "天快亮了",
    tick: 12,
    event: "走廊尽头的窗纸由黑转灰。远处有人推车经过，木轮吱呀。",
  },
];

export interface ScenarioResult {
  name: string;
  seed: string;
  entries: LogEntry[];
  transcript: string;
}

export interface ScenarioOptions {
  trace?: Tracer;
}

export function runTabletNight(seed = "42", options: ScenarioOptions = {}): ScenarioResult {
  const fixture = loadFixture("akha");
  let body: Body = structuredClone(fixture);
  const entries: LogEntry[] = [];
  const lines: string[] = [`# 泥板之夜 · seed=${seed}`, ""];
  const trace = options.trace;

  let seq = 0;
  let checkId = 0;

  for (const beat of TABLET_NIGHT_BEATS) {
    if (beat.body) body = beat.body(body);
    seq++;
    trace?.step(seq, beat.tick, beat.id, beat.label);

    if (beat.event !== undefined) {
      const entry: EventLogEntry = {
        kind: "event",
        seq,
        scene: "tablet-night",
        beatId: beat.id,
        tick: beat.tick,
        text: beat.event,
      };
      entries.push(entry);
      trace?.event(beat.event);
      lines.push(`**${beat.tick}｜${beat.label}**`);
      lines.push(beat.event);
      lines.push("");
      continue;
    }

    if (!beat.verb) throw new Error(`${beat.id}: 缺少 verb 或 event`);

    checkId++;
    trace?.body(body);
    const input = {
      body: structuredClone(body),
      verb: beat.verb,
      ...(beat.manner === undefined ? {} : { manner: beat.manner }),
      ...(beat.env === undefined ? {} : { env: beat.env }),
      ...(beat.difficulty === undefined ? {} : { difficulty: beat.difficulty }),
      seed,
      checkId,
    };

    const result = evaluateCheck({
      ...input,
      ...(trace === undefined
        ? {}
        : { onTrace: (event) => trace.check(event) }),
    });

    if (beat.expectFeasible !== undefined && result.feasible !== beat.expectFeasible) {
      throw new Error(
        `${beat.id}: 期望 feasible=${beat.expectFeasible}，实际 ${result.feasible}（${result.reason ?? "ok"}）`,
      );
    }
    if (beat.expectReason && !result.reason?.includes(beat.expectReason)) {
      throw new Error(`${beat.id}: 期望理由包含「${beat.expectReason}」，实际「${result.reason}」`);
    }

    const entry: CheckLogEntry = {
      kind: "check",
      seq,
      scene: "tablet-night",
      beatId: beat.id,
      tick: beat.tick,
      bodyHash: bodyHash(body),
      input,
      result,
    };
    entries.push(entry);
    trace?.result(result);
    trace?.log(entry);

    lines.push(`**${beat.tick}｜${beat.label}**`);
    if (!result.feasible) {
      lines.push(`不可尝试：${result.reason ?? "身体做不到"}`);
    } else if (result.outcome) {
      lines.push(
        `C=${result.capability?.toFixed(1)} D=${result.difficulty?.toFixed(1)} ` +
          `p=${result.probability?.toFixed(3)} u=${result.roll?.toFixed(3)} → ${result.outcome}`,
      );
      lines.push(result.facts.join(" "));
    } else {
      lines.push(result.facts.join(" "));
    }
    lines.push("");
  }

  trace?.done(`tablet-night seed=${seed} entries=${entries.length}`);

  return {
    name: "tablet-night",
    seed,
    entries,
    transcript: lines.join("\n"),
  };
}
