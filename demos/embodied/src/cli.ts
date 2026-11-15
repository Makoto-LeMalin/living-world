/**
 * 具身 demo 的调试 CLI。
 *
 *   node demos/embodied/src/cli.ts body inspect
 *   node demos/embodied/src/cli.ts body inspect --json
 *   node demos/embodied/src/cli.ts check --verb take --dc 45
 *   node demos/embodied/src/cli.ts check --verb speak --dc 67 --seed 7
 */

import { existsSync, writeFileSync } from "node:fs";

import {
  VERBS,
  VERB_LABELS,
  ACTION_SPECS,
  baseDifficulty,
  type Attitude,
  type CheckEnv,
  type Light,
  type Verb,
} from "./actions.ts";
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  PART_IDS,
  PART_LABELS,
  capabilities,
  interoception,
} from "./body.ts";
import { evaluateCheck, type Outcome } from "./check.ts";
import { loadFixture, type Fixture } from "./fixture.ts";
import { readLog, replayLog, writeLog } from "./log.ts";
import { runTabletNight } from "./scenario.ts";
import { runTabletNightLlm } from "./scenario-llm.ts";
import { Tracer, parseTraceLevel } from "./trace.ts";
import { runParity, writeParityReport } from "./parity.ts";
import { runCompilerValidation, writeCompilerReport } from "./compiler-run.ts";
import { runV3Validation, writeV3Report } from "./v3/run.ts";
import {
  CONSEQUENCE_HINTS,
  DmSession,
  categoryFromBase,
  type ConsequenceHint,
  type DmInput,
  type DmResult,
} from "./dm.ts";
import { narrate } from "./narrator.ts";
import { createDeepSeekClient } from "../../../llm/deepseek.ts";
import {
  CassetteClient,
  cassetteModeFromEnv,
  type CassetteMode,
} from "../../../llm/cassette.ts";

// 本地运行时自动加载 .env；key 只进 process.env，不打印。
if (existsSync(".env")) process.loadEnvFile(".env");

interface Args {
  positionals: string[];
  flags: Record<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, flags };
}

function str(args: Args, key: string, fallback?: string): string | undefined {
  const value = args.flags[key];
  return typeof value === "string" ? value : fallback;
}

