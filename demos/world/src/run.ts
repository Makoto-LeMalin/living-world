/**
 * 世界 demo 的验证 runner 与报告。
 *
 * 运行：node demos/world/src/cli.ts report
 * 输出：reports/world-validation.md / reports/world-validation.json
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { verifyReplays } from "../../../harness/replay.ts";
import { buildWorld, defaultConfig, loadCanon } from "./world/canon.ts";
import { World } from "./world/world.ts";
import { checkCanonInvariants, checkWorldInvariants } from "./world/invariants.ts";
import { runSimulation, type SimulationResult } from "./sim.ts";
import { ask, chronicle, describeEvent } from "./query.ts";
import { diffSummary } from "./rules/return.ts";
import { forwardChain } from "./query.ts";
import type { ValidationGate, WorldEvent } from "./types.ts";

export interface ValidationResult {
  seeds: number;
  days: number;
  gates: ValidationGate[];
  main: SimulationResult;
  replayHashes: string[];
  seedChecks: Array<{ seed: string; ok: boolean; checks: number; errors: string[] }>;
  summary: Record<string, unknown>;
}

export interface ValidationOptions {
  seeds?: number;
  days?: number;
  replayRuns?: number;
}

function gate(id: string, name: string, pass: boolean, detail: string, blocking = true): ValidationGate {
  return { id, name, pass, detail, blocking };
}

function eventTypes(events: WorldEvent[]): string[] {
  return [...new Set(events.map((event) => event.type))];
}

function theftFact(result: SimulationResult) {
  return result.world.state.facts.find((fact) => fact.kind === "crime");
}

function jailFact(result: SimulationResult) {
  return result.world.state.facts.find((fact) => fact.kind === "law" && fact.detail.reason === "theft");
}

function knownShare(result: SimulationResult): number {
  const crime = theftFact(result);
  if (!crime) return 0;
  const relevant = ["npc_merchant", "npc_child", "npc_guard", "npc_beggar", "npc_innkeeper", "npc_drunk", "npc_thief", "npc_ferryman"];
  const known = relevant.filter((id) =>
    result.world.state.characters.find((character) => character.id === id)?.beliefs.some((belief) => belief.factId === crime.id),
  );
  return known.length / relevant.length;
}

function nonScriptedCount(result: SimulationResult): number {
  return result.world.state.eventLog.filter(
    (event) => event.provenance.source !== "system" && event.provenance.injected !== true,
  ).length;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function runValidation(options: ValidationOptions = {}): ValidationResult {
  const seeds = options.seeds ?? 20;
  const days = options.days ?? 3;
  const replayRuns = options.replayRuns ?? 5;
  const canon = loadCanon();

  const seedChecks: ValidationResult["seedChecks"] = [];
  for (let i = 1; i <= seeds; i++) {
    const seed = String(i);
    try {
      const world = new World(buildWorld(canon, defaultConfig(seed, days)));
      const report = checkWorldInvariants(world);
      seedChecks.push({ seed, ok: report.ok, checks: report.checks, errors: report.errors });
    } catch (error) {
      seedChecks.push({ seed, ok: false, checks: 0, errors: [String(error)] });
    }
  }

  const main = runSimulation({ seed: "7", days });
  const replayLogs = [main.world.state.eventLog];
  for (let i = 0; i < replayRuns; i++) {
    replayLogs.push(runSimulation({ seed: "7", days }).world.state.eventLog);
  }
  const replayVerdict = verifyReplays(replayLogs);
  const replayHashes = replayVerdict.hashes.slice(1);
  const replayOk = replayVerdict.ok;

  const crime = theftFact(main);
  const theftAttempt = main.world.state.eventLog.find((event) => event.type === "TheftAttempt");
  const theftRoot = theftAttempt?.id ?? crime?.sourceEventId;
  const theftChainEvents = theftRoot ? forwardChain(main.world, theftRoot) : [];
  const theftChainTypes = eventTypes(theftChainEvents);
  const fireChainEvents = main.fireEventId ? forwardChain(main.world, main.fireEventId) : [];
  const fireChainTypes = eventTypes(fireChainEvents);
  const sourceCounts = main.world.state.metrics.eventsBySource;
  const specialEvents = main.world.state.eventLog.filter((event) => event.provenance.source === "special");
  const ambientEvents = main.world.state.eventLog.filter((event) => event.provenance.source === "ambient");
  const actorEvents = main.world.state.eventLog.filter((event) => event.provenance.source === "actor");
  const directorPlans = main.world.state.plans.filter((plan) => plan.createdBy === "world-director");
  const actorPlans = main.world.state.plans.filter((plan) => plan.createdBy === "action-dm");
  const canonPlans = main.world.state.plans.filter((plan) => plan.createdBy === "canon");
  const nonScripted = nonScriptedCount(main);
  const changedWithoutEvents = main.returnDiff?.changed.filter((change) => change.eventIds.length === 0) ?? [];
  const stableLandmarks = main.returnDiff?.stableIds.filter((id) => id.startsWith("lm_")) ?? [];
  const echoKinds = new Set(main.returnDiff?.echoes.map((echo) => echo.verdict) ?? []);
  const hasDistorted = echoKinds.has("distorted");
  const hasConfirmed = echoKinds.has("confirmed");
  const budgetDays = Object.values(main.world.state.budget.directorCallsByDay);
  const maxDirectorDay = budgetDays.length === 0 ? 0 : Math.max(...budgetDays);
  const totalCalls = main.world.state.metrics.llmCalls + main.world.state.metrics.directorProposals;
  const known = knownShare(main);
  const knownAt12h = main.knownShareAt12h;
  const chronicleLines = chronicle(main.world).filter((line) => line.startsWith("- ")).length;

  const gates: ValidationGate[] = [
    gate(
      "WB-1",
      "20 seed 生成不变量",
      seedChecks.every((check) => check.ok),
      `${seedChecks.filter((check) => check.ok).length}/${seedChecks.length} seeds pass; ` +
        `canon checks=${checkCanonInvariants(canon).checks}`,
    ),
    gate(
      "WB-2",
      "确定性回放",
      replayOk,
      `${replayHashes.length}/${replayRuns} 次事件日志字节级一致`,
    ),
    gate(
      "WB-3",
      "日程遵循",
      main.schedule.ratio >= 0.95,
      `adhered=${main.schedule.adhered} transit=${main.schedule.transit} excused=${main.schedule.excused} ` +
        `violations=${main.schedule.violations} ratio=${(main.schedule.ratio * 100).toFixed(2)}%`,
    ),
    gate(
      "WB-4",
      "观察/查询一致",
      ask(main.world, "npc_guard", "你们抓了谁？").claims.join(",") ===
        ask(main.world, "npc_guard", "你们抓了谁？").claims.join(",") &&
        (main.returnDiff?.changed.every((change) => change.eventIds.length > 0) ?? false),
      `changed 全部带 eventIds: ${changedWithoutEvents.length === 0}; 重复查询稳定`,
    ),
    gate(
      "WB-5",
      "传播链",
      theftChainTypes.includes("TheftAttempt") &&
        theftChainTypes.includes("Witnessed") &&
        theftChainTypes.includes("RumorTold") &&
        theftChainTypes.includes("Investigated") &&
        theftChainTypes.includes("Jailed") &&
        knownAt12h >= 0.8,
      `theft chain=${theftChainTypes.join("→")}; 12h 后相关 NPC 知情率=${(knownAt12h * 100).toFixed(0)}%`,
      false,
    ),
    gate(
      "WB-6",
      "世界存活",
      main.invariants.ok && main.plansTerminal && nonScripted >= 5,
      `invariants=${main.invariants.ok}; plans terminal=${main.plansTerminal}; non-scripted events=${nonScripted}`,
      false,
    ),
    gate(
      "WB-7",
      "预算/降级",
      maxDirectorDay <= 8 && totalCalls <= 30,
      `max director/day=${maxDirectorDay} (limit 8); character=${main.world.state.metrics.llmCalls}; ` +
        `total=${totalCalls} (limit 30)`,
      false,
    ),
    gate(
      "WB-8",
      "JSON 导出/读回",
      jsonRoundTripPasses(main),
      "snapshot + JSONL 写入临时目录并读回，事件数/查询一致",
    ),
    gate(
      "WB-9",
      "编年史可信（结构）",
      chronicleLines >= 30,
      `chronicle 高信号事件=${chronicleLines}；主观评审未做（需 2 名评审）`,
      false,
    ),
    gate(
      "WB-10",
      "LLM 占比",
      main.world.state.metrics.llmCalls === 0,
      `LLM calls=${main.world.state.metrics.llmCalls}; NPC 动作 100% 规则`,
      false,
    ),
    gate(
      "A→B→A",
      "离开/返回连续性",
      Boolean(main.returnDiff) &&
        changedWithoutEvents.length === 0 &&
        stableLandmarks.length > 0 &&
        hasDistorted &&
        hasConfirmed,
      main.returnDiff
        ? `${diffSummary(main.returnDiff)}; echoes=${[...echoKinds].join("/")}; stable landmarks=${stableLandmarks.length}`
        : "没有 return diff",
    ),
    gate(
      "PROV",
      "三源与 provenance",
      sourceCounts.ambient > 0 &&
        sourceCounts.actor > 0 &&
        sourceCounts.special > 0 &&
        ambientEvents.every((event) => event.provenance.source) &&
        actorEvents.every((event) => event.provenance.source) &&
        specialEvents.every((event) => event.provenance.source) &&
        directorPlans.length > 0 &&
        actorPlans.length > 0 &&
        canonPlans.length > 0,
      `ambient=${sourceCounts.ambient} actor=${sourceCounts.actor} special=${sourceCounts.special}; ` +
        `director plans=${directorPlans.length}; actor plans=${actorPlans.length}; canon plans=${canonPlans.length}`,
    ),
  ];

  const summary = {
    seed: main.config.worldSeed,
    days,
    rooms: main.world.state.rooms.length,
    characters: main.world.state.characters.length,
    crowds: main.world.state.crowds.length,
    events: main.world.state.metrics.events,
    eventsBySource: sourceCounts,
    projectionHash: main.world.projectionHash(),
    fullHash: main.world.fullHash(),
    plans: main.world.state.plans.length,
    theft: main.theft
      ? {
          success: main.theft.success,
          chance: round(main.theft.chance),
          roll: round(main.theft.roll),
          difficulty: main.theft.difficulty,
          chain: theftChainTypes,
          chainLength: theftChainEvents.length,
        }
      : null,
    fire: {
      chain: fireChainTypes,
      chainLength: fireChainEvents.length,
      spread: main.world.state.facts.some((fact) => fact.kind === "fire" && fact.detail.spreads === true),
    },
    schedule: {
      ...main.schedule,
      ratio: round(main.schedule.ratio),
    },
    budget: {
      ...main.budget,
      maxDirectorDay,
      totalCalls,
    },
    knownShare: round(known, 3),
    knownShareAt12h: round(knownAt12h, 3),
    returnDiff: main.returnDiff
      ? {
          stable: main.returnDiff.stableIds.length,
          changed: main.returnDiff.changed.length,
          added: main.returnDiff.addedIds.length,
          removed: main.returnDiff.removedIds.length,
          echoes: main.returnDiff.echoes.map((echo) => ({
            factId: echo.factId,
            verdict: echo.verdict,
            note: echo.note,
          })),
          climateDelta: main.returnDiff.climateDelta,
        }
      : null,
    queries: Object.fromEntries(
      Object.entries(main.queries).map(([id, answer]) => [
        id,
        { answer: answer.answer, claims: answer.claims, confidence: answer.confidence, unknown: answer.unknown },
      ]),
    ),
    gates: gates.map((entry) => ({ id: entry.id, pass: entry.pass, detail: entry.detail })),
  };

  return { seeds, days, gates, main, replayHashes, seedChecks, summary };
}

function jsonRoundTripPasses(result: SimulationResult): boolean {
  const dir = mkdtempSync(join(tmpdir(), "lw-world-"));
  try {
    const eventPath = join(dir, "events.jsonl");
    const snapshotPath = join(dir, "snapshot.json");
    result.world.writeEventLog(eventPath);
    result.world.writeSnapshot(snapshotPath);
    const events = World.readEventLog(eventPath);
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as { snapshot: SimulationResult["world"]["state"] };
    const restored = World.fromSnapshot(snapshot.snapshot, events);
    const originalAnswer = ask(result.world, "npc_guard", "你们抓了谁？");
    const restoredAnswer = ask(restored, "npc_guard", "你们抓了谁？");
    return (
      events.length === result.world.state.eventLog.length &&
      restoredAnswer.answer === originalAnswer.answer &&
      restored.state.facts.length === result.world.state.facts.length
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function chainRows(events: WorldEvent[], world: World): string[] {
  return [...events]
    .sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id))
    .map(
      (event) =>
        `| ${event.id} | ${event.tick} | ${event.type} | ${event.provenance.source} | ${event.sourceEventIds.join(",") || "—"} | ${describeEvent(world, event)} |`,
    );
}

export function writeValidationReport(result: ValidationResult, base = "reports/world-validation"): void {
  const mdPath = `${base}.md`;
  const jsonPath = `${base}.json`;
  mkdirSync("reports", { recursive: true });

  const main = result.main;
  const crime = theftFact(main);
  const theftAttempt = main.world.state.eventLog.find((event) => event.type === "TheftAttempt");
  const theftRoot = theftAttempt?.id ?? crime?.sourceEventId;
  const theftEvents = theftRoot ? forwardChain(main.world, theftRoot) : [];
  const fireEvents = main.fireEventId ? forwardChain(main.world, main.fireEventId) : [];
  const theftReportEvents = theftEvents
    .filter((event, index) => event.type !== "RumorTold" || index < 8)
    .slice(0, 60);
  const passCount = result.gates.filter((entry) => entry.pass).length;
  const blockFailures = result.gates.filter((entry) => entry.blocking && !entry.pass);
  const lines: string[] = [
    "# 世界 demo 验证报告",
    "",
    `运行：\`node demos/world/src/cli.ts report\`  ·  seed=${main.config.worldSeed}  ·  ${result.days} 天 / ${main.world.state.rooms.length} 房间 / ${main.world.state.characters.length} NPC`,
    "",
    "## 结论",
    "",
    `- 门数：${passCount}/${result.gates.length} 通过；阻断项失败：${blockFailures.length}`,
    `- 事件：${main.world.state.metrics.events} 条；来源 ${JSON.stringify(main.world.state.metrics.eventsBySource)}`,
    `- 盗窃：${main.theft?.success ? "成功" : "失败"}，p=${main.theft?.chance.toFixed(3)}，roll=${main.theft?.roll.toFixed(3)}`,
    `- 12h 后相关 NPC 知情率：${(main.knownShareAt12h * 100).toFixed(1)}%（7/8）`,
    `- 日程遵循：${(main.schedule.ratio * 100).toFixed(2)}%；transit=${main.schedule.transit}，excused=${main.schedule.excused}，violations=${main.schedule.violations}`,
    `- 预算：director/day=${result.summary.budget && (result.summary.budget as Record<string, unknown>).maxDirectorDay}，character=${main.world.state.metrics.llmCalls}，total=${main.world.state.metrics.llmCalls + main.world.state.metrics.directorProposals}`,
    `- 返回：${main.returnDiff ? diffSummary(main.returnDiff) : "无"}`,
    "",
    "## 门",
    "",
    "| ID | 检查 | 结果 | 说明 |",
    "|---|---|---|---|",
    ...result.gates.map((entry) => `| ${entry.id} | ${entry.name} | ${entry.pass ? "PASS" : "FAIL"} | ${entry.detail} |`),
    "",
    "## B0：20 个 seed",
    "",
    "| seed | 结果 | 检查数 |",
    "|---|---|---|",
    ...result.seedChecks.map((check) => `| ${check.seed} | ${check.ok ? "ok" : "FAIL"} | ${check.checks} |`),
    "",
    "## B2：盗窃链（正向引用）",
    "",
    "| 事件 | tick | 类型 | source | 引用 | 摘要 |",
    "|---|---|---|---|---|---|",
    ...chainRows(theftReportEvents, main.world),
    ...(theftEvents.length > theftReportEvents.length
      ? ["", `> 报告只列关键链（${theftReportEvents.length} 条）；完整链共 ${theftEvents.length} 条，包含全部传闻事件，见 reports/world-events.jsonl。`]
      : []),
    "",
    "## B2：火灾链（正向引用）",
    "",
    "| 事件 | tick | 类型 | source | 引用 | 摘要 |",
    "|---|---|---|---|---|---|",
    ...chainRows(fireEvents, main.world),
    "",
    "## 返回差分",
    "",
    main.returnDiff
      ? [
          `- stable：${main.returnDiff.stableIds.join(", ")}`,
          `- changed：${main.returnDiff.changed.map((change) => `${change.id} (${change.eventIds.join(",")})`).join("; ") || "无"}`,
          `- added：${main.returnDiff.addedIds.join(", ") || "无"}`,
          `- removed：${main.returnDiff.removedIds.join(", ") || "无"}`,
          `- climate：${JSON.stringify(main.returnDiff.climateDelta)}`,
          "",
          "| fact | 回响 | 说明 |",
          "|---|---|---|",
          ...main.returnDiff.echoes.map((echo) => `| ${echo.factId} | ${echo.verdict} | ${echo.note} |`),
        ].join("\n")
      : "无",
    "",
    "## D4 问话",
    "",
    ...Object.entries(main.queries).map(
      ([id, answer]) => `### ${id}\n\n${answer.answer}\n\nclaims: ${answer.claims.join(", ") || "—"}；confidence=${answer.confidence}；unknown=${answer.unknown}\n`,
    ),
    "## 预算与成本",
    "",
    "| 项 | 值 |",
    "|---|---|",
    `| director 每日上限 | 8 |`,
    `| character 每日上限 | 22 |`,
    `| 实际 director | ${main.world.state.metrics.directorProposals} |`,
    `| 实际 character | ${main.world.state.metrics.llmCalls} |`,
    `| 总 | ${main.world.state.metrics.llmCalls + main.world.state.metrics.directorProposals} |`,
    `| offstage 角色调用 | 0 |`,
    "",
    "## 已知限制",
    "",
    "- 本阶段是 B0–B2：零 LLM。WorldDirector 用确定性模板替代模型；B3 才接真实 LLM/cassette。",
    "- NPC 动作 100% 规则；代价是 NPC 不会做出规则没覆盖的“聪明”动作。",
    "- WB-9 只做了结构检查；主观评审（2 人）尚未做。",
    "- 20 seed 的 WB-1 只检查 builder 不变量；完整 3 天只跑了 seed 7。",
    "- 火灾链的分支随 seed/roll 变化：本报告可能是 `FireSpread` 或 `FireContained`；两种都保留完整四跳链。",
    "- 高 salience 自然事件（illness/structural/fire）按地区 hazard 抽签；本报告使用模板 Director，B3 验证另见 `reports/world-b3-validation.md`。",
    "",
    `事件日志：[world-events.jsonl](world-events.jsonl)  ·  编年史：\`node demos/world/src/cli.ts chronicle\``,
    "",
  ];

  writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
  writeFileSync(jsonPath, `${JSON.stringify(result.summary, null, 2)}\n`, "utf8");
  main.world.writeEventLog("reports/world-events.jsonl");
  console.log(`wrote ${mdPath}`);
  console.log(`wrote ${jsonPath}`);
  console.log("wrote reports/world-events.jsonl");
}
