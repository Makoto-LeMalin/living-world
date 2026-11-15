/**
 * V3 完整验证：编译 → 语义 → 世界规则 → 身体 → 掷骰。
 *
 * 输出四份东西：
 * - reports/compiler-v3.md/json     编译明细（沿用原有格式）
 * - reports/v3-validation.md/json   本文件的门槛与汇总
 * - reports/v3-review.md/csv        人工抽检包（100 行）
 *
 * 不在这里写时间戳：同一 cassette 回放两次应得到逐字节相同的报告。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { canonicalJson } from "../../../../engine/json.ts";
import type { ChatClient } from "../../../../llm/types.ts";
import { loadFixture } from "../fixture.ts";
import type { Body } from "../body.ts";
import {
  runCompilerValidation,
  type CompilerArmSummary,
  type CompilerReport,
  type CompilerRow,
} from "../compiler-run.ts";
import { DIMS, type Dim } from "../v2/dimensions.ts";
import { verifyIntent, type IntentCheck } from "./intent.ts";
import { resolveAction, type ResolveResult } from "./resolve.ts";
import {
  DEFAULT_WORLDS,
  runWorldMatrix,
  type WorldMatrixResult,
  type WorldRules,
} from "./world.ts";

export interface BodyVariant {
  id: string;
  label: string;
  body: Body;
}

export interface E2ECase {
  bodyId: string;
  worldId: string;
  actionId: string;
  status: ResolveResult["status"];
  reason?: string;
  C?: number;
  D?: number;
  p?: number;
  u?: number;
  outcome?: string;
  tags: string[];
}

export interface V3Gate {
  id: string;
  label: string;
  target: string;
  actual: string;
  pass: boolean;
}

export interface ReviewRow {
  actionId: string;
  description: string;
  dims: Partial<Record<Dim, number>>;
  assist: Partial<Record<Dim, number>>;
  ontologyTags: string[];
  family?: string;
  expectedFamily?: string;
  intentOk: boolean;
  missingDims: Dim[];
  missingTags: string[];
  flags: string[];
  physical: string;
  arcane: string;
  C?: number;
  notes?: string;
}

export interface V3Report {
  actions: number;
  compile: CompilerReport;
  intent: {
    checks: number;
    failures: number;
    meanCoverage: number;
    tagCases: number;
    tagMatches: number;
    unexplainedTags: number;
    rows: IntentCheck[];
  };
  worlds: WorldMatrixResult;
  e2e: {
    cases: E2ECase[];
    byBodyWorld: Array<{
      bodyId: string;
      worldId: string;
      blockedOntology: number;
      blockedBody: number;
      narrative: number;
      rolled: number;
    }>;
    freePhysicalBlocked: string[];
    freeArcaneNarrative: string[];
    freeArcaneRolled: string[];
    freeBodyBlocked: string[];
    outcomeCounts: Record<string, number>;
    C: { mean: number; min: number; max: number };
    monotonicChecked: number;
    monotonicPassed: number;
    monotonicFailures: string[];
    determinismChecked: number;
    determinismPassed: number;
    difficulty: Array<{ D: number; rolled: number; meanP: number; outcomes: Record<string, number> }>;
  };
  coverage: {
    dimHard: Record<string, number>;
    dimAssist: Record<string, number>;
    dimAny: Record<string, number>;
    dimsNever: Dim[];
    hardDimsNever: Dim[];
    families: Record<string, number>;
    tagsOnly: number;
    noHard: number;
  };
  stability: { repeatCompile: boolean; stable: boolean | null; detail?: string };
  review: ReviewRow[];
  gates: V3Gate[];
  failures: string[];
  markdown: string;
}

export interface V3Options {
  client: ChatClient;
  model?: string;
  arms?: Array<"blind" | "aware">;
  worlds?: WorldRules[];
  seed?: string | number;
  /** 回放时再跑一遍编译并逐字段比较；录制时关掉，避免重复请求 */
  repeatCompile?: boolean;
}

function cloneBody(base: Body, mutate: (body: Body) => void): Body {
  const body = structuredClone(base) as Body;
  mutate(body);
  return body;
}

