/**
 * B3 验证：完整 3 天真实 LLM 仿真 + CharacterRuntime/T0–T3/群体/预算。
 *
 * 报告默认从 `demos/world/fixtures/llm-b3` 回放已录制的真实 DeepSeek 响应；
 * 不读 .env、不重新请求模型，也不把 key/headers 写进产物。
 */

import { readdirSync, writeFileSync } from "node:fs";

import { CassetteClient } from "../../../llm/cassette.ts";
import { validateProposal } from "./rules/plans.ts";
import { checkWorldInvariants } from "./world/invariants.ts";
import {
  checkCm1,
  checkCm6,
  checkCm7,
  checkCm8,
  checkBudgetStressAsync,
  maxTierCoverage,
  tierImportanceSample,
  type BudgetStressCheck,
  type Cm6Check,
  type Cm7Check,
  type LeakCheck,
} from "./b3-checks.ts";
import { runB3Full, type B3FullRun } from "./b3-full.ts";
import { BUDGET_LIMITS } from "./rules/budget.ts";
import type { ValidationGate } from "./types.ts";

export const B3_FULL_CASSETTE_DIR = "demos/world/fixtures/llm-b3";

export interface B3ValidationResult {
  gates: ValidationGate[];
  full: B3FullRun;
  replay: {
    identical: boolean;
    hashA: string;
    hashB: string;
    eventsA: number;
    eventsB: number;
  };
  cm1: ReturnType<typeof checkCm1>;
  cm6: Cm6Check;
  cm7: Cm7Check;
  cm8: LeakCheck;
  budgetStress: BudgetStressCheck;
  tiers: { coverage: ReturnType<typeof maxTierCoverage>; sample: ReturnType<typeof tierImportanceSample> };
  cassetteFiles: number;
  summary: Record<string, unknown>;
}

function gate(id: string, name: string, pass: boolean, detail: string, blocking = false): ValidationGate {
  return { id, name, pass, detail, blocking };
}

