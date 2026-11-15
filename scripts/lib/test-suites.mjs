/**
 * R0：以单进程方式运行三个测试 suite，并从**真实输出**解析计数。
 *
 * 为什么不用管道：受限环境（如 DSH sandbox）禁止 Node 子进程使用 pipe stdio
 * （spawn EPERM）。这里把子进程 stdout/stderr 重定向到临时文件（普通文件句柄），
 * 事后再读回并解析，既不依赖 pipe，也保证计数来自实际测试输出而不是字面量。
 *
 * 三个 suite 与 `pnpm test:all` 完全一致（顺序也一致）。
 *
 * 有效性约束（R0 Round 2）：`skipped` / `todo` / `cancelled` 非 0 即失败，
 * 且 `pass` 必须等于 `tests`。只比较 `tests` 与 `fail===0` 会让一个 `test.skip`
 * 保持全绿，探针 N3a 已证明该缺口。
 */

import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SUITES = [
  { name: "embodied", entry: "demos/embodied/test/run.ts" },
  { name: "world", entry: "demos/world/test/run.ts" },
  { name: "kernel", entry: "test/run.ts" },
];

const ANSI = /\u001b\[[0-9;]*m/g;

/** 取最后一条 `ℹ <label> <n>`；node:test 每个进程只打印一份汇总。 */
function lastCount(text, label) {
  const pattern = new RegExp(`^\\s*ℹ\\s*${label}\\s+(\\d+)\\s*$`, "gm");
  let value = null;
  for (const match of text.matchAll(pattern)) value = Number(match[1]);
  return value;
}

/** 从一份 node:test 输出中解析 tests/pass/fail/skipped/todo/cancelled。 */
export function parseTestCounts(text) {
  const clean = text.replace(ANSI, "");
  const tests = lastCount(clean, "tests");
  const pass = lastCount(clean, "pass");
  const fail = lastCount(clean, "fail");
  if (tests === null || pass === null || fail === null) {
    throw new Error("无法从测试输出解析 ℹ tests/pass/fail 计数");
  }
  return {
    tests,
    pass,
    fail,
    skipped: lastCount(clean, "skipped") ?? 0,
    todo: lastCount(clean, "todo") ?? 0,
    cancelled: lastCount(clean, "cancelled") ?? 0,
  };
}

/**
 * 运行全部 suite。
 *
 * @param {{ forward?: boolean, cwd?: string, requirePass?: boolean }} options
 *   forward: 是否把子进程输出转发到当前 stdout（测试门用 true，基线门用 false）。
 *   requirePass: 有失败/跳过/待办/取消测试时是否记为 failure。
 * @returns {{ suites: Array<object>, total: number|null, failures: string[], ok: boolean }}
 */
export function runSuites({ forward = true, cwd = process.cwd(), requirePass = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lw-test-suites-"));
  const suites = [];
  const failures = [];

  try {
    for (const suite of SUITES) {
      const logPath = join(dir, `${suite.name}.log`);
      const fd = openSync(logPath, "w");
      let result;
      try {
        result = spawnSync(process.execPath, [suite.entry], {
          cwd,
          stdio: ["ignore", fd, fd],
        });
      } finally {
        closeSync(fd);
      }

      const text = readFileSync(logPath, "utf8");
      if (forward) process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);

      if (result.error) {
        failures.push(`${suite.name}: 无法启动测试进程 (${result.error.code ?? result.error.message})`);
        suites.push({
          name: suite.name,
          tests: null,
          pass: null,
          fail: null,
          skipped: null,
          todo: null,
          cancelled: null,
          status: null,
        });
        continue;
      }

      let counts;
      try {
        counts = parseTestCounts(text);
      } catch (error) {
        failures.push(`${suite.name}: ${error.message}`);
        suites.push({
          name: suite.name,
          tests: null,
          pass: null,
          fail: null,
          skipped: null,
          todo: null,
          cancelled: null,
          status: result.status,
        });
        continue;
      }

      suites.push({ name: suite.name, ...counts, status: result.status });
      if (!requirePass) continue;

      if (result.status !== 0) failures.push(`${suite.name}: 进程退出码 ${result.status}`);
      if (counts.fail !== 0) failures.push(`${suite.name}: ${counts.fail} 个测试失败`);
      if (counts.skipped !== 0) failures.push(`${suite.name}: ${counts.skipped} 个 skipped 测试（skipped 必须为 0）`);
      if (counts.todo !== 0) failures.push(`${suite.name}: ${counts.todo} 个 todo 测试（todo 必须为 0）`);
      if (counts.cancelled !== 0) failures.push(`${suite.name}: ${counts.cancelled} 个 cancelled 测试（cancelled 必须为 0）`);
      if (counts.pass !== counts.tests) {
        failures.push(
          `${suite.name}: pass ${counts.pass} != tests ${counts.tests}（存在未通过/跳过/待办/取消）`,
        );
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const complete = suites.every((suite) => typeof suite.tests === "number");
  const total = complete ? suites.reduce((sum, suite) => sum + suite.tests, 0) : null;

  return { suites, total, failures, ok: failures.length === 0 };
}