export function bodyVariants(base: Body = loadFixture("akha")): BodyVariant[] {
  const free = cloneBody(base, (body) => {
    body.statuses = [];
  });
  const bound = cloneBody(base, () => {});
  const blindfold = cloneBody(base, (body) => {
    body.statuses = ["blindfold"];
  });
  const unconscious = cloneBody(base, (body) => {
    body.statuses = ["unconscious"];
    body.consciousness = 0;
  });
  const oneHand = cloneBody(base, (body) => {
    body.statuses = [];
    body.parts.leftHand.exists = false;
    body.parts.leftHand.integrity = 0;
    body.parts.leftHand.function = 0;
    body.parts.leftHand.visibleStates = ["missing"];
  });

  return [
    { id: "free", label: "自由（无束缚）", body: free },
    { id: "bound", label: "反绑 + 铁链", body: bound },
    { id: "blindfold", label: "蒙眼", body: blindfold },
    { id: "one_hand", label: "缺左手", body: oneHand },
    { id: "unconscious", label: "失去意识", body: unconscious },
  ];
}

function demandOf(row: CompilerRow) {
  return {
    label: row.description,
    dims: row.dims,
    assist: row.assist,
    ontologyTags: row.ontologyTags,
    durationTicks: row.durationTicks ?? 1,
    noise: row.noise ?? 0,
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatWeights(weights: Partial<Record<Dim, number>>): string {
  return (
    Object.entries(weights)
      .filter(([, value]) => (value ?? 0) > 0)
      .map(([key, value]) => `${key}:${value?.toFixed(2)}`)
      .join(" ") || "-"
  );
}

function countKeys(rows: CompilerRow[], field: "dims" | "assist"): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const [dim, value] of Object.entries(row[field]) as Array<[Dim, number]>) {
      if (value > 0) counts[dim] = (counts[dim] ?? 0) + 1;
    }
  }
  return counts;
}

function renderGateTable(gates: V3Gate[]): string[] {
  const lines = ["| 门槛 | 目标 | 实际 | 判定 |", "|---|---|---|---|"];
  for (const gate of gates) {
    lines.push(`| ${gate.label} | ${gate.target} | ${gate.actual} | ${gate.pass ? "通过" : "失败"} |`);
  }
  return lines;
}

function renderCompileTable(arms: CompilerArmSummary[]): string[] {
  const lines = [
    "| 臂 | 合法 | 合法率 | 带本体标签 | 跨世界差异 | family 命中 | 平均 confidence | 平均硬需求 |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const arm of arms) {
    lines.push(
      `| ${arm.arm} | ${arm.valid}/${arm.calls} | ${pct(arm.validRate)} | ${arm.ontologyTagged} | ` +
        `${arm.worldDiff} | ${arm.familyMatches}/${arm.familyCases} | ` +
        `${arm.meanConfidence.toFixed(2)} | ${arm.meanDemandSum.toFixed(2)} |`,
    );
  }
  return lines;
}

