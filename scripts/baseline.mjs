/**
 * R0：基线对照门（B-1 修复）。
 *
 * 与旧的 `scripts/baseline.mjs`（先重写 tracked 基线、再宣称通过）不同：
 *
 *   1. 期望值放在 **`reports/baseline.expected.json`**，受版本控制。
 *      普通 `pnpm verify` / `pnpm check:baseline` 只读它，永远不写。
 *   2. 实际值每次从真实来源重新计算：
 *      - 测试数：运行与 `pnpm test:all` 相同的三个 suite，解析其**实际输出**；
 *      - B2/B3：读取 `node demos/world/src/cli.ts report` 生成的报告 JSON。
 *   3. 逐字段对照 + 门 id **集合相等**校验；任何缺门/多门/改名/数值变化
 *      → 非零退出，且不写 baseline.json/md。
 *   4. 只有显式 `node scripts/baseline.mjs --accept`（`pnpm baseline:accept`）
 *      才允许更新期望值，并在输出中列出变更。
 *
 * 不读取 `.env`，不打印 key，不调用真实 LLM/网络（B3 只回放 cassette）。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSuites } from "./lib/test-suites.mjs";
import { freshnessErrors } from "./lib/report-stamp.mjs";

const B2_PATH = "reports/world-validation.json";
const B3_PATH = "reports/world-b3-validation.json";
const B3_CASSETTE_DIR = "demos/world/fixtures/llm-b3";
const PROBE_CASSETTE_DIR = "demos/world/fixtures/llm";
const EXPECTED_PATH = "reports/baseline.expected.json";
const OUT_MD = "reports/baseline.md";
const OUT_JSON = "reports/baseline.json";
const EXPECTED_SCHEMA_VERSION = 2;
const SOURCE_KEYS = ["ambient", "actor", "special", "system"];
const TOP_KEYS = new Set(["schemaVersion", "seed", "days", "tests", "b2", "b3", "cassettes"]);
const TEST_KEYS = new Set(["embodied", "world", "kernel", "total"]);
const B2_KEYS = new Set(["events", "eventsBySource", "projectionHash", "fullHash", "expectedGateIds"]);
const B3_KEYS = new Set([
  "events",
  "eventsBySource",
  "replayHash",
  "replayIdentical",
  "tierChanges",
  "promotions",
  "demotions",
  "crowdIndividualizations",
  "crowdMerges",
  "directorAttempts",
  "directorProposals",
  "dialogueCalls",
  "llmSources",
  "cassetteMisses",
  "expectedGateIds",
]);
const CASSETTE_KEYS = new Set(["b3", "probe"]);

const TEST_FIELDS = ["embodied", "world", "kernel", "total"];
const B2_FIELDS = ["events", "eventsBySource", "projectionHash", "fullHash"];
const B3_FIELDS = [
  "events",
  "eventsBySource",
  "replayHash",
  "replayIdentical",
  "tierChanges",
  "promotions",
  "demotions",
  "crowdIndividualizations",
  "crowdMerges",
  "directorAttempts",
  "directorProposals",
  "dialogueCalls",
  "llmSources",
  "cassetteMisses",
];

function readJson(path) {
  if (!existsSync(path)) throw new Error(`缺少基线输入: ${path}（先运行 report / 检查路径）`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function countJson(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((name) => name.endsWith(".json")).length;
}

/** 稳定序列化（对象键排序），用于跨 JSON 键序的深比较。 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function valueErrors(label, actual, expected, fields) {
  const errors = [];
  for (const field of fields) {
    if (canonical(actual[field]) !== canonical(expected?.[field])) {
      errors.push(
        `${label}.${field}: 期望 ${JSON.stringify(expected?.[field])} 实际 ${JSON.stringify(actual[field])}`,
      );
    }
  }
  return errors;
}

/** 期望基线文件的 schema 校验：版本、必需字段、类型、未知字段。 */
function expectedSchemaErrors(expected) {
  const errors = [];
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const isCount = (value) => Number.isInteger(value) && value >= 0;
  const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;

  const checkObject = (label, value, allowedKeys, requiredKeys) => {
    if (!isObject(value)) {
      errors.push(`${label}: 必须是对象`);
      return false;
    }
    for (const key of Object.keys(value)) {
      if (!allowedKeys.has(key)) errors.push(`${label}: 未知字段 "${key}"`);
    }
    for (const key of requiredKeys) {
      if (!(key in value)) errors.push(`${label}: 缺少必需字段 "${key}"`);
    }
    return true;
  };

  const checkCounts = (label, value, keys) => {
    if (!isObject(value)) {
      errors.push(`${label}: 必须是对象`);
      return false;
    }
    for (const key of keys) {
      if (!isCount(value[key])) errors.push(`${label}.${key}: 必须是非负整数`);
    }
    return true;
  };

  const checkGateIds = (label, value) => {
    if (!Array.isArray(value) || value.length === 0) {
      errors.push(`${label}: expectedGateIds 必须是非空数组`);
      return;
    }
    value.forEach((id, index) => {
      if (!isNonEmptyString(id)) errors.push(`${label}.expectedGateIds[${index}]: 必须是非空字符串`);
    });
  };

  const checkSourceMap = (label, value) => {
    if (!isObject(value)) {
      errors.push(`${label}: eventsBySource 必须是对象`);
      return;
    }
    for (const key of Object.keys(value)) {
      if (!isCount(value[key])) errors.push(`${label}.eventsBySource.${key}: 必须是非负整数`);
    }
    for (const key of SOURCE_KEYS) {
      if (!(key in value)) errors.push(`${label}.eventsBySource: 缺少来源 "${key}"`);
    }
  };

  if (!checkObject("expected", expected, TOP_KEYS, [...TOP_KEYS])) return errors;

  if (expected.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    errors.push(`expected.schemaVersion: 期望 ${EXPECTED_SCHEMA_VERSION}，实际 ${JSON.stringify(expected.schemaVersion)}`);
  }
  if (!(typeof expected.seed === "string" || typeof expected.seed === "number")) {
    errors.push("expected.seed: 必须是字符串或数字");
  }
  if (!isCount(expected.days) || expected.days === 0) {
    errors.push("expected.days: 必须是正整数");
  }

  if (checkObject("expected.tests", expected.tests, TEST_KEYS, [...TEST_KEYS])) {
    if (checkCounts("expected.tests", expected.tests, [...TEST_KEYS])) {
      const sum = expected.tests.embodied + expected.tests.world + expected.tests.kernel;
      if (expected.tests.total !== sum) {
        errors.push(`expected.tests.total: ${expected.tests.total} != 各 suite 之和 ${sum}`);
      }
    }
  }

  if (checkObject("expected.b2", expected.b2, B2_KEYS, [...B2_KEYS])) {
    if (!isCount(expected.b2.events)) errors.push("expected.b2.events: 必须是非负整数");
    checkSourceMap("expected.b2", expected.b2.eventsBySource);
    for (const key of ["projectionHash", "fullHash"]) {
      if (!isNonEmptyString(expected.b2[key])) errors.push(`expected.b2.${key}: 必须是非空字符串`);
    }
    checkGateIds("expected.b2", expected.b2.expectedGateIds);
  }

  if (checkObject("expected.b3", expected.b3, B3_KEYS, [...B3_KEYS])) {
    if (!isCount(expected.b3.events)) errors.push("expected.b3.events: 必须是非负整数");
    checkSourceMap("expected.b3", expected.b3.eventsBySource);
    if (!isNonEmptyString(expected.b3.replayHash)) errors.push("expected.b3.replayHash: 必须是非空字符串");
    if (typeof expected.b3.replayIdentical !== "boolean") {
      errors.push("expected.b3.replayIdentical: 必须是布尔值");
    }
    for (const key of B3_KEYS) {
      if (key === "events" || key === "eventsBySource" || key === "replayHash") continue;
      if (key === "replayIdentical" || key === "expectedGateIds") continue;
      if (!isCount(expected.b3[key])) errors.push(`expected.b3.${key}: 必须是非负整数`);
    }
    checkGateIds("expected.b3", expected.b3.expectedGateIds);
  }

  if (checkObject("expected.cassettes", expected.cassettes, CASSETTE_KEYS, [...CASSETTE_KEYS])) {
    checkCounts("expected.cassettes", expected.cassettes, [...CASSETTE_KEYS]);
  }

  return errors;
}


