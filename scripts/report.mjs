/**
 * R0 Round 2：生成 B2/B3 报告并写入“报告新鲜度印记”。
 *
 * 等价于 `node demos/world/src/cli.ts report`，额外记录：
 *   - 生成报告时的源码/夹具内容指纹；
 *   - 生成的报告文件内容哈希。
 *
 * 基线门据此拒绝陈旧或被改写的报告（独立验证 P12）。
 * 仍只回放 cassette，不调用真实 LLM/网络。
 */

import { spawnSync } from "node:child_process";
import { writeStamp } from "./lib/report-stamp.mjs";

const result = spawnSync(process.execPath, ["demos/world/src/cli.ts", "report"], {
  stdio: "inherit",
});

if (result.error) {
  console.error(`report 失败：无法启动 CLI（${result.error.code ?? result.error.message}）`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  console.error(`report 失败：CLI 退出码 ${result.status}`);
  process.exitCode = result.status ?? 1;
} else {
  const stamp = writeStamp();
  console.log(
    `report stamp: source=${stamp.sourceHash.slice(0, 12)} files=${stamp.sourceFiles} ` +
      `b2=${String(stamp.reports.b2).slice(0, 12)} b3=${String(stamp.reports.b3).slice(0, 12)}`,
  );
}
