/**
 * V3 验证：100 条自由动作 × blind/aware 两臂。
 *
 * 编译器不判断"是否可能"：依赖非物理能力的动作会带 ontologyTags
 * （psychic / temporal / ...），由不同世界规则决定是否允许。
 * 本轮用"物理世界"与"秘法世界"两个 ontology 展示这个差异。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { ChatClient } from "../../../llm/types.ts";
import { capabilities, type Body } from "./body.ts";
import {
  CompilerSession,
  type CompilerAction,
  type CompilerCharacter,
  type CompilerOutput,
} from "./compiler.ts";
import { loadFixture } from "./fixture.ts";
import { applyConstraints, constraintsFromBody } from "./v2/constraints.ts";
import { scoreDemand, type Family } from "./v2/demand.ts";
import { deriveDimensions, DIMS, type Dim } from "./v2/dimensions.ts";

export interface WorldOntology {
  id: string;
  label: string;
  allowedTags: string[];
}

export const WORLDS: WorldOntology[] = [
  { id: "physical", label: "物理世界", allowedTags: [] },
  {
    id: "arcane",
    label: "秘法世界",
    allowedTags: ["psychic", "temporal", "divine", "metaphysical", "spirit"],
  },
];

export interface CompilerRow {
  actionId: string;
  description: string;
  expectedFamily?: Family;
  arm: "blind" | "aware";
  ok: boolean;
  error?: string;
  family?: Family;
  familyMatch: boolean;
  dims: Partial<Record<Dim, number>>;
  assist: Partial<Record<Dim, number>>;
  ontologyTags: string[];
  physicalOk: boolean;
  arcaneOk: boolean;
  worldDiff: boolean;
  durationTicks?: number;
  noise?: number;
  confidence?: number;
  notes?: string;
  demandSum: number;
  C?: number;
}

export interface CompilerArmSummary {
  arm: "blind" | "aware";
  calls: number;
  valid: number;
  validRate: number;
  ontologyTagged: number;
  worldDiff: number;
  familyCases: number;
  familyMatches: number;
  familyMatchRate: number;
  meanConfidence: number;
  meanDemandSum: number;
}

export interface CompilerDrift {
  compared: number;
  meanDelta: number;
  awareLower: number;
  perDimDelta: Partial<Record<Dim, number>>;
}

export interface CompilerReport {
  arms: CompilerArmSummary[];
  drift: CompilerDrift;
  rows: CompilerRow[];
  failures: string[];
  markdown: string;
}

export function loadCompilerActions(): CompilerAction[] {
  const path = new URL("../fixtures/compiler-actions.json", import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")) as CompilerAction[];
}

function characterFor(body: Body): CompilerCharacter {
  const caps = capabilities(body);
  return {
    capabilities: Object.fromEntries(
      Object.entries(caps).map(([key, value]) => [key, Number(value.toFixed(1))]),
    ),
    constraints: constraintsFromBody(body).map((constraint) => constraint.description),
  };
}

function sumDims(dims: Partial<Record<Dim, number>>): number {
  return Object.values(dims).reduce((sum, value) => sum + value, 0);
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
      .map(([key, value]) => `${key}:${value?.toFixed(2)}`)
      .join(" ") || "-"
  );
}

function ontologyAllows(tags: string[], world: WorldOntology): boolean {
  return tags.every((tag) => world.allowedTags.includes(tag));
}

function renderMarkdown(report: Omit<CompilerReport, "markdown">, actionCount: number): string {
  const lines: string[] = [];
  lines.push("# V3 Action Compiler");
  lines.push("");
  lines.push(`动作数：${actionCount}；两臂共 ${actionCount * 2} 次编译。`);
  lines.push("");

  lines.push("## 分臂");
  lines.push("");
  lines.push(
    "| 臂 | 调用 | 合法 | 合法率 | 带本体标签 | 跨世界差异 | family 命中 | 平均 confidence | 平均硬需求 sum |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const arm of report.arms) {
    lines.push(
      `| ${arm.arm} | ${arm.calls} | ${arm.valid} | ${pct(arm.validRate)} | ` +
        `${arm.ontologyTagged} | ${arm.worldDiff} | ` +
        `${arm.familyMatches}/${arm.familyCases}（${pct(arm.familyMatchRate)}） | ` +
        `${arm.meanConfidence.toFixed(2)} | ${arm.meanDemandSum.toFixed(2)} |`,
    );
  }
  lines.push("");

  lines.push("## 需求漂移（aware − blind）");
  lines.push("");
  lines.push("| 指标 | 值 |");
  lines.push("|---|---|");
  lines.push(`| 可比动作 | ${report.drift.compared} |`);
  lines.push(`| 平均 Δsum | ${report.drift.meanDelta.toFixed(2)} |`);
  lines.push(`| aware 更低 | ${report.drift.awareLower}/${report.drift.compared} |`);
  lines.push("");
  const deltaDims = Object.entries(report.drift.perDimDelta)
    .filter(([, value]) => Math.abs(value ?? 0) > 0.05)
    .map(([key, value]) => `${key} ${(value ?? 0) >= 0 ? "+" : ""}${(value ?? 0).toFixed(2)}`);
  if (deltaDims.length > 0) lines.push(`维度 Δ：${deltaDims.join("，")}`);
  lines.push("");

  lines.push("## 明细");
  lines.push("");
  lines.push(
    "| 动作 | family | dims | ontologyTags | 物理世界 | 秘法世界 | C | 备注 |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const row of report.rows.filter((item) => item.arm === "blind")) {
    const aware = report.rows.find(
      (item) => item.arm === "aware" && item.actionId === row.actionId,
    );
    const tags = row.ontologyTags.length > 0 ? row.ontologyTags.join(",") : "-";
    const note = aware?.error ?? row.error ?? aware?.notes ?? row.notes ?? "";
    lines.push(
      `| ${row.actionId} ${row.description} | ${row.family ?? "-"} | ${formatWeights(row.dims)} | ` +
        `${tags} | ${row.physicalOk ? "允许" : "本体拒绝"} | ${row.arcaneOk ? "允许" : "本体拒绝"} | ` +
        `${row.C?.toFixed(1) ?? "-"} | ${note} |`,
    );
  }
  lines.push("");

  lines.push("## 失败项");
  lines.push("");
  if (report.failures.length === 0) lines.push("- 无");
  else for (const failure of report.failures) lines.push(`- ${failure}`);
  lines.push("");
  return lines.join("\n");
}

export interface CompilerRunOptions {
  client: ChatClient;
  model?: string;
  arms?: Array<"blind" | "aware">;
}

export async function runCompilerValidation(
  options: CompilerRunOptions,
): Promise<CompilerReport> {
  const actions = loadCompilerActions();
  const arms = options.arms ?? ["blind", "aware"];
  const session = new CompilerSession(options.client, { model: options.model });

  const freeBody = loadFixture("akha") as Body;
  freeBody.statuses = [];
  const character = characterFor(freeBody);
  const dims = applyConstraints(deriveDimensions(freeBody), constraintsFromBody(freeBody)).dims;

  const rows: CompilerRow[] = [];

  for (const action of actions) {
    for (const arm of arms) {
      const result = await session.compile({
        ...action,
        arm,
        ...(arm === "aware" ? { character } : {}),
      });

      let C: number | undefined;
      let demandSum = 0;
      let dimsValue: Partial<Record<Dim, number>> = {};
      let assistValue: Partial<Record<Dim, number>> = {};
      let ontologyTags: string[] = [];
      if (result.ok && result.output) {
        const output: CompilerOutput = result.output;
        dimsValue = output.dims;
        assistValue = output.assist ?? {};
        ontologyTags = output.ontologyTags ?? [];
        demandSum = sumDims(output.dims);
        C = demandSum > 0 ? scoreDemand(dims, output).C : undefined;
      }

      const expectedFamilies =
        action.expectedFamilies ?? (action.expectedFamily ? [action.expectedFamily] : []);
      const derivedFamily = result.output?.family;
      const familyMatch =
        result.ok && derivedFamily !== undefined
          ? expectedFamilies.includes(derivedFamily)
          : false;
      const physicalOk = ontologyAllows(ontologyTags, WORLDS[0]);
      const arcaneOk = ontologyAllows(ontologyTags, WORLDS[1]);

      rows.push({
        actionId: action.id,
        description: action.description,
        expectedFamily: action.expectedFamily ?? action.expectedFamilies?.[0],
        arm,
        ok: result.ok,
        ...(result.error === undefined ? {} : { error: result.error }),
        ...(derivedFamily === undefined ? {} : { family: derivedFamily }),
        familyMatch,
        dims: dimsValue,
        assist: assistValue,
        ontologyTags,
        physicalOk,
        arcaneOk,
        worldDiff: physicalOk !== arcaneOk,
        ...(result.output?.durationTicks === undefined
          ? {}
          : { durationTicks: result.output.durationTicks }),
        ...(result.output?.noise === undefined ? {} : { noise: result.output.noise }),
        ...(result.output?.confidence === undefined
          ? {}
          : { confidence: result.output.confidence }),
        ...(result.output?.notes === undefined ? {} : { notes: result.output.notes }),
        demandSum,
        ...(C === undefined ? {} : { C }),
      });
    }
  }

  const summaries: CompilerArmSummary[] = arms.map((arm) => {
    const armRows = rows.filter((row) => row.arm === arm);
    const validRows = armRows.filter((row) => row.ok);
    const familyRows = validRows.filter((row) => row.family !== undefined);
    return {
      arm,
      calls: armRows.length,
      valid: validRows.length,
      validRate: armRows.length === 0 ? 0 : validRows.length / armRows.length,
      ontologyTagged: validRows.filter((row) => row.ontologyTags.length > 0).length,
      worldDiff: validRows.filter((row) => row.worldDiff).length,
      familyCases: familyRows.length,
      familyMatches: familyRows.filter((row) => row.familyMatch).length,
      familyMatchRate:
        familyRows.length === 0
          ? 0
          : familyRows.filter((row) => row.familyMatch).length / familyRows.length,
      meanConfidence: mean(
        validRows
          .map((row) => row.confidence)
          .filter((value): value is number => value !== undefined),
      ),
      meanDemandSum: mean(
        validRows.filter((row) => row.family !== undefined).map((row) => row.demandSum),
      ),
    };
  });

  const blindRows = rows.filter(
    (row) => row.arm === "blind" && row.ok && row.family !== undefined,
  );
  const awareRows = rows.filter(
    (row) => row.arm === "aware" && row.ok && row.family !== undefined,
  );
  const paired = blindRows
    .map((blind) => ({
      blind,
      aware: awareRows.find((row) => row.actionId === blind.actionId),
    }))
    .filter((pair): pair is { blind: CompilerRow; aware: CompilerRow } => pair.aware !== undefined);

  const perDimDelta: Partial<Record<Dim, number>> = {};
  for (const dim of DIMS) {
    const deltas = paired
      .map((pair) => (pair.aware.dims[dim] ?? 0) - (pair.blind.dims[dim] ?? 0))
      .filter((value) => value !== 0);
    if (deltas.length > 0) perDimDelta[dim] = mean(deltas);
  }

  const drift: CompilerDrift = {
    compared: paired.length,
    meanDelta: mean(paired.map((pair) => sumDims(pair.aware.dims) - sumDims(pair.blind.dims))),
    awareLower: paired.filter(
      (pair) => sumDims(pair.aware.dims) < sumDims(pair.blind.dims),
    ).length,
    perDimDelta,
  };

  const failures: string[] = [];
  for (const summary of summaries) {
    if (summary.validRate < 0.98) {
      failures.push(`${summary.arm} 合法率 ${pct(summary.validRate)} < 98%`);
    }
  }
  if (drift.compared > 0 && Math.abs(drift.meanDelta) > 0.5) {
    failures.push(`需求漂移 meanΔ=${drift.meanDelta.toFixed(2)}，超过 0.5`);
  }

  const withoutMarkdown = { arms: summaries, drift, rows, failures };
  return {
    ...withoutMarkdown,
    markdown: renderMarkdown(withoutMarkdown, actions.length),
  };
}

export function writeCompilerReport(report: CompilerReport, markdownPath: string): void {
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, report.markdown, "utf8");
  writeFileSync(
    markdownPath.replace(/\.md$/i, ".json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
}