function num(args: Args, key: string): number | undefined {
  const value = str(args, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${key} 需要数字，收到 ${value}`);
  return parsed;
}

function has(args: Args, key: string): boolean {
  return args.flags[key] === true || args.flags[key] === "true";
}

function showBody(body: Fixture, asJson: boolean): void {
  const caps = capabilities(body);
  const senses = interoception(body);

  if (asJson) {
    console.log(JSON.stringify({ body, capabilities: caps, interoception: senses }, null, 2));
    return;
  }

  console.log(`\n${body.name ?? body.id ?? "无名"} · 身体\n`);

  console.table(
    PART_IDS.map((id) => {
      const part = body.parts[id];
      return {
        部位: PART_LABELS[id],
        存在: part.exists ? "是" : "否",
        完整: part.integrity,
        功能: part.function,
        疼痛: part.pain,
        出血: part.bleeding,
        可见: part.visibleStates.join("/"),
      };
    }),
  );

  console.log("\n能力值（0–100）\n");
  console.table(
    CAPABILITIES.map((cap) => ({
      能力: CAPABILITY_LABELS[cap],
      值: Number(caps[cap].toFixed(1)),
    })),
  );

  console.log("\n状态：" + (body.statuses.join("、") || "无"));
  console.log("\n内感受：");
  for (const line of senses) console.log(`  - ${line}`);
  console.log("");
}

function envFromArgs(args: Args): CheckEnv {
  const env: CheckEnv = {};
  const light = str(args, "light");
  if (light) {
    if (!["bright", "dim", "dark"].includes(light)) throw new Error(`未知光照: ${light}`);
    env.light = light as Light;
  }
  const attitude = str(args, "attitude");
  if (attitude) {
    if (!["friendly", "neutral", "hostile"].includes(attitude)) {
      throw new Error(`未知态度: ${attitude}`);
    }
    env.attitude = attitude as Attitude;
  }
  const distance = num(args, "distance");
  if (distance !== undefined) env.distanceM = distance;
  if (has(args, "watched")) env.watched = true;
  if (has(args, "cover")) env.cover = true;
  if (has(args, "soundproof")) env.soundproof = true;
  return env;
}

function showCheck(args: Args, fixture: Fixture): void {
  const verb = str(args, "verb");
  if (!verb || !VERBS.includes(verb as Verb)) {
    throw new Error(`--verb 必填，可选：${VERBS.join(", ")}`);
  }

  const result = evaluateCheck({
    body: fixture,
    verb: verb as Verb,
    manner: str(args, "manner"),
    env: envFromArgs(args),
    difficulty: num(args, "dc"),
    seed: str(args, "seed", process.env.LW_SEED ?? "42"),
    checkId: num(args, "check-id") ?? 1,
  });

  if (has(args, "json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\n${VERB_LABELS[result.verb]}（${result.verb}）`);
  if (!result.feasible) {
    console.log(`  不可尝试：${result.reason ?? "身体做不到"}`);
    if (result.capability !== undefined) {
      console.log(`  能力值：${result.capability.toFixed(1)}`);
    }
    console.log("");
    return;
  }

  if (result.outcome === undefined) {
    console.log(`  ${result.facts.join(" ")}`);
    console.log("");
    return;
  }

  console.log(`  能力 C = ${result.capability?.toFixed(1)}`);
  console.log(`  难度 D = ${result.difficulty?.toFixed(1)}（基础 ${result.baseDifficulty?.toFixed(1)}）`);
  console.log(`  成功率 p = ${result.probability?.toFixed(3)}`);
  console.log(`  掷骰 u = ${result.roll?.toFixed(3)}`);
  console.log(`  结果：${result.outcome}`);
  console.log(`  ${result.facts.join(" ")}`);
  console.log("");
}

function makeTracer(args: Args): Tracer {
  // --json 时只输出 JSON，避免 trace 混进机器可读结果
  if (has(args, "json")) return new Tracer("off");
  return new Tracer(parseTraceLevel(str(args, "trace")));
}

function tracePathFor(logPath: string): string {
  return logPath.replace(/\.jsonl$/i, "") + ".log";
}

function showScenario(args: Args): void {
  const seed = str(args, "seed", process.env.LW_SEED ?? "42") as string;
  const tracer = makeTracer(args);
  const result = runTabletNight(seed, { trace: tracer });
  const safeSeed = seed.replace(/[^a-zA-Z0-9._-]/g, "_");
  const out = str(args, "out", `reports/tablet-night-${safeSeed}.jsonl`) as string;

  writeLog(out, result.entries);
  writeFileSync(tracePathFor(out), `${tracer.active ? tracer.text() : result.transcript}\n`, "utf8");

  if (has(args, "json")) {
    console.log(JSON.stringify({ ...result, logPath: out }, null, 2));
    return;
  }

  if (!tracer.active) console.log(result.transcript);
  console.log(`日志：${out}（${result.entries.length} 条）`);
  if (tracer.active) console.log(`后台 trace：${tracePathFor(out)}`);
}

async function showScenarioLlm(args: Args): Promise<void> {
  const seed = str(args, "seed", process.env.LW_SEED ?? "42") as string;
  const tracer = makeTracer(args);
  const safeSeed = seed.replace(/[^a-zA-Z0-9._-]/g, "_");
  const out = str(args, "out", `reports/tablet-night-llm-${safeSeed}.jsonl`) as string;

  const mode: CassetteMode = has(args, "record")
    ? "record"
    : has(args, "replay")
      ? "replay"
      : cassetteModeFromEnv();
  const dir = process.env.LLM_CASSETTE_DIR ?? ".cassette/embodied";
  const client = new CassetteClient(
    mode === "replay" ? undefined : createDeepSeekClient(),
    { mode, dir },
  );

  const result = await runTabletNightLlm(seed, {
    client,
    trace: tracer,
    dmEnabled: !has(args, "no-dm"),
  });
  writeLog(out, result.entries);
  writeFileSync(tracePathFor(out), `${tracer.active ? tracer.text() : result.transcript}\n`, "utf8");

  if (has(args, "json")) {
    console.log(JSON.stringify({ ...result, logPath: out, cassette: { mode, dir } }, null, 2));
    return;
  }

  if (!tracer.active) console.log(result.transcript);
  console.log(
    `日志：${out}（${result.entries.length} 条；DM ${result.dmCalls} 次，Narrator ${result.narratorCalls} 次；cassette=${mode}）`,
  );
  if (tracer.active) console.log(`后台 trace：${tracePathFor(out)}`);
}