/**
 * 门集合校验：expectedGateIds 与报告门 id 集合必须相等。
 * 缺门、多门、改名、重复、失败门都会失败。
 */
function gateErrors(label, gates, expectedIds) {
  const errors = [];
  if (!Array.isArray(expectedIds) || expectedIds.length === 0) {
    errors.push(`${label}: expectedGateIds 缺失或为空`);
    return { errors, passed: 0, expected: 0, actualIds: [] };
  }
  if (new Set(expectedIds).size !== expectedIds.length) {
    errors.push(`${label}: expectedGateIds 自身有重复 id`);
  }
  if (!Array.isArray(gates)) {
    errors.push(`${label}: 报告缺少 gates 数组`);
    return { errors, passed: 0, expected: expectedIds.length, actualIds: [] };
  }

  const actualIds = gates.map((gate) => gate.id);
  const actualSet = new Set();
  for (const id of actualIds) {
    if (actualSet.has(id)) errors.push(`${label}: 报告出现重复门 id "${id}"`);
    actualSet.add(id);
  }
  const expectedSet = new Set(expectedIds);
  const missing = expectedIds.filter((id) => !actualSet.has(id));
  const unexpected = actualIds.filter((id) => !expectedSet.has(id));
  if (missing.length > 0) errors.push(`${label}: 缺少期望门 ${missing.join(", ")}`);
  if (unexpected.length > 0) errors.push(`${label}: 多出未期望门 ${unexpected.join(", ")}`);
  if (actualIds.length !== expectedIds.length) {
    errors.push(`${label}: 门数 ${actualIds.length} != 期望 ${expectedIds.length}`);
  }

  const failed = gates.filter((gate) => gate.pass !== true).map((gate) => gate.id);
  if (failed.length > 0) errors.push(`${label}: 存在失败门 ${failed.join(", ")}`);

  const passed = gates.filter((gate) => gate.pass === true).length;
  return { errors, passed, expected: expectedIds.length, actualIds };
}