function renderMarkdown(report: Omit<V3Report, "markdown">): string {
  const lines: string[] = [];
  lines.push("# V3 完整验证");
  lines.push("");
  lines.push(
    `动作 ${report.actions} 条；编译 ${report.compile.arms.reduce((sum, arm) => sum + arm.calls, 0)} 次；` +
      `端到端 ${report.e2e.cases.length} 例（5 种身体 × 世界规则 × 动作）。`,
  );
  lines.push("");

  const passed = report.gates.filter((gate) => gate.pass).length;
  lines.push(
    `**自动化门槛：${passed}/${report.gates.length} 通过。**` +
      ` 人工抽检：${report.review.length} 行已生成，待确认。`,
  );
  lines.push("");

  lines.push("## 1. 门槛");
  lines.push("");
  lines.push(...renderGateTable(report.gates));
  lines.push("");

  lines.push("## 2. 编译");
  lines.push("");
  lines.push(...renderCompileTable(report.compile.arms));
  lines.push("");
  lines.push(
    `需求漂移（aware − blind）：可比 ${report.compile.drift.compared}；` +
      `meanΔ ${report.compile.drift.meanDelta.toFixed(2)}；` +
      `aware 更低 ${report.compile.drift.awareLower}/${report.compile.drift.compared}。`,
  );
  lines.push("");

  lines.push("## 3. 语义保真（IntentVerifier）");
  lines.push("");
  lines.push("| 指标 | 值 |");
  lines.push("|---|---|");
  lines.push(`| 检查动作 | ${report.intent.checks} |`);
  lines.push(`| 通道漏项 | ${report.intent.failures} |`);
  lines.push(`| 平均通道覆盖 | ${pct(report.intent.meanCoverage)} |`);
  lines.push(`| 本体标签应中 | ${report.intent.tagMatches}/${report.intent.tagCases} |`);
  lines.push(`| 多出的本体标签 | ${report.intent.unexplainedTags} |`);
  lines.push("");
  if (report.intent.failures > 0) {
    lines.push("漏项：");
    for (const check of report.intent.rows.filter((item) => !item.ok)) {
      lines.push(
        `- ${check.actionId ?? "?"} ${check.text}：缺 ${check.missingDims.join(", ") || "-"} ` +
          `缺标签 ${check.missingTags.join(", ") || "-"}`,
      );
    }
    lines.push("");
  }

  lines.push("## 4. 世界规则");
  lines.push("");
  lines.push(
    `标签子集 × 世界：${report.worlds.passed}/${report.worlds.total} 通过；` +
      `单调性 ${report.worlds.monotonicPassed}/${report.worlds.monotonicChecked}；` +
      `未注册标签被默认世界拒绝：${report.worlds.unknownDenied ? "是" : "否"}；` +
      `自定义世界可放行 magic：${report.worlds.customAllowed ? "是" : "否"}。`,
  );
  lines.push("");

  lines.push("## 5. 端到端");
  lines.push("");
  lines.push("| 身体 | 世界 | 本体拒绝 | 身体拒绝 | narrative | 掷骰 |");
  lines.push("|---|---|---|---|---|---|");
  for (const item of report.e2e.byBodyWorld) {
    lines.push(
      `| ${item.bodyId} | ${item.worldId} | ${item.blockedOntology} | ${item.blockedBody} | ` +
        `${item.narrative} | ${item.rolled} |`,
    );
  }
  lines.push("");
  lines.push(
    `自由身体 · 物理世界：本体拒绝 ${report.e2e.freePhysicalBlocked.length} 条（` +
      `${report.e2e.freePhysicalBlocked.join(", ") || "-"}）；` +
      `秘法世界 narrative ${report.e2e.freeArcaneNarrative.length} 条（` +
      `${report.e2e.freeArcaneNarrative.join(", ") || "-"}），掷骰 ${report.e2e.freeArcaneRolled.length} 条。`,
  );
  lines.push("");
  lines.push(
    `自由身体被身体拒绝：${report.e2e.freeBodyBlocked.length} 条；` +
      `约束单调性 ${report.e2e.monotonicPassed}/${report.e2e.monotonicChecked}；` +
      `确定性 ${report.e2e.determinismPassed}/${report.e2e.determinismChecked}。`,
  );
  lines.push("");
  lines.push(
    `自由身体 · 物理世界 C：平均 ${report.e2e.C.mean.toFixed(1)}，` +
      `最低 ${report.e2e.C.min.toFixed(1)}，最高 ${report.e2e.C.max.toFixed(1)}；` +
      `结果分布 ${Object.entries(report.e2e.outcomeCounts)
        .map(([key, value]) => `${key}:${value}`)
        .join("，")}。`,
  );
  lines.push("");

  lines.push("## 6. 覆盖");
  lines.push("");
  lines.push("| 维度 | 硬需求 | 辅助 | 任一 |");
  lines.push("|---|---|---|---|");
  for (const dim of DIMS) {
    lines.push(
      `| ${dim} | ${report.coverage.dimHard[dim] ?? 0} | ${report.coverage.dimAssist[dim] ?? 0} | ` +
        `${report.coverage.dimAny[dim] ?? 0} |`,
    );
  }
  lines.push("");
  lines.push(
    `硬需求未覆盖：${report.coverage.hardDimsNever.join(", ") || "无"}；` +
      `任一未覆盖：${report.coverage.dimsNever.join(", ") || "无"}；` +
      `无硬需求动作：${report.coverage.noHard}（其中纯本体 ${report.coverage.tagsOnly}）。`,
  );
  lines.push("");
  lines.push(
    `family 分布：${Object.entries(report.coverage.families)
      .map(([key, value]) => `${key}:${value}`)
      .join("，")}。`,
  );
  lines.push("");

  lines.push("## 7. 稳定性");
  lines.push("");
  lines.push("| 项 | 结果 |");
  lines.push("|---|---|");
  lines.push(
    `| 重复编译 | ${
      report.stability.stable === null
        ? "未检查（录制模式）"
        : report.stability.stable
          ? "逐字段一致"
          : `不一致：${report.stability.detail ?? ""}`
    } |`,
  );
  lines.push(`| 端到端确定性 | ${report.e2e.determinismPassed}/${report.e2e.determinismChecked} |`);
  lines.push("");
  lines.push("难度敏感性（自由身体 · 物理世界）：");
  lines.push("");
  lines.push("| D | 掷骰 | 平均 p | 结果分布 |");
  lines.push("|---|---|---|---|");
  for (const item of report.e2e.difficulty) {
    lines.push(
      `| ${item.D} | ${item.rolled} | ${item.meanP.toFixed(2)} | ` +
        `${Object.entries(item.outcomes)
          .map(([key, value]) => `${key}:${value}`)
          .join("，")} |`,
    );
  }
  lines.push("");

  lines.push("## 8. 人工抽检");
  lines.push("");
  lines.push(
    `100 行抽检包：reports/v3-review.md（同内容 CSV：reports/v3-review.csv）。` +
      `自动预检已标出 ${report.review.filter((row) => row.flags.length > 0).length} 行有风险标记。`,
  );
  lines.push("");

  lines.push("## 9. 失败项");
  lines.push("");
  if (report.failures.length === 0) lines.push("- 无");
  else for (const failure of report.failures) lines.push(`- ${failure}`);
  lines.push("");
  return lines.join("\n");
}

