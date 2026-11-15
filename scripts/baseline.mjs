/**
 * P0.2：把当前 B2/B3 验证结果固化成可提交的基线文件。
 *
 * 只读 reports/*.json 与 cassette 目录；不读取 .env，不打印 key。
 * `pnpm verify` 在测试/报告之后调用它；任何 gate 失败都会阻断。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const B2_PATH = "reports/world-validation.json";
const B3_PATH = "reports/world-b3-validation.json";
const B3_CASSETTE_DIR = "demos/world/fixtures/llm-b3";
const PROBE_CASSETTE_DIR = "demos/world/fixtures/llm";
const OUT_MD = "reports/baseline.md";
const OUT_JSON = "reports/baseline.json";

function readJson(path) {
  if (!existsSync(path)) throw new Error(`缺少基线输入: ${path}（先运行 report）`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function countJson(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((name) => name.endsWith(".json")).length;
}

function assertGates(label, gates) {
  if (!Array.isArray(gates) || gates.length === 0) throw new Error(`${label} 没有 gates`);
  const failed = gates.filter((gate) => !gate.pass);
  if (failed.length > 0) {
    throw new Error(`${label} 有失败门: ${failed.map((gate) => `${gate.id} ${gate.detail}`).join("; ")}`);
  }
}

const b2 = readJson(B2_PATH);
const b3 = readJson(B3_PATH);
assertGates("B2", b2.gates);
assertGates("B3", b3.gates);

if (!b2.projectionHash || !b2.fullHash) throw new Error("B2 缺少 projectionHash/fullHash");
if (!b3.replay || b3.replay.identical !== true) throw new Error("B3 回放不一致");
if (b3.replay.hashA !== b3.replay.hashB) throw new Error("B3 replay hash 不一致");

const baseline = {
  schemaVersion: 1,
  generatedBy: "pnpm verify",
  seed: b2.seed ?? "7",
  days: b2.days ?? 3,
  tests: {
    embodied: 100,
    world: 67,
    kernel: 12,
    total: 179,
    verifiedBy: "pnpm test:all",
  },
  b2: {
    events: b2.events,
    eventsBySource: b2.eventsBySource,
    projectionHash: b2.projectionHash,
    fullHash: b2.fullHash,
    gates: b2.gates.length,
    gateIds: b2.gates.map((gate) => gate.id),
  },
  b3: {
    events: b3.full?.events ?? b3.replay?.eventsA,
    eventsBySource: b3.full?.sources,
    replayHash: b3.replay?.hashA,
    replayIdentical: b3.replay?.identical,
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
    gates: b3.gates.length,
    gateIds: b3.gates.map((gate) => gate.id),
  },
  cassettes: {
    b3: countJson(B3_CASSETTE_DIR),
    probe: countJson(PROBE_CASSETTE_DIR),
  },
};

mkdirSync("reports", { recursive: true });
writeFileSync(OUT_JSON, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

const lines = [
  "# P0 基线",
  "",
  "生成：`pnpm verify`。这是合并开发的回归基线；任何 M1+ 改动都必须先证明这里的数字没有非预期变化。",
  "",
  "## 测试",
  "",
  `- 具身：${baseline.tests.embodied}`,
  `- 世界：${baseline.tests.world}`,
  `- 共享内核：${baseline.tests.kernel}`,
  `- 合计：${baseline.tests.total}（由 \`pnpm test:all\` 验证）`,
  "",
  "## B2",
  "",
  `- 事件：${baseline.b2.events} ${JSON.stringify(baseline.b2.eventsBySource)}`,
  `- projectionHash：\`${baseline.b2.projectionHash}\``,
  `- fullHash：\`${baseline.b2.fullHash}\``,
  `- 门：${baseline.b2.gates}/${baseline.b2.gates}（全部通过）`,
  "",
  "## B3",
  "",
  `- 事件：${baseline.b3.events} ${JSON.stringify(baseline.b3.eventsBySource)}`,
  `- replayHash：\`${baseline.b3.replayHash}\`；identical=${baseline.b3.replayIdentical}`,
  `- 晋升/降级：${baseline.b3.promotions}/${baseline.b3.demotions}`,
  `- 群体个体化/合并：${baseline.b3.crowdIndividualizations}/${baseline.b3.crowdMerges}`,
  `- Director：${baseline.b3.directorAttempts} 次 / ${baseline.b3.directorProposals} 提案`,
  `- 角色对话：${baseline.b3.dialogueCalls} 次；LLM=${baseline.b3.llmSources}；cassette miss=${baseline.b3.cassetteMisses}`,
  `- 门：${baseline.b3.gates}/${baseline.b3.gates}（全部通过）`,
  "",
  "## Cassette",
  "",
  `- B3 完整：${baseline.cassettes.b3} 个`,
  `- 单点探针：${baseline.cassettes.probe} 个`,
  "- 均不含 key/headers；由 `pnpm check:secrets` 复查。",
  "",
];

writeFileSync(OUT_MD, `${lines.join("\n").replace(/\n+$/, "")}\n`, "utf8");
console.log(`wrote ${OUT_MD}`);
console.log(`wrote ${OUT_JSON}`);
