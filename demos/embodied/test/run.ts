/**
 * 单进程测试入口。
 * 不用 `node --test <dir>`：某些沙箱/Windows 环境会为每个测试文件 spawn 子进程，
 * 在受限环境下会 EPERM。这里直接 import，测试仍在 node:test 里跑。
 */
import "./capability.test.ts";
import "./feasibility.test.ts";
import "./check.test.ts";
import "./log.test.ts";
import "./scenario.test.ts";
import "./scenario-llm.test.ts";
import "./trace.test.ts";
import "./v2.test.ts";
import "./parity.test.ts";
import "./compiler.test.ts";
import "./v3.test.ts";
import "./dm.test.ts";
import "./narrator.test.ts";
import "./cassette.test.ts";
import "./deepseek.test.ts";