function renderReview(report: Omit<V3Report, "markdown">): { markdown: string; csv: string } {
  const lines: string[] = [];
  lines.push("# V3 人工抽检包");
  lines.push("");
  lines.push(
    "100 条动作，按风险标记数排序。请逐行判断：dims/assist 是否覆盖了动作文本，" +
      "本体标签是否合理，是否存在明显漏项或过度要求。",
  );
  lines.push("");
  lines.push("判定列建议：`✅` 合理；`⚠️` 可接受但想改；`❌` 明确错误。");
  lines.push("");
  lines.push(
    "| # | id | 动作 | 硬需求 | 辅助 | 本体 | family | 自动预检 | 人工 |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|");
  report.review.forEach((row, index) => {
    lines.push(
      `| ${index + 1} | ${row.actionId} | ${row.description} | ${formatWeights(row.dims)} | ` +
        `${formatWeights(row.assist)} | ${row.ontologyTags.join(",") || "-"} | ${row.family ?? "-"} | ` +
        `${row.flags.join(" / ") || "ok"} |  |`,
    );
  });
  lines.push("");

  const csv = [
    [
      "index",
      "id",
      "description",
      "dims",
      "assist",
      "ontologyTags",
      "family",
      "expectedFamily",
      "C",
      "physical",
      "arcane",
      "flags",
      "review",
    ].join(","),
    ...report.review.map((row, index) =>
      [
        index + 1,
        row.actionId,
        row.description,
        formatWeights(row.dims),
        formatWeights(row.assist),
        row.ontologyTags.join("|"),
        row.family ?? "",
        row.expectedFamily ?? "",
        row.C?.toFixed(1) ?? "",
        row.physical,
        row.arcane,
        row.flags.join("|"),
        "",
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(","),
    ),
  ].join("\n");

  return { markdown: lines.join("\n"), csv };
}

export async function runV3Validation(options: V3Options): Promise<V3Report> {
  const worlds = options.worlds ?? DEFAULT_WORLDS;
  const arms = options.arms ?? ["blind", "aware"];
  const compile = await runCompilerValidation({
    client: options.client,
    ...(options.model === undefined ? {} : { model: options.model }),
    arms,
  });

  let stable: boolean | null = null;
  let stableDetail: string | undefined;
  if (options.repeatCompile) {
    const again = await runCompilerValidation({
      client: options.client,
      ...(options.model === undefined ? {} : { model: options.model }),
      arms,
    });
    const left = canonicalJson({ arms: compile.arms, rows: compile.rows });
    const right = canonicalJson({ arms: again.arms, rows: again.rows });
    stable = left === right;
    if (!stable) stableDetail = "第二次编译的 arms/rows 与第一次不同";
  }

  const blindRows = compile.rows.filter((row) => row.arm === "blind" && row.ok);
  const invalidRows = compile.rows.filter((row) => !row.ok);

  const intentRows = blindRows.map((row) =>
    verifyIntent(demandOf(row), row.description, row.actionId),
  );
  const intentFailures = intentRows.filter((row) => !row.ok);
  const tagCases = intentRows.filter((row) => row.expectedTags.length > 0);
  const tagMatches = tagCases.filter((row) => row.missingTags.length === 0);
  const unexplainedTags = intentRows.reduce(
    (sum, row) => sum + row.unexplainedTags.length,
    0,
  );

  const worldMatrix = runWorldMatrix(worlds);

  const variants = bodyVariants();
  const cases: E2ECase[] = [];
  for (const variant of variants) {
    for (const world of worlds) {
      for (const row of blindRows) {
        const result = resolveAction({
          body: variant.body,
          demand: demandOf(row),
          world,
          seed: options.seed ?? "v3",
          checkId: Number(row.actionId.replace(/^a/, "")) || 1,
        });
        cases.push({
          bodyId: variant.id,
          worldId: world.id,
          actionId: row.actionId,
          status: result.status,
          ...(result.reason === undefined ? {} : { reason: result.reason }),
          ...(result.C === undefined ? {} : { C: Number(result.C.toFixed(4)) }),
          ...(result.D === undefined ? {} : { D: result.D }),
          ...(result.p === undefined ? {} : { p: Number(result.p.toFixed(6)) }),
          ...(result.u === undefined ? {} : { u: Number(result.u.toFixed(6)) }),
          ...(result.outcome === undefined ? {} : { outcome: result.outcome }),
          tags: result.tags,
        });
      }
    }
  }

  const byBodyWorld = variants.flatMap((variant) =>
    worlds.map((world) => {
      const subset = cases.filter(
        (item) => item.bodyId === variant.id && item.worldId === world.id,
      );
      return {
        bodyId: variant.id,
        worldId: world.id,
        blockedOntology: subset.filter((item) => item.status === "blocked_ontology").length,
        blockedBody: subset.filter((item) => item.status === "blocked_body").length,
        narrative: subset.filter((item) => item.status === "narrative").length,
        rolled: subset.filter((item) => item.status === "rolled").length,
      };
    }),
  );

  const freePhysical = cases.filter(
    (item) => item.bodyId === "free" && item.worldId === "physical",
  );
  const freeArcane = cases.filter(
    (item) => item.bodyId === "free" && item.worldId === "arcane",
  );
  const freePhysicalBlocked = freePhysical
    .filter((item) => item.status === "blocked_ontology")
    .map((item) => item.actionId);
  const freeArcaneNarrative = freeArcane
    .filter((item) => item.status === "narrative")
    .map((item) => item.actionId);
  const freeArcaneRolled = freeArcane
    .filter((item) => item.status === "rolled")
    .map((item) => item.actionId);
  const freeBodyBlocked = freePhysical
    .filter((item) => item.status === "blocked_body")
    .map((item) => item.actionId);

  const rolledCases = freePhysical.filter((item) => item.status === "rolled");
  const CValues = rolledCases
    .map((item) => item.C)
    .filter((value): value is number => value !== undefined);
  const outcomeCounts: Record<string, number> = {};
  for (const item of rolledCases) {
    const outcome = item.outcome ?? "unknown";
    outcomeCounts[outcome] = (outcomeCounts[outcome] ?? 0) + 1;
  }

  // 身体单调性：更受约束的身体能做的，自由身体也能做；C 不应更高。
  const monotonicFailures: string[] = [];
  let monotonicChecked = 0;
  for (const world of worlds) {
    for (const row of blindRows) {
      const free = cases.find(
        (item) => item.bodyId === "free" && item.worldId === world.id && item.actionId === row.actionId,
      );
      if (!free) continue;
      for (const bodyId of ["bound", "blindfold", "one_hand", "unconscious"]) {
        const constrained = cases.find(
          (item) => item.bodyId === bodyId && item.worldId === world.id && item.actionId === row.actionId,
        );
        if (!constrained) continue;
        monotonicChecked++;
        const constrainedFeasible = constrained.status === "rolled" || constrained.status === "narrative";
        const freeFeasible = free.status === "rolled" || free.status === "narrative";
        if (constrainedFeasible && !freeFeasible) {
          monotonicFailures.push(`${world.id}/${row.actionId}: ${bodyId} 可行但 free 不可行`);
        }
        if (
          constrained.status === "rolled" &&
          free.status === "rolled" &&
          constrained.C !== undefined &&
          free.C !== undefined &&
          constrained.C > free.C + 0.01
        ) {
          monotonicFailures.push(
            `${world.id}/${row.actionId}: ${bodyId} C=${constrained.C} > free C=${free.C}`,
          );
        }
      }
    }
  }

  // 确定性：同一输入、同一 seed/checkId，两次解析必须一致。
  let determinismChecked = 0;
  let determinismPassed = 0;
  for (const row of blindRows) {
    determinismChecked++;
    const a = resolveAction({
      body: variants[0].body,
      demand: demandOf(row),
      world: worlds[0],
      seed: options.seed ?? "v3",
      checkId: 1,
    });
    const b = resolveAction({
      body: variants[0].body,
      demand: demandOf(row),
      world: worlds[0],
      seed: options.seed ?? "v3",
      checkId: 1,
    });
    if (canonicalJson(a) === canonicalJson(b)) determinismPassed++;
  }

  // 难度敏感性：只改变 D，不改可行性/C。
  const difficulty = [35, 50, 65].map((D) => {
    const outcomes: Record<string, number> = {};
    const probs: number[] = [];
    let rolled = 0;
    for (const row of blindRows) {
      const result = resolveAction({
        body: variants[0].body,
        demand: demandOf(row),
        world: worlds[0],
        difficulty: D,
        seed: options.seed ?? "v3",
        checkId: Number(row.actionId.replace(/^a/, "")) || 1,
      });
      if (result.status !== "rolled" || result.p === undefined) continue;
      rolled++;
      probs.push(result.p);
      const outcome = result.outcome ?? "unknown";
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }
    return { D, rolled, meanP: mean(probs), outcomes };
  });

  const dimHard = countKeys(blindRows, "dims");
  const dimAssist = countKeys(blindRows, "assist");
  const dimAny: Record<string, number> = {};
  for (const dim of DIMS) {
    dimAny[dim] = (dimHard[dim] ?? 0) + (dimAssist[dim] ?? 0);
  }
  const dimsNever = DIMS.filter((dim) => (dimAny[dim] ?? 0) === 0);
  const hardDimsNever = DIMS.filter((dim) => (dimHard[dim] ?? 0) === 0);
  const families: Record<string, number> = {};
  for (const row of blindRows) {
    const family = row.family ?? "(none)";
    families[family] = (families[family] ?? 0) + 1;
  }
  const tagsOnly = blindRows.filter(
    (row) => Object.values(row.dims).every((value) => value <= 0) && row.ontologyTags.length > 0,
  ).length;
  const noHard = blindRows.filter((row) =>
    Object.values(row.dims).every((value) => value <= 0),
  ).length;

  const review: ReviewRow[] = blindRows
    .map((row) => {
      const intent = intentRows.find((item) => item.actionId === row.actionId);
      const physical = freePhysical.find((item) => item.actionId === row.actionId);
      const arcane = freeArcane.find((item) => item.actionId === row.actionId);
      const flags: string[] = [];
      if (Object.values(row.dims).every((value) => value <= 0)) flags.push("no-hard");
      if (row.ontologyTags.length > 0) flags.push("ontology");
      if (Object.values(row.assist).every((value) => value <= 0)) flags.push("no-assist");
      if ((row.dims.force ?? 0) >= 0.7) flags.push("high-force");
      if (row.C !== undefined && row.C < 60) flags.push("low-C");
      if (intent && !intent.ok) flags.push("intent-miss");
      if (intent && intent.unexplainedTags.length > 0) flags.push("unexplained-tag");
      if (row.expectedFamily !== undefined && !row.familyMatch) flags.push("family-miss");
      if (physical?.status === "blocked_body") flags.push("free-body-blocked");
      if (Object.values(row.dims).filter((value) => value > 0).length >= 4) flags.push("many-hard");
      if (Object.values(row.assist).filter((value) => value > 0).length >= 5) flags.push("assist-heavy");

      return {
        actionId: row.actionId,
        description: row.description,
        dims: row.dims,
        assist: row.assist,
        ontologyTags: row.ontologyTags,
        ...(row.family === undefined ? {} : { family: row.family }),
        ...(row.expectedFamily === undefined ? {} : { expectedFamily: row.expectedFamily }),
        intentOk: intent?.ok ?? false,
        missingDims: intent?.missingDims ?? [],
        missingTags: intent?.missingTags ?? [],
        flags,
        physical: physical?.status ?? "missing",
        arcane: arcane?.status ?? "missing",
        ...(row.C === undefined ? {} : { C: row.C }),
        ...(row.notes === undefined ? {} : { notes: row.notes }),
      };
    })
    .sort((a, b) => b.flags.length - a.flags.length || a.actionId.localeCompare(b.actionId));

  const ontologyActionCount = blindRows.filter((row) => row.ontologyTags.length > 0).length;

  const gates: V3Gate[] = [
    {
      id: "schema-blind",
      label: "blind 合法率",
      target: "≥ 98%",
      actual: pct(compile.arms.find((arm) => arm.arm === "blind")?.validRate ?? 0),
      pass: (compile.arms.find((arm) => arm.arm === "blind")?.validRate ?? 0) >= 0.98,
    },
    ...(arms.includes("aware")
      ? [
          {
            id: "schema-aware",
            label: "aware 合法率",
            target: "≥ 98%",
            actual: pct(compile.arms.find((arm) => arm.arm === "aware")?.validRate ?? 0),
            pass: (compile.arms.find((arm) => arm.arm === "aware")?.validRate ?? 0) >= 0.98,
          },
        ]
      : []),
    {
      id: "schema-invalid",
      label: "非法/回退行",
      target: "0",
      actual: String(invalidRows.length),
      pass: invalidRows.length === 0,
    },
    {
      id: "intent",
      label: "语义漏项",
      target: "0",
      actual: String(intentFailures.length),
      pass: intentFailures.length === 0,
    },
    {
      id: "intent-tags",
      label: "本体标签应中",
      target: "100%",
      actual: tagCases.length === 0 ? "-" : `${tagMatches.length}/${tagCases.length}`,
      pass: tagCases.length > 0 && tagMatches.length === tagCases.length,
    },
    {
      id: "world-matrix",
      label: "世界矩阵",
      target: "全部通过",
      actual: `${worldMatrix.passed}/${worldMatrix.total}`,
      pass: worldMatrix.failures.length === 0,
    },
    {
      id: "world-monotonic",
      label: "世界单调性",
      target: "全部通过",
      actual: `${worldMatrix.monotonicPassed}/${worldMatrix.monotonicChecked}`,
      pass: worldMatrix.monotonicFailures.length === 0,
    },
    {
      id: "world-unknown",
      label: "未注册标签",
      target: "默认世界拒绝 / 自定义可放行",
      actual: `${worldMatrix.unknownDenied ? "拒绝" : "未拒绝"}/${worldMatrix.customAllowed ? "放行" : "未放行"}`,
      pass: worldMatrix.unknownDenied && worldMatrix.customAllowed,
    },
    {
      id: "e2e-physical",
      label: "物理世界本体拒绝",
      target: `= 带标签动作 ${ontologyActionCount}`,
      actual: String(freePhysicalBlocked.length),
      pass: freePhysicalBlocked.length === ontologyActionCount,
    },
    {
      id: "e2e-arcane",
      label: "秘法世界 narrative",
      target: `= 纯本体动作 ${tagsOnly}`,
      actual: String(freeArcaneNarrative.length),
      pass: freeArcaneNarrative.length === tagsOnly,
    },
    {
      id: "e2e-free",
      label: "自由身体无身体拒绝",
      target: "0",
      actual: String(freeBodyBlocked.length),
      pass: freeBodyBlocked.length === 0,
    },
    {
      id: "e2e-monotonic",
      label: "身体约束单调性",
      target: "全部通过",
      actual: `${monotonicPassed(monotonicChecked, monotonicFailures.length)}/${monotonicChecked}`,
      pass: monotonicFailures.length === 0,
    },
    {
      id: "determinism",
      label: "端到端确定性",
      target: "全部一致",
      actual: `${determinismPassed}/${determinismChecked}`,
      pass: determinismPassed === determinismChecked,
    },
    {
      id: "dim-coverage",
      label: "维度覆盖",
      target: "任一 ≥ 1，硬需求 ≥ 10",
      actual: `任一 ${DIMS.length - dimsNever.length}/${DIMS.length}；硬 ${DIMS.length - hardDimsNever.length}/${DIMS.length}`,
      pass: dimsNever.length === 0 && DIMS.length - hardDimsNever.length >= 10,
    },
    {
      id: "drift",
      label: "盲/可见漂移",
      target: "|meanΔ| ≤ 0.5",
      actual: compile.drift.meanDelta.toFixed(2),
      pass: Math.abs(compile.drift.meanDelta) <= 0.5,
    },
    {
      id: "compile-stable",
      label: "重复编译",
      target: "逐字段一致",
      actual: stable === null ? "未检查" : stable ? "一致" : "不一致",
      pass: stable === true,
    },
  ];

  const failures: string[] = [...compile.failures];
  for (const gate of gates) {
    if (!gate.pass) failures.push(`门槛 ${gate.label}：${gate.actual}（目标 ${gate.target}）`);
  }
  for (const check of intentFailures) {
    failures.push(
      `语义漏项 ${check.actionId ?? "?"}：缺 ${check.missingDims.join(", ") || "-"}；` +
        `缺标签 ${check.missingTags.join(", ") || "-"}`,
    );
  }
  for (const item of worldMatrix.failures.slice(0, 8)) {
    failures.push(`世界矩阵 ${item.worldId} [${item.tags.join("+") || "空"}] 期望 ${item.expected}`);
  }
  for (const item of monotonicFailures.slice(0, 8)) failures.push(`约束单调性 ${item}`);

  const withoutMarkdown: Omit<V3Report, "markdown"> = {
    actions: blindRows.length,
    compile,
    intent: {
      checks: intentRows.length,
      failures: intentFailures.length,
      meanCoverage: mean(intentRows.map((row) => row.coverage)),
      tagCases: tagCases.length,
      tagMatches: tagMatches.length,
      unexplainedTags,
      rows: intentRows,
    },
    worlds: worldMatrix,
    e2e: {
      cases,
      byBodyWorld,
      freePhysicalBlocked,
      freeArcaneNarrative,
      freeArcaneRolled,
      freeBodyBlocked,
      outcomeCounts,
      C: {
        mean: mean(CValues),
        min: CValues.length === 0 ? 0 : Math.min(...CValues),
        max: CValues.length === 0 ? 0 : Math.max(...CValues),
      },
      monotonicChecked,
      monotonicPassed: monotonicChecked - monotonicFailures.length,
      monotonicFailures,
      determinismChecked,
      determinismPassed,
      difficulty,
    },
    coverage: {
      dimHard,
      dimAssist,
      dimAny,
      dimsNever,
      hardDimsNever,
      families,
      tagsOnly,
      noHard,
    },
    stability: {
      repeatCompile: options.repeatCompile === true,
      stable,
      ...(stableDetail === undefined ? {} : { detail: stableDetail }),
    },
    review,
    gates,
    failures,
  };

  return { ...withoutMarkdown, markdown: renderMarkdown(withoutMarkdown) };
}

function monotonicPassed(checked: number, failed: number): number {
  return checked - failed;
}

export function writeV3Report(report: V3Report, markdownPath: string): void {
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, report.markdown, "utf8");
  writeFileSync(
    markdownPath.replace(/\.md$/i, ".json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );

  const review = renderReview(report);
  const reviewMd = reviewPathFor(markdownPath, "md");
  const reviewCsv = reviewPathFor(markdownPath, "csv");
  writeFileSync(reviewMd, review.markdown, "utf8");
  writeFileSync(reviewCsv, `${review.csv}\n`, "utf8");
}

/** 默认 v3-validation.md → v3-review.md；自定义 --out 时用 <base>-review.md，避免覆盖自身。 */
function reviewPathFor(markdownPath: string, ext: "md" | "csv"): string {
  const defaultMatch = markdownPath.match(/v3-validation\.md$/i);
  if (defaultMatch) return markdownPath.replace(/v3-validation\.md$/i, `v3-review.${ext}`);
  return markdownPath.replace(/\.md$/i, `-review.${ext}`);
}
