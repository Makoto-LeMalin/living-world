/**
 * R0：`pnpm test:all` 的入口。
 *
 * 与旧的 `node a && node b && node c` 等价地依次运行三个 suite，
 * 但会把每个 suite 的真实输出解析成计数并在末尾打印一行汇总。
 * 基线门（scripts/baseline.mjs）复用同一 runner，因此测试数不再硬编码。
 */

import { runSuites } from "./lib/test-suites.mjs";

const result = runSuites({ forward: true });

if (!result.ok) {
  console.error(`test:all FAIL: ${result.failures.join("; ")}`);
  process.exitCode = 1;
} else {
  const counts = Object.fromEntries(result.suites.map((suite) => [suite.name, suite.tests]));
  console.log(
    `test:all ok: embodied=${counts.embodied} world=${counts.world} kernel=${counts.kernel} total=${result.total}`,
  );
}
