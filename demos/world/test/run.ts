/**
 * 世界 demo 单进程测试入口。
 * 与具身 demo 一样，避免 `node --test <dir>` 在受限环境下 spawn EPERM。
 */
import "./builder.test.ts";
import "./plans.test.ts";
import "./sim.test.ts";
import "./determinism.test.ts";
import "./query.test.ts";
import "./travel.test.ts";
import "./b3.test.ts";
import "./character.test.ts";