/** 从真实测试输出 + 报告 JSON 计算实际基线。 */
function actualFromReports() {
  const tests = runSuites({ forward: false });
  if (!tests.ok) {
    throw new Error(`测试未通过，不能计算基线：\n${tests.failures.map((line) => `- ${line}`).join("\n")}`);
  }

  const b2 = readJson(B2_PATH);
  const b3 = readJson(B3_PATH);
  if (!b3.replay || b3.replay.identical !== true || b3.replay.hashA !== b3.replay.hashB) {
    throw new Error("B3 回放不一致：replay.identical / hashA / hashB 不满足");
  }

  const byName = Object.fromEntries(tests.suites.map((suite) => [suite.name, suite.tests]));
  const countsBy = (field) => Object.fromEntries(tests.suites.map((suite) => [suite.name, suite[field]]));
  const totalOf = (counts) => counts.embodied + counts.world + counts.kernel;
  const testSum = TEST_FIELDS.filter((field) => field !== "total").reduce(
    (sum, field) => sum + byName[field],
    0,
  );
  const pass = countsBy("pass");
  const skipped = countsBy("skipped");
  const todo = countsBy("todo");
  const cancelled = countsBy("cancelled");

  return {
    seed: b2.seed ?? b3.full?.seed ?? "7",
    days: b2.days ?? b3.full?.days ?? 3,
    tests: {
      embodied: byName.embodied,
      world: byName.world,
      kernel: byName.kernel,
      total: tests.total,
      pass: { ...pass, total: totalOf(pass) },
      skipped: { ...skipped, total: totalOf(skipped) },
      todo: { ...todo, total: totalOf(todo) },
      cancelled: { ...cancelled, total: totalOf(cancelled) },
    },
    testSum,
    b2: {
      events: b2.events,
      eventsBySource: b2.eventsBySource,
      projectionHash: b2.projectionHash,
      fullHash: b2.fullHash,
      gates: b2.gates ?? [],
    },
    b3: {
      events: b3.full?.events,
      eventsBySource: b3.full?.sources,
      replayHash: b3.replay.hashA,
      replayIdentical: b3.replay.identical,
      tierChanges: b3.full?.tierChanges,
      promotions: b3.full?.promotions,
      demotions: b3.full?.demotions,
      crowdIndividualizations: b3.full?.crowdIndividualizations,
      crowdMerges: b3.full?.crowdMerges,
      directorAttempts: b3.director?.attempts,
      directorProposals: b3.director?.proposals,
      dialogueCalls: b3.dialogue?.calls,
      llmSources: b3.dialogue?.llmSources,
      cassetteMisses: b3.dialogue?.cassetteMisses,
      gates: b3.gates ?? [],
    },
    cassettes: {
      b3: countJson(B3_CASSETTE_DIR),
      probe: countJson(PROBE_CASSETTE_DIR),
    },
  };
}

