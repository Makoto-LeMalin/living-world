/**
 * R0 Round 2：报告新鲜度印记。
 *
 * `check:baseline` / `--accept` 的 B2/B3 输入是 `reports/world-*.json`。
 * 如果这些文件是旧代码生成的，单跑基线门会假绿（独立验证 P12 已实测）。
 *
 * 这里在**生成报告时**写一份 gitignored 印记（`reports/baseline.report-stamp.jsonl`）：
 *   - `sourceHash`：影响报告的全部源码/夹具内容的 SHA-256（与 mtime 无关）；
 *   - `reports.b2/b3`：生成的报告文件内容 SHA-256。
 *
 * 基线门随后校验：
 *   1. 印记存在；
 *   2. 当前源码指纹 == 印记里的指纹（否则报告陈旧）；
 *   3. 磁盘上的报告内容 == 印记里的内容哈希（否则报告被改写/未重新生成）。
 *
 * 印记文件名以 `.jsonl` 结尾，命中既有 `.gitignore` 的 `reports/*.jsonl`，
 * 因此不会污染 tracked 基线或工作区。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export const STAMP_PATH = "reports/baseline.report-stamp.jsonl";

/** 影响 B2/B3 报告内容的源码与夹具目录。 */
export const SOURCE_DIRS = [
  "src",
  "engine",
  "harness",
  "llm",
  "demos/world/src",
  "demos/world/fixtures",
];

export const REPORT_PATHS = {
  b2: "reports/world-validation.json",
  b3: "reports/world-b3-validation.json",
};

export const STAMP_SCHEMA_VERSION = 1;

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** 对源码/夹具做与平台无关的内容指纹（相对路径统一为 `/`）。 */
export function sourceFingerprint(root = process.cwd()) {
  const files = [];
  for (const dir of SOURCE_DIRS) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    walk(abs, files);
  }
  files.sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(root, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return { sourceHash: hash.digest("hex"), sourceFiles: files.length };
}

/** 当前磁盘上的 B2/B3 报告内容哈希；缺失记 null。 */
export function reportFingerprints(root = process.cwd()) {
  const reports = {};
  for (const [key, rel] of Object.entries(REPORT_PATHS)) {
    const abs = join(root, rel);
    reports[key] = existsSync(abs) ? sha256(readFileSync(abs)) : null;
  }
  return reports;
}

/** 生成报告后调用：写入一份新的印记。 */
export function writeStamp(root = process.cwd()) {
  const stamp = {
    schemaVersion: STAMP_SCHEMA_VERSION,
    ...sourceFingerprint(root),
    reports: reportFingerprints(root),
  };
  mkdirSync(join(root, "reports"), { recursive: true });
  writeFileSync(join(root, STAMP_PATH), `${JSON.stringify(stamp)}\n`, "utf8");
  return stamp;
}

/** 读取印记（JSONL 取最后一条可解析行）；不存在返回 null。 */
export function readStamp(root = process.cwd()) {
  const abs = join(root, STAMP_PATH);
  if (!existsSync(abs)) return null;
  const lines = readFileSync(abs, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // 跳过损坏行，继续向前找
    }
  }
  return null;
}

/**
 * 校验报告是否由当前源码生成。
 *
 * @returns {string[]} 错误列表；空数组表示新鲜。
 */
export function freshnessErrors(root = process.cwd()) {
  const errors = [];
  const stamp = readStamp(root);
  if (!stamp || typeof stamp !== "object") {
    return [
      `缺少报告印记 ${STAMP_PATH}：本命令不重生成报告；请先运行 npm script report:world（pnpm verify / CI 已包含该步骤）`,
    ];
  }
  if (stamp.schemaVersion !== STAMP_SCHEMA_VERSION) {
    return [`报告印记 schemaVersion=${JSON.stringify(stamp.schemaVersion)}，期望 ${STAMP_SCHEMA_VERSION}`];
  }

  const current = sourceFingerprint(root);
  if (typeof stamp.sourceHash !== "string" || stamp.sourceHash.length === 0) {
    errors.push(`报告印记缺少 sourceHash：请重跑 report:world`);
  } else if (stamp.sourceHash !== current.sourceHash) {
    errors.push(
      `报告陈旧：report 之后源码/夹具已变化（印记 ${stamp.sourceHash.slice(0, 12)} != 当前 ${current.sourceHash.slice(0, 12)}）；请重跑 report:world`,
    );
  }

  const reports = reportFingerprints(root);
  for (const key of Object.keys(REPORT_PATHS)) {
    if (!reports[key]) {
      errors.push(`缺少报告文件 ${REPORT_PATHS[key]}；请重跑 report:world`);
    } else if (stamp.reports?.[key] !== reports[key]) {
      errors.push(
        `报告文件 ${REPORT_PATHS[key]} 与印记不一致（被改写或未重新生成）；请重跑 report:world`,
      );
    }
  }
  return errors;
}