function countCassettes(dir: string): number {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

export async function runB3Validation(): Promise<B3ValidationResult> {
  const replay = new CassetteClient(undefined, { mode: "replay", dir: B3_FULL_CASSETTE_DIR });
  const full = await runB3Full({ client: replay, seed: "7", days: 3 });
  const second = await runB3Full({ client: replay, seed: "7", days: 3 });
  const hashA = full.simulation.world.projectionHash();
  const hashB = second.simulation.world.projectionHash();
  const replayIdentical =
    JSON.stringify(full.simulation.world.state.eventLog) === JSON.stringify(second.simulation.world.state.eventLog) &&
    full.simulation.world.fullHash() === second.simulation.world.fullHash();

  const cm1 = checkCm1();
  const cm6 = checkCm6();
  const cm7 = checkCm7();
  const cm8 = checkCm8(full.simulation.world);
  const budgetStress = await checkBudgetStressAsync();
  const tiers = {
    coverage: maxTierCoverage(full.simulation.world),
    sample: tierImportanceSample(full.simulation.world).slice(0, 10),
  };

  const budget = full.simulation.budget;
  const runtime = full.simulation.runtime;
  const dialogues = runtime?.dialogues ?? [];
  const dialogueCalls = runtime?.dialogueCalls ?? 0;
  const allClaimsValid = dialogues.every((dialogue) => dialogue.claimsValid);
  const llmSources = dialogues.filter((dialogue) => dialogue.source === "llm").length;
  const cassetteMisses =
    dialogues.filter((dialogue) => dialogue.error?.includes("ENOENT") === true).length +
    full.directorTrace.filter((entry) => entry.phase === "fallback" && entry.error?.includes("ENOENT") === true).length;
  const spokeCalls = full.simulation.world.state.eventLog.filter((event) => event.type === "Spoke").length;
  const directorValid = full.proposals.every((proposal) => validateProposal(full.simulation.world, proposal).ok);
  const noActors = full.proposals.every((proposal) => proposal.actorIds.length === 0);
  const tierChanges = full.simulation.world.state.metrics.tierChanges;
  const promotions = full.simulation.world.state.metrics.promotions;
  const demotions = full.simulation.world.state.metrics.demotions;
  const crowdIndividualizations = full.simulation.world.state.metrics.crowdIndividualizations;
  const crowdMerges = full.simulation.world.state.metrics.crowdMerges;
  const worldInvariants = checkWorldInvariants(full.simulation.world);
  const maxDirectorDay = budget.maxDirectorDay;
  const maxCharacterDay = budget.maxCharacterDay;
  const maxTotalDay = budget.maxTotalDay;
  const maxCharacterTick = budget.maxCharacterTick;
  const cassetteFiles = countCassettes(B3_FULL_CASSETTE_DIR);

  const gates: ValidationGate[] = [
    gate(
      "B3-CM1",
      "PC/NPC/群体共用 CharacterRuntime",
      cm1.pass,
      `pc=${cm1.pc.pass}; npc=${cm1.npc.pass}; crowd=${cm1.crowd.pass}; 每套 ${cm1.pc.checks.length} 项`,
      true,
    ),
    gate(
      "B3-TIERS",
      "T0–T3 分层与晋升/降级",
      tiers.coverage.pass && tierChanges > 0 && promotions > 0 && demotions > 0,
      `tiers=${tiers.coverage.tiers.join("/")}; changes=${tierChanges}; promotions=${promotions}; demotions=${demotions}`,
      true,
    ),
    gate(
      "B3-CM6",
      "降级→晋升 20 次身份连续",
      cm6.pass,
      `identity=${cm6.identityStable}/${cm6.cycles * 2}; relationships=${cm6.relationshipsStable}/${cm6.cycles * 2}; keyMemories=${cm6.keyMemoriesRetained}/${cm6.cycles}`,
      true,
    ),
    gate(
      "B3-CM7",
      "群体个体化/合并/再观察一致",
      cm7.pass,
      `size ${cm7.initialSize}→${cm7.afterIndividualize}→${cm7.afterMerge}→${cm7.afterReobserve}; sameIdentity=${cm7.sameIdentity}; id=${cm7.identityHash}`,
      true,
    ),
    gate(
      "B3-CROWD-RUN",
      "完整 3 天群体个体化/合并",
      crowdIndividualizations > 0 && crowdMerges > 0,
      `individualized=${crowdIndividualizations}; merged=${crowdMerges}; crowdActions=${runtime?.crowdActions ?? 0}`,
      true,
    ),
    gate(
      "B3-CM8",
      "知识边界 0 泄漏",
      cm8.pass,
      `checked=${cm8.checkedBeliefs}; leaks=${cm8.leaks.length}`,
      true,
    ),
    gate(
      "B3-DIR",
      "完整 3 天真实 WorldDirector",
      full.directorAttempts > 0 && full.proposals.length > 0 && directorValid,
      `attempts=${full.directorAttempts}; proposals=${full.proposals.length}; valid=${directorValid}; fallback=${full.directorFallbacks}`,
      true,
    ),
    gate(
      "B3-DIR-NO-ACTOR",
      "自然事件无主动 actor",
      noActors,
      `actorIds 全空; types=${[...new Set(full.proposals.map((proposal) => proposal.type))].join(",")}`,
    ),
    gate(
      "B3-DIALOGUE",
      "完整 3 天真实 focus 对话",
      dialogueCalls > 0 && llmSources > 0 && allClaimsValid && spokeCalls >= dialogueCalls && cassetteMisses === 0,
      `calls=${dialogueCalls}; llmSources=${llmSources}; npcs=${dialogues.length}; claimsValid=${allClaimsValid}; Spoke=${spokeCalls}; cassetteMisses=${cassetteMisses}`,
      true,
    ),
    gate(
      "B3-CM5",
      "角色/世界双预算 + 每 tick K",
      maxCharacterDay <= BUDGET_LIMITS.characterPerDay &&
        maxDirectorDay <= BUDGET_LIMITS.directorPerDay &&
        maxTotalDay <= BUDGET_LIMITS.totalPerDay &&
        maxCharacterTick <= BUDGET_LIMITS.characterConcurrentPerTick &&
        (runtime?.offstageCharacterCalls ?? 0) === 0,
      `char=${maxCharacterDay}/22; director=${maxDirectorDay}/8; total=${maxTotalDay}/30; maxTick=${maxCharacterTick}/3; offstage=${runtime?.offstageCharacterCalls ?? 0}`,
      true,
    ),
    gate(
      "B3-DEGRADE",
      "预算耗尽降级不崩",
      budgetStress.pass,
      `char=${budgetStress.characterCalls}; director=${budgetStress.directorCalls}; total=${budgetStress.total}; fallbackCalls=${budgetStress.fallbackCalls}; degraded=${budgetStress.degradedEvents}`,
      true,
    ),
    gate(
      "B3-REPLAY",
      "同 seed + cassette 回放一致",
      replayIdentical && cassetteFiles > 0 && cassetteMisses === 0,
      `events=${full.simulation.world.state.metrics.events}; hash=${hashA}/${hashB}; cassettes=${cassetteFiles}; misses=${cassetteMisses}`,
      true,
    ),
    gate(
      "B3-WORLD",
      "完整 3 天世界不变量",
      worldInvariants.ok && full.simulation.invariants.ok && full.simulation.plansTerminal,
      `world=${worldInvariants.ok}; sim=${full.simulation.invariants.ok}; plansTerminal=${full.simulation.plansTerminal}; events=${full.simulation.world.state.metrics.events}`,
      true,
    ),
  ];

  const summary = {
    full: {
      seed: full.simulation.config.worldSeed,
      days: full.simulation.config.days,
      events: full.simulation.world.state.metrics.events,
      sources: full.simulation.world.state.metrics.eventsBySource,
      tiers: tiers.coverage.tiers,
      tierChanges,
      promotions: full.simulation.world.state.metrics.promotions,
      demotions: full.simulation.world.state.metrics.demotions,
      crowdActions: runtime?.crowdActions ?? 0,
      crowdIndividualizations,
      crowdMerges,
      queries: full.simulation.queries,
    },
    director: {
      attempts: full.directorAttempts,
      proposals: full.proposals.length,
      valid: directorValid,
      noActors,
      fallback: full.directorFallbacks,
      types: full.proposals.map((proposal) => proposal.type),
      directions: full.proposals.map((proposal) => proposal.direction),
    },
    dialogue: {
      calls: dialogueCalls,
      llmSources,
      fallbacks: dialogues.length - llmSources,
      cassetteMisses,
      scenes: dialogues.length,
      npcs: [...new Set(dialogues.map((dialogue) => dialogue.npcId))],
      byLod: runtime?.dialogueByLod ?? {},
      byNpc: runtime?.dialogueByNpc ?? {},
      allClaimsValid,
      items: dialogues.map((dialogue) => ({
        npcId: dialogue.npcId,
        lod: dialogue.lod,
        source: dialogue.source,
        speech: dialogue.speech,
        claims: dialogue.claims,
        tone: dialogue.tone,
        calls: dialogue.calls,
        claimsValid: dialogue.claimsValid,
        eventId: dialogue.eventId,
        error: dialogue.error,
      })),
    },
    budget: {
      totals: budget,
      limits: BUDGET_LIMITS,
      maxDirectorDay,
      maxCharacterDay,
      maxTotalDay,
      maxCharacterTick,
      offstageCharacterCalls: runtime?.offstageCharacterCalls ?? 0,
    },
    cm1,
    cm6,
    cm7,
    cm8,
    budgetStress,
    tiers,
    replay: {
      identical: replayIdentical,
      hashA,
      hashB,
      eventsA: full.simulation.world.state.metrics.events,
      eventsB: second.simulation.world.state.metrics.events,
    },
    cassetteFiles,
    gates: gates.map((entry) => ({ id: entry.id, pass: entry.pass, detail: entry.detail })),
  };

  return {
    gates,
    full,
    replay: {
      identical: replayIdentical,
      hashA,
      hashB,
      eventsA: full.simulation.world.state.metrics.events,
      eventsB: second.simulation.world.state.metrics.events,
    },
    cm1,
    cm6,
    cm7,
    cm8,
    budgetStress,
    tiers,
    cassetteFiles,
    summary,
  };
}

function table(headers: string[], rows: string[][]): string[] {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
}

export function writeB3Report(result: B3ValidationResult, base = "reports/world-b3-validation"): void {
  const passCount = result.gates.filter((entry) => entry.pass).length;
  const metrics = result.full.simulation.world.state.metrics;
  const budget = result.full.simulation.budget;
  const dialogues = result.full.simulation.runtime?.dialogues ?? [];
  const lines = [
    "# 世界 demo B3 验证报告",
    "",
    `运行：\`node demos/world/src/cli.ts report\`；B3 从 \`${B3_FULL_CASSETTE_DIR}\` 回放已录制的真实 DeepSeek 响应，不重新请求，不读取 key。`,
    "",
    "## 结论",
    "",
    `- 门数：${passCount}/${result.gates.length}`,
    `- 完整 3 天：${metrics.events} 事件；T0–T3=${result.tiers.coverage.tiers.join("/")}；晋升/降级 ${metrics.promotions}/${metrics.demotions}；群体个体化/合并 ${metrics.crowdIndividualizations}/${metrics.crowdMerges}。`,
    `- WorldDirector：${result.full.directorAttempts} 次真实调用，${result.full.proposals.length} 个合法提案，fallback=${result.full.directorFallbacks}。`,
    `- 角色对话：${result.full.simulation.runtime?.dialogueCalls ?? 0} 次真实调用，涉及 ${new Set(dialogues.map((dialogue) => dialogue.npcId)).size} 个 NPC；LLM 采用 ${(result.summary.dialogue as Record<string, unknown>)?.llmSources ?? "?"}/${dialogues.length}，claims 全部合法=${(result.summary.dialogue as Record<string, unknown>)?.allClaimsValid}，cassette miss=${(result.summary.dialogue as Record<string, unknown>)?.cassetteMisses}。`,
    `- 预算峰值：角色 ${budget.maxCharacterDay}/22、Director ${budget.maxDirectorDay}/8、总 ${budget.maxTotalDay}/30、单 tick ${budget.maxCharacterTick}/3；offstage=${result.full.simulation.runtime?.offstageCharacterCalls ?? 0}。`,
    `- 回放：${result.replay.identical ? "一致" : "不一致"}；hash=${result.replay.hashA}/${result.replay.hashB}；cassette=${result.cassetteFiles}。`,
    "",
    "## 门",
    "",
    ...table(
      ["ID", "检查", "结果", "说明"],
      result.gates.map((entry) => [entry.id, entry.name, entry.pass ? "PASS" : "FAIL", entry.detail]),
    ),
    "",
    "## CharacterRuntime / 生命周期",
    "",
    ...table(
      ["检查", "结果", "证据"],
      [
        ["CM-1 PC/NPC/群体同一契约", result.cm1.pass ? "PASS" : "FAIL", `pc=${result.cm1.pc.checks.length} 项；npc=${result.cm1.npc.checks.length} 项；crowd=${result.cm1.crowd.checks.length} 项`],
        ["CM-6 20 次降级→晋升", result.cm6.pass ? "PASS" : "FAIL", `identity ${result.cm6.identityStable}/40；relationships ${result.cm6.relationshipsStable}/40；keyMemories ${result.cm6.keyMemoriesRetained}/20`],
        ["CM-7 群体个体化/合并/再观察", result.cm7.pass ? "PASS" : "FAIL", `size ${result.cm7.initialSize}→${result.cm7.afterIndividualize}→${result.cm7.afterMerge}→${result.cm7.afterReobserve}；sameIdentity=${result.cm7.sameIdentity}`],
        ["CM-8 未目击知识泄漏", result.cm8.pass ? "PASS" : "FAIL", `checked ${result.cm8.checkedBeliefs} beliefs；leaks ${result.cm8.leaks.length}`],
        ["预算耗尽降级", result.budgetStress.pass ? "PASS" : "FAIL", `${result.budgetStress.characterCalls}+${result.budgetStress.directorCalls}=${result.budgetStress.total}；fallbackCalls=${result.budgetStress.fallbackCalls}；degraded=${result.budgetStress.degradedEvents}`],
      ],
    ),
    "",
    "## 完整 3 天真实 LLM 运行",
    "",
    ...table(
      ["项", "值"],
      [
        ["事件", String(metrics.events)],
        ["来源", JSON.stringify(metrics.eventsBySource)],
        ["日程", `adhered=${metrics.schedule.adhered}; transit=${metrics.schedule.transit}; excused=${metrics.schedule.excused}; violations=${metrics.schedule.violations}`],
        ["计划", `created=${metrics.plans.created}; resolved=${metrics.plans.resolved}; aborted=${metrics.plans.aborted}`],
        ["Tier changes", `${metrics.tierChanges}（P ${metrics.promotions} / D ${metrics.demotions}）`],
        ["Crowd lifecycle", `individualized=${metrics.crowdIndividualizations}; merged=${metrics.crowdMerges}; actions=${result.full.simulation.runtime?.crowdActions ?? 0}`],
        ["Director calls", String(result.full.directorAttempts)],
        ["Dialogue calls", String(result.full.simulation.runtime?.dialogueCalls ?? 0)],
        ["offstage char calls", String(result.full.simulation.runtime?.offstageCharacterCalls ?? 0)],
      ],
    ),
    "",
    "## WorldDirector 提案（真实模型 → Validator）",
    "",
    ...(result.full.proposals.length === 0
      ? ["本次运行没有高 salience 自然事件触发，因此没有 Director 提案；这是合法结果。"]
      : table(
          ["#", "type", "room", "direction", "stakes"],
          result.full.proposals.map((proposal, index) => [
            String(index + 1),
            proposal.type,
            proposal.roomId,
            proposal.direction,
            String(proposal.stakes),
          ]),
        )),
    "",
    "## 角色对话（真实模型 → ClaimCheck → Spoke）",
    "",
    ...(dialogues.length === 0
      ? ["本次运行没有同房间 focus 场景。"]
      : table(
          ["NPC", "LOD", "source", "calls", "claims", "台词"],
          dialogues.map((dialogue) => [
            dialogue.npcId,
            dialogue.lod,
            dialogue.source,
            String(dialogue.calls),
            dialogue.claims.join(",") || "—",
            dialogue.speech.replace(/\|/g, "\\|"),
          ]),
        )),
    "",
    "## 预算",
    "",
    ...table(
      ["项", "值"],
      [
        ["角色/日上限", "22"],
        ["WorldDirector/日上限", "8"],
        ["总/日上限", "30"],
        ["单 tick 角色上限", "3"],
        ["本场景角色调用", String(budget.character)],
        ["本场景 Director 调用", String(budget.director)],
        ["本场景总调用", String(budget.total)],
        ["offstage 角色调用", String(result.full.simulation.runtime?.offstageCharacterCalls ?? 0)],
        ["按 LOD", JSON.stringify(result.full.simulation.runtime?.dialogueByLod ?? {})],
        ["按 NPC", JSON.stringify(result.full.simulation.runtime?.dialogueByNpc ?? {})],
        ["降级事件", JSON.stringify(budget.degraded)],
      ],
    ),
    "",
    "## 回放与数据安全",
    "",
    `- 同 seed + 同一 cassette 两次运行事件日志一致：${result.replay.identical ? "是" : "否"}。`,
    `- projection hash：${result.replay.hashA} / ${result.replay.hashB}。`,
    `- cassette：${result.cassetteFiles} 个文件，位于 \`${B3_FULL_CASSETTE_DIR}\`；只有 request/response，没有 key/headers。`,
    `- 报告与 JSON 均不包含 \`.env\` 内容。`,
    "",
    "## 说明",
    "",
    "- 这是 B3 的完整验证：CM-1/5/6/7/8 全部有可执行检查，完整 3 天走真实 LLM 并回放。",
    "- NPC 动作仍由规则选择；LLM 只做 WorldDirector 提案和角色台词。",
    "- T0–T3 的层级变化有 1 世界日冷却；CM-6 的 20 次循环使用测试强制接口，不冒充自然晋升。",
    "",
  ];
  writeFileSync(`${base}.md`, `${lines.join("\n")}\n`, "utf8");
  writeFileSync(`${base}.json`, `${JSON.stringify(result.summary, null, 2)}\n`, "utf8");
  console.log(`wrote ${base}.md`);
  console.log(`wrote ${base}.json`);
}