/** 由实际值构造期望文件内容（只有 --accept 使用）。 */
function expectedFromActual(actual) {
  return {
    schemaVersion: 2,
    seed: actual.seed,
    days: actual.days,
    tests: {
      embodied: actual.tests.embodied,
      world: actual.tests.world,
      kernel: actual.tests.kernel,
      total: actual.tests.total,
    },
    b2: {
      events: actual.b2.events,
      eventsBySource: actual.b2.eventsBySource,
      projectionHash: actual.b2.projectionHash,
      fullHash: actual.b2.fullHash,
      expectedGateIds: actual.b2.gates.map((gate) => gate.id),
    },
    b3: {
      events: actual.b3.events,
      eventsBySource: actual.b3.eventsBySource,
      replayHash: actual.b3.replayHash,
      replayIdentical: actual.b3.replayIdentical,
      tierChanges: actual.b3.tierChanges,
      promotions: actual.b3.promotions,
      demotions: actual.b3.demotions,
      crowdIndividualizations: actual.b3.crowdIndividualizations,
      crowdMerges: actual.b3.crowdMerges,
      directorAttempts: actual.b3.directorAttempts,
      directorProposals: actual.b3.directorProposals,
      dialogueCalls: actual.b3.dialogueCalls,
      llmSources: actual.b3.llmSources,
      cassetteMisses: actual.b3.cassetteMisses,
      expectedGateIds: actual.b3.gates.map((gate) => gate.id),
    },
    cassettes: { ...actual.cassettes },
  };
}

function buildBaselineJson(actual, b2GateResult, b3GateResult) {
  return {
    schemaVersion: 2,
    generatedBy: "pnpm check:baseline",
    expectedSource: EXPECTED_PATH,
    verifiedAgainstExpected: true,
    seed: actual.seed,
    days: actual.days,
    tests: {
      ...actual.tests,
      verifiedBy:
        "parsed from actual test output (scripts/lib/test-suites.mjs; pass==tests, skipped/todo/cancelled==0)",
    },
    b2: {
      events: actual.b2.events,
      eventsBySource: actual.b2.eventsBySource,
      projectionHash: actual.b2.projectionHash,
      fullHash: actual.b2.fullHash,
      gates: actual.b2.gates.length,
      passedGates: b2GateResult.passed,
      expectedGates: b2GateResult.expected,
      gateIds: b2GateResult.actualIds,
    },
    b3: {
      events: actual.b3.events,
      eventsBySource: actual.b3.eventsBySource,
      replayHash: actual.b3.replayHash,
      replayIdentical: actual.b3.replayIdentical,
      tierChanges: actual.b3.tierChanges,
      promotions: actual.b3.promotions,
      demotions: actual.b3.demotions,
      crowdIndividualizations: actual.b3.crowdIndividualizations,
      crowdMerges: actual.b3.crowdMerges,
      directorAttempts: actual.b3.directorAttempts,
      directorProposals: actual.b3.directorProposals,
      dialogueCalls: actual.b3.dialogueCalls,
      llmSources: actual.b3.llmSources,
      cassetteMisses: actual.b3.cassetteMisses,
      gates: actual.b3.gates.length,
      passedGates: b3GateResult.passed,
      expectedGates: b3GateResult.expected,
      gateIds: b3GateResult.actualIds,
    },
    cassettes: { ...actual.cassettes },
  };
}

