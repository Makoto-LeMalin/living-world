/**
 * 共享内核单进程测试入口。
 * 与 demo 一样避免 `node --test <dir>` 在受限环境下 spawn EPERM。
 */
import "./clock.test.ts";
import "./kernel.test.ts";
import "./space.test.ts";
import "./event-store.test.ts";