function showReplay(args: Args): void {
  const logPath = str(args, "log");
  if (!logPath) throw new Error("--log 必填");

  const report = replayLog(readLog(logPath));
  if (has(args, "json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log(`回放通过：${report.checks} 条 check，逐字段一致。`);
  } else {
    console.log(`回放失败：${report.errors.length} 处不一致`);
    for (const error of report.errors) console.log(`  - ${error}`);
  }

  if (!report.ok) process.exitCode = 1;
}

async function showTurn(args: Args): Promise<void> {
  const fixture = loadFixture(str(args, "fixture", "akha") as string);
  const verb = (str(args, "verb", "speak") as Verb) ?? "speak";
  if (!VERBS.includes(verb)) throw new Error(`未知动词: ${verb}`);

  const spec = ACTION_SPECS[verb];
  const env = envFromArgs(args);
  const base = num(args, "base-dc") ?? baseDifficulty(spec, env);
  const factText = str(args, "fact", "对方刚看见地上的血，警惕很高") as string;

  const client = createDeepSeekClient();
  const useDm = spec.checkWorthy === "social" || has(args, "dm");

  let difficulty = base;
  let dmNote = "规则基表";

  if (useDm) {
    const dmInput: DmInput = {
      intent: {
        verb,
        target: str(args, "target", "老石"),
        manner: str(args, "manner"),
        goal: str(args, "goal", "让他开门"),
      },
      baseDifficulty: base,
      category: categoryFromBase(base),
      attemptable: true,
      environment: {
        place: str(args, "place", "牢房门口"),
        light: str(args, "light", "昏暗"),
      },
      opposition: {
        name: str(args, "opposition", "老石") as string,
        attitude: str(args, "attitude", "敌意"),
      },
      facts: [{ id: "f_1", text: factText }],
      allowedConsequences: ["none", "noise_alert", "time_loss"],
    };
    const dm = await new DmSession(client).propose(dmInput);
    difficulty = dm.difficulty;
    dmNote = `${dm.source}${dm.error ? ` (${dm.error})` : ""}`;
  }

  const result = evaluateCheck({
    body: fixture,
    verb,
    manner: str(args, "manner"),
    env,
    difficulty,
    seed: str(args, "seed", process.env.LW_SEED ?? "42"),
    checkId: num(args, "check-id") ?? 1,
  });

  console.log(`\n${VERB_LABELS[verb]}（${verb}）  DM: ${dmNote}  D=${difficulty}`);
  if (!result.feasible) {
    console.log(`  不可尝试：${result.reason ?? "身体做不到"}`);
    console.log("");
    return;
  }

  console.log(
    `  C=${result.capability?.toFixed(1)} p=${result.probability?.toFixed(3)} ` +
      `u=${result.roll?.toFixed(3)} → ${result.outcome}`,
  );

  if (!result.outcome) {
    console.log(`  ${result.facts.join(" ")}`);
    console.log("");
    return;
  }

  const narration = await narrate(client, {
    verb,
    outcome: result.outcome,
    facts: result.facts,
    body: interoception(fixture).slice(0, 2),
    allowedClaims: result.claimIds,
  });

  console.log(`  叙述（${narration.source}）：${narration.text}`);
  if (narration.error) console.log(`  narrator error: ${narration.error}`);
  console.log(`  claims: ${narration.claims.join(", ") || "（无）"}`);
  console.log("");
}

async function pingLlm(): Promise<void> {
  const client = createDeepSeekClient();
  const model = process.env.DEEPSEEK_MODEL_MIND ?? "deepseek-flash";
  const response = await client.chat({
    model,
    messages: [{ role: "user", content: "只回复两个字：收到" }],
    temperature: 0,
    maxTokens: 64,
  });

  console.log(`ok: model=${response.model} content=${JSON.stringify(response.content.trim())}`);
  if (response.usage) {
    console.log(
      `tokens: prompt=${response.usage.promptTokens ?? "?"} completion=${response.usage.completionTokens ?? "?"}`,
    );
  }
}

function showParity(args: Args): void {
  const seed = str(args, "seed", "parity") as string;
  const report = runParity(seed);
  const out = str(args, "out", `reports/parity-${seed}.md`) as string;
  writeParityReport(report, out);

  if (has(args, "json")) {
    const { markdown: _markdown, ...rest } = report;
    console.log(JSON.stringify({ ...rest, reportPath: out }, null, 2));
    return;
  }

  console.log(`\nv0 vs v2 parity · seed=${seed}`);
  console.log(
    `用例 ${report.overall.total} | 可行性一致 ${(report.overall.feasibleAgreement * 100).toFixed(1)}% | ` +
      `双方可尝试 ${report.overall.bothFeasible} | 结果一致 ${(report.overall.outcomeAgreement * 100).toFixed(1)}% | ` +
      `C 平均差 ${report.overall.meanCDiff.toFixed(2)}（最大 ${report.overall.maxCDiff.toFixed(2)}）`,
  );
  console.log(
    `基线（阿岬/松绑/健康）：可行性 ${(report.baseline.feasibleAgreement * 100).toFixed(1)}% | ` +
      `C 平均差 ${report.baseline.meanCDiff.toFixed(2)} | 结果一致 ${(report.baseline.outcomeAgreement * 100).toFixed(1)}%`,
  );
  console.table(
    report.byVariant.map((variant) => ({
      身体: variant.label,
      可行性一致: `${(variant.feasibleAgreement * 100).toFixed(1)}%`,
      双方可尝试: variant.bothFeasible,
      结果一致: `${(variant.outcomeAgreement * 100).toFixed(1)}%`,
      C平均差: Number(variant.meanCDiff.toFixed(2)),
      C最大差: Number(variant.maxCDiff.toFixed(2)),
    })),
  );

  if (report.failures.length > 0) {
    console.log(`失败项 ${report.failures.length}:`);
    for (const failure of report.failures) console.log(`  - ${failure}`);
  } else {
    console.log("失败项：无");
  }
  if (report.expectedDivergences.length > 0) {
    console.log(`预期差异 ${report.expectedDivergences.length}:`);
    for (const item of report.expectedDivergences) console.log(`  - ${item}`);
  }
  console.log(`\n报告：${out}`);
  console.log(`明细：${out.replace(/\.md$/i, ".json")}`);
}

function help(): void {
  console.log(`
具身 demo CLI

  body inspect [--fixture akha] [--json]
      打印部位、能力值、内感受

  check --verb <${VERBS.join("|")}> [选项]
      --dc <0-100>        直接指定最终难度
      --manner <手法>     如 crawl / mouth
      --light bright|dim|dark
      --distance <米>
      --attitude friendly|neutral|hostile
      --watched / --cover / --soundproof
      --seed <种子>       默认 $LW_SEED 或 42
      --check-id <n>      默认 1
      --json

  scenario run [--seed 42] [--out reports/tablet-night-42.jsonl] [--trace off|summary|full]
      跑「泥板之夜」，写 check 日志与后台 trace（默认 full）

  scenario llm [--seed 42] [--record|--replay] [--no-dm]
               [--out reports/tablet-night-llm-42.jsonl] [--trace off|summary|full]
      跑 LLM 版：2 拍问 DM，可尝试的结果交给 Narrator；cassette 可录可放

  replay --log <path> [--json]
      重算日志里的每条 check 并逐字段比对

  parity [--seed parity] [--out reports/parity-parity.md] [--json]
      v0（加权平均+硬规则）vs v2（约束+瓶颈分）的 7 身体 × 12 动作对照

  compiler [--arm blind|aware|both] [--record|--replay]
           [--out reports/compiler-v3.md] [--json]
      V3 编译阶段：100 条自由动作 × 编译器两臂；blind 为正式模式，aware 为消融

  v3 [--record|--replay] [--out reports/v3-validation.md] [--json]
      完整 V3：编译 + 语义校验 + 世界矩阵 + 端到端掷骰 + 覆盖/稳定性
      同时写 reports/compiler-v3.md、reports/v3-review.md/csv

  llm ping
      用 .env 里的 DEEPSEEK_API_KEY 做一次最小调用（不打印 key）

  llm turn [--verb speak] [--base-dc 55] [--fact "..."] [--dm]
      一次完整回合：DM 定难度 → 判定 → Narrator 叙述（社交动作默认走 DM）

  dm [--verb speak] [--base-dc 55] [--fact "..."] [--fact-id f_1]
     [--attitude hostile] [--goal "..."] [--consequence noise_alert] [--json]
      真实调用一次 DM，打印校验后的难度与因素

  narrate [--verb take] [--outcome clean_success] [--fact "..."]
          [--claim take:clean_success] [--body "..."] [--json]
      真实调用一次 Narrator，打印 claims 与检查结果

示例：
  node demos/embodied/src/cli.ts body inspect
  node demos/embodied/src/cli.ts check --verb take --dc 45
  node demos/embodied/src/cli.ts check --verb speak --dc 67 --seed 7
  node demos/embodied/src/cli.ts scenario run --seed 42
  node demos/embodied/src/cli.ts scenario llm --seed 42 --record
  node demos/embodied/src/cli.ts scenario llm --seed 42 --replay --trace off
  node demos/embodied/src/cli.ts replay --log reports/tablet-night-42.jsonl
  node demos/embodied/src/cli.ts parity --seed parity
  node demos/embodied/src/cli.ts compiler --record
  node demos/embodied/src/cli.ts llm ping
  node demos/embodied/src/cli.ts dm --verb speak --fact "老石刚看见血"
`);
}

async function showDm(args: Args): Promise<void> {
  const verb = (str(args, "verb", "speak") as Verb) ?? "speak";
  if (!VERBS.includes(verb)) throw new Error(`未知动词: ${verb}`);

  const base = num(args, "base-dc") ?? 55;
  const factText = str(args, "fact", "走廊尽头有脚步声") as string;
  const factId = str(args, "fact-id", "f_1") as string;

  const requested = str(args, "consequence");
  const allowed: ConsequenceHint[] = requested
    ? [requested as ConsequenceHint]
    : ["none", "noise_alert", "time_loss"];
  for (const hint of allowed) {
    if (!CONSEQUENCE_HINTS.includes(hint)) throw new Error(`未知 consequence: ${hint}`);
  }

  const input: DmInput = {
    intent: {
      verb,
      target: str(args, "target"),
      manner: str(args, "manner"),
      goal: str(args, "goal"),
    },
    baseDifficulty: base,
    category: categoryFromBase(base),
    attemptable: true,
    environment: {
      place: str(args, "place"),
      light: str(args, "light", "昏暗"),
      noise: str(args, "noise"),
    },
    opposition: str(args, "opposition")
      ? {
          name: str(args, "opposition") as string,
          attitude: str(args, "attitude", "敌意"),
        }
      : undefined,
    facts: [{ id: factId, text: factText }],
    allowedConsequences: allowed,
  };

  const session = new DmSession(createDeepSeekClient());
  const result: DmResult = await session.propose(input);

  if (has(args, "json")) {
    console.log(JSON.stringify({ input, result }, null, 2));
    return;
  }

  console.log(`DM: ${result.source}  difficulty=${result.difficulty}  (base ${base})`);
  if (result.error) console.log(`  error: ${result.error}`);
  for (const factor of result.output?.factors ?? []) {
    console.log(`  ${factor.kind} ${factor.value >= 0 ? "+" : ""}${factor.value} ${factor.factId}: ${factor.reason}`);
  }
  if (result.output) console.log(`  stakes=${result.output.stakes} hint=${result.output.consequenceHint}`);
}

async function showNarrate(args: Args): Promise<void> {
  const verb = (str(args, "verb", "take") as Verb) ?? "take";
  if (!VERBS.includes(verb)) throw new Error(`未知动词: ${verb}`);

  const outcome = (str(args, "outcome", "clean_success") as Outcome) ?? "clean_success";
  const fact = str(args, "fact", "东西到了你手里。") as string;
  const allowedClaim = str(args, "claim", `${verb}:${outcome}`) as string;
  const bodyLine = str(args, "body");

  const result = await narrate(createDeepSeekClient(), {
    verb,
    outcome,
    facts: [fact],
    body: bodyLine ? [bodyLine] : [],
    allowedClaims: [allowedClaim],
  });

  if (has(args, "json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Narrator: ${result.source}`);
  if (result.error) console.log(`  error: ${result.error}`);
  console.log(`  ${result.text}`);
  console.log(`  claims: ${result.claims.join(", ") || "（无）"}`);
}

async function showCompiler(args: Args): Promise<void> {
  const armFlag = str(args, "arm", "both");
  const arms: Array<"blind" | "aware"> =
    armFlag === "blind" ? ["blind"] : armFlag === "aware" ? ["aware"] : ["blind", "aware"];
  if (armFlag !== "blind" && armFlag !== "aware" && armFlag !== "both") {
    throw new Error(`--arm 只能是 blind / aware / both，收到 ${armFlag}`);
  }

  const mode: CassetteMode = has(args, "record")
    ? "record"
    : has(args, "replay")
      ? "replay"
      : cassetteModeFromEnv();
  const dir = process.env.LLM_CASSETTE_DIR
    ? `${process.env.LLM_CASSETTE_DIR}/compiler`
    : ".cassette/compiler";
  const client = new CassetteClient(
    mode === "replay" ? undefined : createDeepSeekClient(),
    { mode, dir },
  );

  const report = await runCompilerValidation({ client, arms });
  const out = str(args, "out", "reports/compiler-v3.md") as string;
  writeCompilerReport(report, out);

  if (has(args, "json")) {
    const { markdown: _markdown, ...rest } = report;
    console.log(JSON.stringify({ ...rest, reportPath: out }, null, 2));
    return;
  }

  console.log("\nV3 Action Compiler");
  console.table(
    report.arms.map((arm) => ({
      臂: arm.arm,
      调用: arm.calls,
      合法: `${arm.valid}/${arm.calls}`,
      合法率: `${(arm.validRate * 100).toFixed(1)}%`,
      带本体标签: arm.ontologyTagged,
      跨世界差异: arm.worldDiff,
      family命中: `${arm.familyMatches}/${arm.familyCases}`,
      平均confidence: Number(arm.meanConfidence.toFixed(2)),
      平均需求sum: Number(arm.meanDemandSum.toFixed(2)),
    })),
  );
  console.log(
    `需求漂移：可比 ${report.drift.compared} | meanΔ ${report.drift.meanDelta.toFixed(2)} | ` +
      `aware 更低 ${report.drift.awareLower}/${report.drift.compared}`,
  );
  if (report.failures.length > 0) {
    console.log(`失败项 ${report.failures.length}:`);
    for (const failure of report.failures) console.log(`  - ${failure}`);
  } else {
    console.log("失败项：无");
  }
  console.log(`\n报告：${out}`);
  console.log(`明细：reports/compiler-v3.json（cassette=${mode}）`);
}

async function showV3(args: Args): Promise<void> {
  const mode: CassetteMode = has(args, "record")
    ? "record"
    : has(args, "replay")
      ? "replay"
      : cassetteModeFromEnv();
  const dir = process.env.LLM_CASSETTE_DIR
    ? `${process.env.LLM_CASSETTE_DIR}/compiler`
    : ".cassette/compiler";
  const client = new CassetteClient(
    mode === "replay" ? undefined : createDeepSeekClient(),
    { mode, dir },
  );

  const report = await runV3Validation({
    client,
    repeatCompile: mode === "replay" || has(args, "stability"),
  });

  const compileOut = "reports/compiler-v3.md";
  writeCompilerReport(report.compile, compileOut);
  const out = str(args, "out", "reports/v3-validation.md") as string;
  writeV3Report(report, out);

  if (has(args, "json")) {
    const { markdown: _markdown, compile: _compile, ...rest } = report;
    console.log(JSON.stringify({ ...rest, reportPath: out }, null, 2));
    return;
  }

  console.log("\nV3 完整验证");
  console.table(
    report.gates.map((gate) => ({
      门槛: gate.label,
      目标: gate.target,
      实际: gate.actual,
      判定: gate.pass ? "通过" : "失败",
    })),
  );
  console.table(
    report.compile.arms.map((arm) => ({
      臂: arm.arm,
      合法: `${arm.valid}/${arm.calls}`,
      带本体标签: arm.ontologyTagged,
      跨世界差异: arm.worldDiff,
      family命中: `${arm.familyMatches}/${arm.familyCases}`,
    })),
  );
  console.log(
    `端到端 ${report.e2e.cases.length} 例：自由身体物理世界本体拒绝 ` +
      `${report.e2e.freePhysicalBlocked.length}，秘法世界 narrative ${report.e2e.freeArcaneNarrative.length}；` +
      `确定性 ${report.e2e.determinismPassed}/${report.e2e.determinismChecked}。`,
  );
  console.log(
    `语义漏项 ${report.intent.failures}；世界矩阵 ${report.worlds.passed}/${report.worlds.total}；` +
      `约束单调性 ${report.e2e.monotonicPassed}/${report.e2e.monotonicChecked}。`,
  );
  if (report.failures.length > 0) {
    console.log(`失败项 ${report.failures.length}:`);
    for (const failure of report.failures) console.log(`  - ${failure}`);
  } else {
    console.log("失败项：无");
  }
  console.log(`\n报告：${out}`);
  console.log(`编译明细：${compileOut}`);
  console.log("人工抽检：reports/v3-review.md / reports/v3-review.csv");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [command, subcommand] = args.positionals;

  if (!command || command === "help") {
    help();
    return;
  }

  if (command === "llm") {
    if (subcommand === "ping" || subcommand === undefined) {
      await pingLlm();
      return;
    }
    if (subcommand === "turn") {
      await showTurn(args);
      return;
    }
    throw new Error(`未知 llm 子命令: ${subcommand}`);
  }

  if (command === "dm") {
    await showDm(args);
    return;
  }

  if (command === "narrate") {
    await showNarrate(args);
    return;
  }

  if (command === "compiler") {
    await showCompiler(args);
    return;
  }

  if (command === "v3") {
    await showV3(args);
    return;
  }

  if (command === "parity") {
    showParity(args);
    return;
  }

  if (command === "body") {
    const fixture = loadFixture(str(args, "fixture", "akha") as string);
    if (subcommand === "inspect" || subcommand === undefined) {
      showBody(fixture, has(args, "json"));
      return;
    }
    throw new Error(`未知 body 子命令: ${subcommand}`);
  }

  if (command === "check") {
    const fixture = loadFixture(str(args, "fixture", "akha") as string);
    showCheck(args, fixture);
    return;
  }

  if (command === "scenario") {
    if (subcommand === "run" || subcommand === undefined) {
      showScenario(args);
      return;
    }
    if (subcommand === "llm") {
      await showScenarioLlm(args);
      return;
    }
    throw new Error(`未知 scenario 子命令: ${subcommand}`);
  }

  if (command === "replay") {
    showReplay(args);
    return;
  }

  throw new Error(`未知命令: ${command}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