function buildBaselineMd(actual, expected, b2GateResult, b3GateResult) {
  const lines = [
    "# 回归基线（P0/M1）",
    "",
    "生成：`pnpm check:baseline`。",
    `期望值来源：\`${EXPECTED_PATH}\`（受版本控制；普通 \`pnpm verify\` 不会改写它，只有显式 \`pnpm baseline:accept\` 才能更新）。`,
    "",
    "## 测试（由实际测试输出解析，不硬编码）",
    "",
    `- 具身：${actual.tests.pass.embodied} 通过 / ${expected.tests.embodied} 期望（skip ${actual.tests.skipped.embodied}，todo ${actual.tests.todo.embodied}）`,
    `- 世界：${actual.tests.pass.world} 通过 / ${expected.tests.world} 期望（skip ${actual.tests.skipped.world}，todo ${actual.tests.todo.world}）`,
    `- 共享内核：${actual.tests.pass.kernel} 通过 / ${expected.tests.kernel} 期望（skip ${actual.tests.skipped.kernel}，todo ${actual.tests.todo.kernel}）`,
    `- 合计：${actual.tests.pass.total} 通过 / ${expected.tests.total} 期望（skip ${actual.tests.skipped.total}，todo ${actual.tests.todo.total}）`,
    "",
    "## B2",
    "",
    `- 事件：${actual.b2.events}（期望 ${expected.b2.events}）`,
    `- 来源：${JSON.stringify(actual.b2.eventsBySource)}`,
    `- projectionHash：\`${actual.b2.projectionHash}\``,
    `- fullHash：\`${actual.b2.fullHash}\``,
    `- 门：${b2GateResult.passed} 通过 / ${b2GateResult.expected} 期望（集合相等）`,
    "",
    "## B3",
    "",
    `- 事件：${actual.b3.events}（期望 ${expected.b3.events}）`,
    `- 来源：${JSON.stringify(actual.b3.eventsBySource)}`,
    `- replayHash：\`${actual.b3.replayHash}\`；identical=${actual.b3.replayIdentical}`,
    `- 晋升/降级：${actual.b3.promotions}/${actual.b3.demotions}`,
    `- 群体个体化/合并：${actual.b3.crowdIndividualizations}/${actual.b3.crowdMerges}`,
    `- Director：${actual.b3.directorAttempts} 次 / ${actual.b3.directorProposals} 提案`,
    `- 角色对话：${actual.b3.dialogueCalls} 次；LLM=${actual.b3.llmSources}；cassette miss=${actual.b3.cassetteMisses}`,
    `- 门：${b3GateResult.passed} 通过 / ${b3GateResult.expected} 期望（集合相等）`,
    "",
    "## Cassette",
    "",
    `- B3 完整：${actual.cassettes.b3} 个`,
    `- 单点探针：${actual.cassettes.probe} 个`,
    "- 均不含 key/headers；由 `pnpm check:secrets` 复查。",
    "",
  ];
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function writeReports(actual, expected, b2GateResult, b3GateResult) {
  mkdirSync("reports", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(buildBaselineJson(actual, b2GateResult, b3GateResult), null, 2)}\n`, "utf8");
  writeFileSync(OUT_MD, buildBaselineMd(actual, expected, b2GateResult, b3GateResult), "utf8");
}

function describeSectionDiff(previous, next) {
  const lines = [];
  for (const section of ["seed", "days", "tests", "b2", "b3", "cassettes"]) {
    if (canonical(previous?.[section]) === canonical(next?.[section])) continue;
    lines.push(`- ${section}: ${JSON.stringify(previous?.[section])}`);
    lines.push(`  -> ${JSON.stringify(next?.[section])}`);
  }
  return lines;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("用法：node scripts/baseline.mjs [--check|--accept]");
    console.log("  --check   默认。与 reports/baseline.expected.json 对照，不一致则失败。");
    console.log("  --accept  显式接受当前结果为新期望（会改写 reports/baseline.expected.json）。");
    return;
  }

  const accept = args.includes("--accept");
  const unknown = args.filter((arg) => arg !== "--accept" && arg !== "--check");
  if (unknown.length > 0) {
    console.error(`未知参数：${unknown.join(", ")}（只支持 --check / --accept）`);
    process.exitCode = 1;
    return;
  }

  // Round 2：先验报告新鲜度。本命令不重生成 report；陈旧报告会让单命令假绿（P12）。
  const freshness = freshnessErrors();
  if (freshness.length > 0) {
    console.error(
      "报告新鲜度检查失败：本命令不重生成 B2/B3 报告，需先运行 `pnpm report:world`（`pnpm verify` / CI 已包含该步骤）。",
    );
    for (const message of freshness) console.error(`- ${message}`);
    process.exitCode = 1;
    return;
  }

  const actual = actualFromReports();

  if (accept) {
    const gateFailures = [];
    for (const [label, gates] of [
      ["B2", actual.b2.gates],
      ["B3", actual.b3.gates],
    ]) {
      if (!Array.isArray(gates) || gates.length === 0) {
        gateFailures.push(`${label}: 没有门，拒绝接受`);
        continue;
      }
      const ids = gates.map((gate) => gate.id);
      if (new Set(ids).size !== ids.length) gateFailures.push(`${label}: 门 id 重复`);
      const failed = gates.filter((gate) => gate.pass !== true).map((gate) => gate.id);
      if (failed.length > 0) gateFailures.push(`${label}: 失败门 ${failed.join(", ")}`);
    }
    if (gateFailures.length > 0) {
      console.error("拒绝接受新基线：当前门不满足（失败门/重复门/空门）。");
      for (const message of gateFailures) console.error(`- ${message}`);
      process.exitCode = 1;
      return;
    }
    if (actual.tests.total !== actual.testSum) {
      console.error("拒绝接受新基线：测试合计与各 suite 之和不一致。");
      process.exitCode = 1;
      return;
    }

    const previous = existsSync(EXPECTED_PATH) ? readJson(EXPECTED_PATH) : null;
    const next = expectedFromActual(actual);
    const nextSchemaErrors = expectedSchemaErrors(next);
    if (nextSchemaErrors.length > 0) {
      console.error("拒绝接受新基线：生成的期望文件未通过 schema 校验。");
      for (const message of nextSchemaErrors) console.error(`- ${message}`);
      process.exitCode = 1;
      return;
    }
    mkdirSync("reports", { recursive: true });
    writeFileSync(EXPECTED_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    console.log(`! 已显式接受新基线 -> ${EXPECTED_PATH}`);
    if (previous) {
      const diff = describeSectionDiff(previous, next);
      if (diff.length === 0) console.log("  （期望值无变化）");
      else {
        console.log("  期望值变更：");
        for (const line of diff) console.log(`  ${line}`);
      }
    }
    writeReports(
      actual,
      next,
      { passed: actual.b2.gates.filter((gate) => gate.pass === true).length, expected: actual.b2.gates.length, actualIds: actual.b2.gates.map((gate) => gate.id) },
      { passed: actual.b3.gates.filter((gate) => gate.pass === true).length, expected: actual.b3.gates.length, actualIds: actual.b3.gates.map((gate) => gate.id) },
    );
    console.log(`wrote ${OUT_JSON}`);
    console.log(`wrote ${OUT_MD}`);
    return;
  }

  if (!existsSync(EXPECTED_PATH)) {
    console.error(`缺少期望基线 ${EXPECTED_PATH}。`);
    console.error("首次建立或有意更新基线时，显式运行：pnpm baseline:accept");
    process.exitCode = 1;
    return;
  }

  const expected = readJson(EXPECTED_PATH);
  const errors = [];
  errors.push(...expectedSchemaErrors(expected));
  errors.push(...valueErrors("tests", actual.tests, expected.tests, TEST_FIELDS));
  errors.push(...valueErrors("b2", actual.b2, expected.b2, B2_FIELDS));
  errors.push(...valueErrors("b3", actual.b3, expected.b3, B3_FIELDS));
  errors.push(...valueErrors("cassettes", actual.cassettes, expected.cassettes, ["b3", "probe"]));

  if (actual.tests.total !== actual.testSum) {
    errors.push(`tests.total: ${actual.tests.total} != 各 suite 之和 ${actual.testSum}`);
  }

  const b2GateResult = gateErrors("B2", actual.b2.gates, expected.b2?.expectedGateIds);
  const b3GateResult = gateErrors("B3", actual.b3.gates, expected.b3?.expectedGateIds);
  errors.push(...b2GateResult.errors, ...b3GateResult.errors);

  if (errors.length > 0) {
    console.error("基线对照失败：当前结果与期望不一致（未写入 baseline.json/md，期望文件未改动）。");
    for (const message of errors) console.error(`- ${message}`);
    process.exitCode = 1;
    return;
  }

  writeReports(actual, expected, b2GateResult, b3GateResult);
  console.log(
    `ok: 基线一致（测试 ${actual.tests.pass.total} 通过 / ${expected.tests.total} 期望；` +
      `skipped ${actual.tests.skipped.total}；todo ${actual.tests.todo.total}；` +
      `B2 门 ${b2GateResult.passed} 通过 / ${b2GateResult.expected} 期望；` +
      `B3 门 ${b3GateResult.passed} 通过 / ${b3GateResult.expected} 期望）`,
  );
  console.log("报告新鲜度：ok（源码/夹具内容指纹与 report 印记一致）");
  console.log(
    "note: 本地 pnpm verify 不检查 git worktree 是否干净（CI 另有 git diff --exit-code 断言）；本地绿 ≠ CI 绿。",
  );
  console.log(`wrote ${OUT_JSON}`);
  console.log(`wrote ${OUT_MD}`);
}

try {
  main();
} catch (error) {
  console.error(`baseline 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
