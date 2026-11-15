/**
 * Parity harness：同一组身体/动作/seed 下，对比 v0（加权平均 + 硬规则）与
 * v2（约束 + 瓶颈分）。目的不是证明 v2 更好，而是：
 * - 硬约束是否等价（CM-2）；
 * - 12 个参考 profile 是否能在基线上复现 v0 的 C（CM-3）；
 * - 换身体/换状态后差异出在哪里。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { evaluateCheck } from "./check.ts";
import { loadFixture } from "./fixture.ts";
import type { CheckEnv, Verb } from "./actions.ts";
import type { Body, PartId } from "./body.ts";
import { evaluateV2 } from "./v2/check.ts";

export interface ParityCase {
  verb: Verb;
  env: CheckEnv;
}

export interface ParityVariant {
  id: string;
  label: string;
  body: Body;
}

export interface ParityRow {
  variant: string;
  variantLabel: string;
  verb: Verb;
  v0: {
    feasible: boolean;
    reason?: string;
    C?: number;
    D?: number;
    p?: number;
    outcome?: string;
  };
  v2: {
    feasible: boolean;
    reason?: string;
    C?: number;
    D?: number;
    p?: number;
    outcome?: string;
    bottleneck?: string | null;
  };
  feasibleSame: boolean;
  outcomeSame: boolean | null;
  cDiff: number | null;
  pDiff: number | null;
  flags: string[];
}

export interface VariantSummary {
  variant: string;
  label: string;
  total: number;
  feasibleAgreement: number;
  bothFeasible: number;
  outcomeAgreement: number;
  meanCDiff: number;
  maxCDiff: number;
}

export interface ParityReport {
  seed: string;
  rows: ParityRow[];
  byVariant: VariantSummary[];
  baseline: VariantSummary;
  overall: VariantSummary;
  expectedDivergences: string[];
  failures: string[];
  markdown: string;
}

function clone(body: Body): Body {
  return structuredClone(body);
}

export function buildVariants(): ParityVariant[] {
  const base = loadFixture("akha") as Body;

  const free = clone(base);
  free.statuses = [];

  const healthy = clone(base);
  for (const id of Object.keys(healthy.parts) as PartId[]) {
    const part = healthy.parts[id];
    part.exists = true;
    part.integrity = 100;
    part.function = 100;
    part.pain = 0;
    part.bleeding = 0;
    part.visibleStates = ["clean"];
  }
  healthy.fatigue = 0;
  healthy.hunger = 0;
  healthy.thirst = 0;
  healthy.fever = 0;
  healthy.intoxication = 0;
  healthy.consciousness = 100;
  healthy.statuses = [];

  const blindfold = clone(free);
  blindfold.statuses = ["blindfold"];

  const missingHand = clone(free);
  missingHand.parts.leftHand.exists = false;
  missingHand.parts.leftHand.function = 0;

  const unconscious = clone(base);
  unconscious.statuses = ["unconscious"];

  const tired = clone(free);
  tired.fatigue = 90;

  return [
    { id: "akha", label: "阿岬（绑手+伤+烧）", body: base },
    { id: "free", label: "松绑", body: free },
    { id: "healthy", label: "健康", body: healthy },
    { id: "blindfold", label: "蒙眼", body: blindfold },
    { id: "missingHand", label: "缺左手", body: missingHand },
    { id: "unconscious", label: "失去意识", body: unconscious },
    { id: "tired", label: "极度疲劳", body: tired },
  ];
}

export const PARITY_CASES: ParityCase[] = [
  { verb: "move", env: { distanceM: 2 } },
  { verb: "look", env: { light: "dim" } },
  { verb: "listen", env: { distanceM: 4 } },
  { verb: "speak", env: { attitude: "hostile", distanceM: 2 } },
  { verb: "whisper", env: { distanceM: 0.5 } },
  { verb: "take", env: {} },
  { verb: "give", env: {} },
  { verb: "use", env: {} },
  { verb: "hide", env: { watched: true } },
  { verb: "tend", env: {} },
  { verb: "rest", env: {} },
  { verb: "wait", env: {} },
];

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function summarize(rows: ParityRow[], variant: string, label: string): VariantSummary {
  const total = rows.length;
  const feasibleSame = rows.filter((row) => row.feasibleSame).length;
  const both = rows.filter((row) => row.outcomeSame !== null);
  const outcomeSame = both.filter((row) => row.outcomeSame === true).length;
  const cDiffs = rows
    .map((row) => row.cDiff)
    .filter((value): value is number => value !== null);

  return {
    variant,
    label,
    total,
    feasibleAgreement: total === 0 ? 1 : feasibleSame / total,
    bothFeasible: both.length,
    outcomeAgreement: both.length === 0 ? 1 : outcomeSame / both.length,
    meanCDiff: mean(cDiffs),
    maxCDiff: cDiffs.length === 0 ? 0 : Math.max(...cDiffs),
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function renderMarkdown(report: Omit<ParityReport, "markdown">): string {
  const lines: string[] = [];
  lines.push(`# v0 vs v2 parity · seed=${report.seed}`);
  lines.push("");
  lines.push("## 总览");
  lines.push("");
  lines.push("| 指标 | 值 |");
  lines.push("|---|---|");
  lines.push(`| 用例数 | ${report.overall.total} |`);
  lines.push(`| 可行性一致 | ${pct(report.overall.feasibleAgreement)} |`);
  lines.push(`| 双方可尝试 | ${report.overall.bothFeasible} |`);
  lines.push(`| 结果一致（双方可尝试中） | ${pct(report.overall.outcomeAgreement)} |`);
  lines.push(`| C 平均绝对差 | ${report.overall.meanCDiff.toFixed(2)} |`);
  lines.push(`| C 最大差 | ${report.overall.maxCDiff.toFixed(2)} |`);
  lines.push("");
  lines.push(
    `基线（阿岬/松绑/健康）：可行性 ${pct(report.baseline.feasibleAgreement)}，` +
      `C 平均差 ${report.baseline.meanCDiff.toFixed(2)}，结果一致 ${pct(report.baseline.outcomeAgreement)}`,
  );
  lines.push("");

  lines.push("## 分身体");
  lines.push("");
  lines.push("| 身体 | 可行性一致 | 双方可尝试 | 结果一致 | C 平均差 | C 最大差 |");
  lines.push("|---|---|---|---|---|---|");
  for (const variant of report.byVariant) {
    lines.push(
      `| ${variant.label} | ${pct(variant.feasibleAgreement)} | ${variant.bothFeasible} | ` +
        `${pct(variant.outcomeAgreement)} | ${variant.meanCDiff.toFixed(2)} | ${variant.maxCDiff.toFixed(2)} |`,
    );
  }
  lines.push("");

  lines.push("## 明细");
  lines.push("");
  lines.push("| 身体 | 动作 | v0 可行 | v0 C | v0 结果 | v2 可行 | v2 C | v2 结果 | 瓶颈 | 标记 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const row of report.rows) {
    const flags = row.flags.length > 0 ? row.flags.join(",") : "";
    lines.push(
      `| ${row.variantLabel} | ${row.verb} | ${row.v0.feasible ? "是" : "否"} | ` +
        `${row.v0.C?.toFixed(1) ?? "-"} | ${row.v0.outcome ?? "-"} | ` +
        `${row.v2.feasible ? "是" : "否"} | ${row.v2.C?.toFixed(1) ?? "-"} | ` +
        `${row.v2.outcome ?? "-"} | ${row.v2.bottleneck ?? "-"} | ${flags} |`,
    );
  }
  lines.push("");

  lines.push("## 失败项");
  lines.push("");
  if (report.failures.length === 0) lines.push("- 无");
  else for (const failure of report.failures) lines.push(`- ${failure}`);
  lines.push("");

  lines.push("## 预期差异");
  lines.push("");
  if (report.expectedDivergences.length === 0) lines.push("- 无");
  else for (const item of report.expectedDivergences) lines.push(`- ${item}`);
  lines.push("");
  return lines.join("\n");
}

export function runParity(seed = "parity"): ParityReport {
  const variants = buildVariants();
  const rows: ParityRow[] = [];
  let checkId = 0;

  for (const variant of variants) {
    for (const testCase of PARITY_CASES) {
      checkId++;
      const v0 = evaluateCheck({
        body: variant.body,
        verb: testCase.verb,
        env: testCase.env,
        seed,
        checkId,
      });
      const v2 = evaluateV2({
        body: variant.body,
        verb: testCase.verb,
        env: testCase.env,
        difficulty: v0.feasible ? v0.difficulty : undefined,
        seed,
        checkId,
      });

      const bothFeasible = v0.feasible && v2.feasible;
      const bothRolled =
        bothFeasible && v0.outcome !== undefined && v2.outcome !== undefined;
      const cDiff = bothRolled
        ? Math.abs((v0.capability ?? 0) - (v2.C ?? 0))
        : null;
      const pDiff = bothRolled
        ? Math.abs((v0.probability ?? 0) - (v2.p ?? 0))
        : null;
      const outcomeSame = bothRolled ? v0.outcome === v2.outcome : null;

      const flags: string[] = [];
      if (v0.feasible !== v2.feasible) flags.push("可行性不一致");
      if (outcomeSame === false) flags.push("结果不一致");
      if (cDiff !== null && cDiff > 10) flags.push("C差>10");

      rows.push({
        variant: variant.id,
        variantLabel: variant.label,
        verb: testCase.verb,
        v0: {
          feasible: v0.feasible,
          reason: v0.reason,
          C: v0.outcome === undefined ? undefined : v0.capability,
          D: v0.difficulty,
          p: v0.probability,
          outcome: v0.outcome,
        },
        v2: {
          feasible: v2.feasible,
          reason: v2.reason,
          C: v2.outcome === undefined ? undefined : v2.C,
          D: v2.D,
          p: v2.p,
          outcome: v2.outcome,
          bottleneck: v2.bottleneck,
        },
        feasibleSame: v0.feasible === v2.feasible,
        outcomeSame,
        cDiff,
        pDiff,
        flags,
      });
    }
  }

  const byVariant = variants.map((variant) =>
    summarize(
      rows.filter((row) => row.variant === variant.id),
      variant.id,
      variant.label,
    ),
  );
  const overall = summarize(rows, "all", "全部");

  const baselineIds = ["akha", "free", "healthy"];
  const baseline = summarize(
    rows.filter((row) => baselineIds.includes(row.variant)),
    "baseline",
    "基线",
  );

  const expectedDivergences = byVariant
    .filter(
      (variant) => !baselineIds.includes(variant.variant) && variant.outcomeAgreement < 1,
    )
    .map(
      (variant) =>
        `${variant.label}: 结果一致 ${pct(variant.outcomeAgreement)}（瓶颈分与加权平均的预期差异）`,
    );

  const failures: string[] = [];
  if (overall.feasibleAgreement < 1) {
    failures.push(`可行性一致 ${pct(overall.feasibleAgreement)} < 100%`);
  }
  for (const row of rows) {
    if (!row.feasibleSame) {
      failures.push(
        `${row.variantLabel}/${row.verb}: v0=${row.v0.feasible ? "可行" : row.v0.reason}，v2=${row.v2.feasible ? "可行" : row.v2.reason}`,
      );
    }
  }
  if (baseline.meanCDiff > 2) {
    failures.push(`基线 C 平均差 ${baseline.meanCDiff.toFixed(2)} > 2`);
  }
  if (baseline.outcomeAgreement < 1) {
    failures.push(`基线结果一致 ${pct(baseline.outcomeAgreement)} < 100%`);
  }
  if (overall.outcomeAgreement < 0.8) {
    failures.push(`总体结果一致 ${pct(overall.outcomeAgreement)} < 80%`);
  }

  const reportWithoutMarkdown = {
    seed,
    rows,
    byVariant,
    baseline,
    overall,
    expectedDivergences,
    failures,
  };
  return { ...reportWithoutMarkdown, markdown: renderMarkdown(reportWithoutMarkdown) };
}

export function writeParityReport(report: ParityReport, markdownPath: string): void {
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, report.markdown, "utf8");
  writeFileSync(markdownPath.replace(/\.md$/i, ".json"), JSON.stringify(report, null, 2), "utf8");
}
