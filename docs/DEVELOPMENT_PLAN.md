# Living World · 逐步开发方案（v1.0）

| 项 | 内容 |
|---|---|
| 版本 | v1.0（2026-11-15） |
| 状态 | 执行级计划，待评审 |
| 上游 | [PRD.md](PRD.md)、[ARCHITECTURE.md](ARCHITECTURE.md)、[DEMO_PLAN.md](DEMO_PLAN.md) |
| 当前基线 | 具身 100 测试；世界 67 测试；B2 12/12；B3 13/13；完整 3 天真实 LLM 760 事件 |
| 计划范围 | 从两个 demo 走到一个可连续运行的产品骨架；不含多用户、多模态、图形地图 |
| 估算口径 | 1–2 名工程师，粗略人日；不是交付承诺 |

---

## 0. 计划摘要

### 0.1 一句话路线

> **先抽共享内核，再统一角色，再做一条端到端竖切；竖切通过后再加通信/记忆/人格，最后做存储/宿主/产品验收。**

不先做“大而全”的合并，也不推倒两个 demo。每个阶段结束时，两个 demo 仍能独立跑；合并版本只依赖已验证的模块。

### 0.2 阶段与门

| 阶段 | 目标 | 门 | 估算 |
|---|---|---|---|
| M0 冻结 | 固定基线、契约、验证命令 | G0：167 测试全绿，B2/B3 报告可复现 | 1–2 人日 |
| M1 抽内核 | kernel/space/event/projection 共享化 | G1：两 demo 行为不变，事件日志字节一致 | 3–5 人日 |
| M2 统一角色 | 一套 CharacterRuntime + BodyProvider | G2：CM-1/6/7；B3 13/13 不回退 | 5–7 人日 |
| M3 端到端竖切 | 一条“用户消息 → 身体 → 判定 → 世界事件 → 叙述” | G3：单房间竖切可回放；T1 代理 0 冲突 | 6–9 人日 |
| M4 连续性与通信 | Channel、五类记忆、Persona、主动消息 | G4：T8/T9；记忆可追溯；Persona 可回滚 | 8–12 人日 |
| M5 存储与宿主 | SQLite、应用服务、观察 API、DSH 适配 | G5：T6；重启连续；离线推进一致 | 6–9 人日 |
| M6 产品验证 | 7 天陪伴、成本、T1–T9、内容与评审 | G6：PRD 验收表；go/no-go | 8–12 人日 + 7 天日历 |

**总计**：约 **37–56 工程师日**。1 人约 8–11 周；2 人约 5–7 周（含 7 天真实陪伴观察；观察可与 M5 后期并行）。估算不含评审等待与返工。

### 0.3 关键路径

```
M0 → M1 → M2 → M3 → M4 → M5 → M6
              ↘ M4 设计/原型可提前
                         ↘ M5 的 SQLite/宿主可在 M3 后并行
```

M3 是第一个真正的“合并证明”；在它通过之前，不做全量 UI、不做多世界、不做大规模内容。

---

## 1. 执行原则

1. **每一步都保持可运行。** 不允许“为了架构先停掉 demo”；M1–M2 期间两个 demo 的测试必须一直绿。
2. **先竖切，后铺开。** M3 只做一个房间、一个 companion、一个 NPC、一条信道、一个动作；证明链路，再扩内容。
3. **Gate 是二值的。** 每阶段有明确的通过/失败条件；失败走失败分支，不带病进入下一阶段。
4. **LLM 不进日常 CI。** 所有 LLM 路径默认 cassette；真实调用只手动/夜间跑，报告单独生成。
5. **不复制状态。** 新模块只能通过事件/投影/契约拿数据；禁止为了快复制一份 `WorldState` 到角色层。
6. **不引入未验证的依赖。** 先 SQLite，后考虑 Postgres/队列；先单进程，后拆服务。
7. **每个任务都有测试和报告。** 没有 gate/报告的“完成”不算完成。
8. **文档跟着代码走。** 契约变更先改 `ARCHITECTURE.md`，再改实现；数据/结论进 `reports/`。

---

## 2. 当前基线冻结（M0）

### 2.1 目标

把现有两个 demo 固定为**不可回退的基线**，并建立统一验证命令。

### 2.2 任务

| ID | 任务 | 产出 | 依赖 |
|---|---|---|---|
| P0.1 | 固定验证命令 | `pnpm verify`：typecheck + test:all + check:secrets + B2/B3 report | — |
| P0.2 | 固定基线数据 | 记录 B2/B3 事件数、hash、测试数、cassette 数 | P0.1 |
| P0.3 | 契约冻结 | 把 `ARCHITECTURE.md` §4 的接口抄成 `src/contracts/` 骨架（仅类型） | — |
| P0.4 | 依赖图 | 标注 `demos/embodied`、`demos/world`、`engine/`、`harness/`、`llm/` 的允许依赖 | — |
| P0.5 | 决策记录 | ADR-1–9 落到 `docs/adr/` 或 `ARCHITECTURE.md` 附录 | P0.3 |
| P0.6 | 风险登记 | 记录 T7 日历风险、DSH 耦合风险、schema 迁移风险 | — |

### 2.3 G0 通过条件

- `pnpm typecheck` 0 错误。
- `pnpm test:all`：100 + 67 = **167 全绿**。
- `node demos/world/src/cli.ts report`：B2 12/12、B3 13/13。
- `node scripts/check-secrets.mjs` 通过。
- 固定 seed 的事件日志/hash 记录在 `reports/baseline.md`。

### 2.4 失败分支

- 如果 B2/B3 报告本身不可复现，先修回放/报告，不进入 M1。
- 如果测试依赖真实 API key，改成 cassette 或 stub，不把 key 带进 CI。

### 2.5 完成记录（2026-11-15）

P0 已完成：

- `pnpm verify`：typecheck + 167 测试 + secrets + B2/B3 report + baseline。
- 基线：[reports/baseline.md](../reports/baseline.md) / [.json](../reports/baseline.json)。
- 契约：[src/contracts/index.ts](../src/contracts/index.ts)。
- 依赖矩阵：[docs/DEPENDENCIES.md](DEPENDENCIES.md)。
- ADR：[docs/adr/README.md](adr/README.md)。
- 风险登记：[docs/RISKS.md](RISKS.md)。

后续追加（M1 P1.1 起步）：`ClockSpec`/`WorldClock` 与 12 条时钟单测；`pnpm test:all` 现为 100 + 67 + 12 = **179**。

---

## 3. M1：抽共享内核

### 3.1 目标

把两个 demo 已经重复/即将重复的部分抽成共享模块；**行为不变**。

### 3.2 任务

| ID | 任务 | 产出 | 依赖 |
|---|---|---|---|
| P1.1 | `kernel`：clock/rng/ids/canonical-json/snapshot | `src/kernel/*` + 单测；clock 含 `ClockSpec`/`WorldClock`（`stepped` 开发、`realtime` 应用） | G0 |
| P1.2 | `space`：room/route/visibility | `src/space/*` + 单测 | P1.1 |
| P1.3 | 拆分 `World.emit` | `EventStore.append` + `Projection.apply` | P1.1 |
| P1.4 | 共享 test fixtures/harness | `harness/replay.ts`、`harness/invariant.ts` | P1.3 |
| P1.5 | demo 适配 | 两个 demo import 新模块，删除重复实现 | P1.1–P1.4 |
| P1.6 | 兼容性验证 | 同 seed 事件日志/投影 hash 与 M0 一致 | P1.5 |

### 3.3 G1 通过条件

- 两个 demo 的测试数不减少，全部通过。
- 同 seed、同参数的事件日志**字节一致**。
- 不新增运行时依赖；不改变 CLI 输出格式。
- `src/` 不 import `demos/`。
- `ClockSpec` 的 1:1、60x、0.5x、暂停、补齐、序列化单测通过；demo 与内核都不读挂钟。

### 3.4 失败分支

- 字节不一致：先查排序/ID/RNG 流，不回退到“重建事件”。
- 抽取后 demo 变复杂：保留 demo 本地 adapter，不强行共享。

---

## 4. M2：统一角色运行时

### 4.1 目标

让 companion、T0–T3 NPC、群体走同一套 `CharacterRuntime`，身体按 LOD 提供 full/summary/aggregate。

### 4.2 任务

| ID | 任务 | 产出 | 依赖 |
|---|---|---|---|
| P2.1 | Character 模型 | `kind/identity/persona/body/social/mind/presence` | G1 |
| P2.2 | BodyProvider | full/summary/aggregate 三种视图 | P2.1 |
| P2.3 | Runtime 适配 | `CompanionRuntime`、`NpcRuntime`、`CrowdRuntime` 同契约 | P2.1 |
| P2.4 | Capability/Constraint 适配 | 具身 body → C；约束 → 硬拒绝 | P2.2 |
| P2.5 | T0–T3 | importance、晋升/降级、CharacterRecord、tombstone | P2.3 |
| P2.6 | 契约测试 | CM-1、CM-6、CM-7；B3 回归 | P2.3–P2.5 |
| P2.7 | 身体降级测试 | 同一 NPC 从 full 降到 summary 再恢复 | P2.2 |

### 4.3 G2 通过条件

- CM-1：companion/NPC/crowd 同一 13 项 contract。
- CM-6：20 次降级→晋升，身份/关系/关键记忆 100%。
- CM-7：群体个体化→合并→再观察一致。
- B3 13/13 不回退；世界 67 测试不回退。
- 具身 100 测试不回退。

### 4.4 失败分支

- 如果 companion 和 NPC 的差异无法用策略表达，先保留两个 adapter，不强行合并类。
- 如果 body summary 影响判定，明确“summary 只用于非焦点，焦点自动升级 full”，不在 summary 上掷骰。

---

## 5. M3：端到端竖切

### 5.1 目标

只做一个最小场景，证明完整链路：

```
用户信道消息
  → companion 感知
  → Mind 产生 Intent
  → Compiler 产出 ActionDemand
  → WorldRuleSet 判可行性
  → ActionDM 定难度
  → Resolver 掷骰
  → OutcomeFacts
  → EventLog
  → Narrator / Dialogue
  → 观察者可见
```

### 5.2 竖切场景

沿用「泥板之夜」的最小版本：

- 一个房间（牢房/神庙二选一）；
- companion 阿岬（绑手、刀伤、低烧）；
- 一个 NPC（狱卒老石）；
- 一块泥板（用户信道）；
- 一条用户消息：“今晚别去集市。”
- 一个动作：读取/回应/拒绝；
- 一个世界后果：老石看见泥板/没看见；
- 一条叙述 + 一条回信。

### 5.3 任务

| ID | 任务 | 产出 | 依赖 |
|---|---|---|---|
| P3.1 | Intent/Demand 模型 | `Intent`、`ActionDemand`、`Outcome` | G2 |
| P3.2 | Compiler adapter | 具身 V3 compiler → demand；不判可行性 | P3.1 |
| P3.3 | WorldRuleSet | canon pack：物理/秘法/未注册 tag | P3.1 |
| P3.4 | ActionDM + Resolver | DM 白名单、C/D 分离、掷骰、结果分级 | P3.3 |
| P3.5 | EventPlan/Composer | actor plan、outcome facts、witnesses、traces | P3.4 |
| P3.6 | Narrator/Dialogue | claims ⊆ outcome/knownFacts；MetaScan | P3.5 |
| P3.7 | 竖切场景 | 单房间、单 NPC、单消息、单动作 | P3.5–P3.6 |
| P3.8 | 回放与报告 | 同 seed 日志一致；T1 代理 0 冲突 | P3.7 |

### 5.4 G3 通过条件

- 同 seed 两次运行事件日志/投影 hash 一致。
- 硬约束不通过时**不掷骰**，给世界内理由。
- DM 输入不含能力/身体/私有 thought；C/D 分离测试通过。
- Narrator 的 claims 全部来自 OutcomeFacts；T1 代理冲突 0。
- 用户消息原文逐字出现在 `ChannelEvent`，角色上下文无 `user` 角色。
- 单场景报告写入 `reports/vertical-slice.md`。

### 5.5 失败分支

- 链路太长导致无法定位：按“感知/编译/可行性/DM/判定/叙述”六段分别做 replay，不整体调试。
- DM 仍想看能力：改输入白名单，不靠提示词约束。
- Narrator 总想加戏：先只允许事实复述，风格后置。

---

## 6. M4：通信、记忆、人格

### 6.1 目标

把“一次性竖切”变成“可连续陪伴”：消息有延迟/暴露，记忆可追溯，人格可版本化。

### 6.2 任务

| ID | 任务 | 产出 | 依赖 |
|---|---|---|---|
| P4.1 | Channel 实体 | owner/kind/durability/charge/secrecy/exposed | G3 |
| P4.2 | ChannelInbox/Event | 原文逐字、延迟、完整性、暴露 | P4.1 |
| P4.3 | Channel Perception | 外层感知 + 原文；无 user 角色 | P4.2 |
| P4.4 | NPC 反应 | 旁人看见泥板 → 恐惧/告发/巫术嫌疑事件 | P4.3 |
| P4.5 | MemoryStore | 五类记忆、sourceEventId、salience、redacted | G3 |
| P4.6 | 固化 | 每日 1–2 次；claims ⊆ 已知事实；回退模板 | P4.5 |
| P4.7 | Persona | anchors/axes/version/delta/rollback/确认 | P4.5 |
| P4.8 | 主动消息 | 配额、静默时段、冷却、可打断 | P4.2 |
| P4.9 | 连续性测试 | T8/T9、跨会话召回、删除/导出 | P4.1–P4.8 |

### 6.3 G4 通过条件

- T8：角色输出/认知 0 次“用户/玩家/系统/AI/提示词/系统消息”。
- R-CH2：原文逐字；改动一个字即测试失败。
- 信道暴露产生至少一个世界事件；信道损坏导致失联，世界继续走。
- 五类记忆都有记录；每条带 `sourceEventId`；删除只标记 `redacted`。
- Persona 变化有版本、可对比、可回滚；单次/累计 delta 不超上限。
- 跨会话能复述至少 3 个早期事件；主动消息不超配额。

### 6.4 失败分支

- Channel 被做成“聊天框”：把延迟/暴露/不可用做成默认，不是选项。
- 记忆变成“模型自由写”：只允许 `MemoryRecord` 由事件/固化产生，LLM 只提案文本。
- Persona 漂移：先收紧锚点与 delta 上限，不靠提示词“保持人设”。

---

## 7. M5：存储、应用服务、宿主

### 7.1 目标

让世界在进程重启后连续；观察/消息有稳定接口；DSH 只是适配器。

### 7.2 任务

| ID | 任务 | 产出 | 依赖 |
|---|---|---|---|
| P5.1 | SQLite schema | worlds/events/snapshots/characters/facts/memories/channels/persona | G4 |
| P5.2 | EventStore adapter | append/read/snapshot/replay；迁移脚本 | P5.1 |
| P5.3 | 应用服务 | Scheduler（按 `ClockSpec` 的 `realtime` 推进）、Session、OfflineCatchUp、QueryService | P5.2 |
| P5.4 | Observer API | 只读投影；无 thought/秘密 | P5.3 |
| P5.5 | 消息 API | 只写 ChannelInbox | P5.3 |
| P5.6 | DSH adapter | pre-step、schedule、followup、tools restrict | P5.4–P5.5 |
| P5.7 | 故障恢复 | 崩溃/重启/重复消息/回放 | P5.2–P5.5 |

### 7.3 G5 通过条件

- 进程重启后，角色位置/记忆/关系/信道连续；事件日志可回放。
- 观察 API 不返回 thought/他人秘密；消息 API 不能直接改世界。
- 离线推进 1 天后，返回摘要与事件日志一致；没有“现场编过去”。
- `realtime` 按世界的 `timeScale` 推进；重启后锚点/lastTick 连续；暂停不补时长；长离线不跳 tick。
- 比例是世界级配置，不从环境变量或设备时间覆盖。
- DSH 适配器没有把 DSH 类型带进领域层；移除适配器后引擎仍可跑。
- T6：脱离宿主可读/导出。

### 7.4 失败分支

- SQLite 迁移拖慢：保留 JSONL 读写适配器，先做单世界 SQLite。
- 宿主耦合：用 contract test 在没有 DSH 的环境跑引擎；DSH 只做端到端 smoke。
- 观察 API 泄漏：默认最小字段，调试模式显式开启。

---

## 8. M6：产品验证与收口

### 8.1 目标

按 PRD 验收表跑一次真实的 7 天陪伴，决定 go/no-go。

### 8.2 任务

| ID | 任务 | 产出 | 依赖 |
|---|---|---|---|
| P6.1 | 7 天陪伴 | 真实时间 7 天；按世界 `ClockSpec` 比例推进；每日观察记录 | G5 |
| P6.2 | T1 处刑 | 强制结果 + 叙述冲突率；重伤/昏迷替代死亡 | G5 |
| P6.3 | T2/T3 | 长程对话不滑助手腔；早期事件召回 | G5 |
| P6.4 | T4 | 24h 无人自主行动 | G5 |
| P6.5 | T5 | 3 天成本/预算/降级 | G5 |
| P6.6 | T8/T9 | 入世框架、信念演化 | G5 |
| P6.7 | 内容/安全 | 分级、敏感内容、错误处理 | G5 |
| P6.8 | 评审 | 2 名评审：编年史/陪伴感 | P6.1 |
| P6.9 | 收口 | 演示脚本、README、报告、失败分支记录 | P6.1–P6.8 |

### 8.3 G6 通过条件

- T1 叙述/裁决冲突率 0；处刑后仍能扮演（用重伤/昏迷，不依赖 U2）。
- T3 长程后能复述早期事件；T4 24h 有自主行动。
- T5 连续 3 天不超预算；超限降级不中断。
- T8 0 次外部概念；T9 信念变化可解释。
- T7 主观：2 名评审中至少 1 名“愿意继续开”，且无人感到被索取。
- 数据可导出；移除宿主可读。

### 8.4 失败分支

| 失败 | 处理 |
|---|---|
| T1 冲突 >0 | 缩窄 Narrator 到事实复述；暂停风格化 |
| T7 失败 | 先改节奏/主动消息/沉默，不加大内容量 |
| T5 超支 | 砍 ambient 台词，保留 companion/focus；提高模板比例 |
| T3 召回差 | 先修记忆固化/检索，不先换更大模型 |
| T4 无自主 | 补日程/目标/事件唤醒，不用 LLM 随机补 |

---

## 9. 并行与团队分工

### 9.1 两人配置

| 人 | 主责 | 并行点 |
|---|---|---|
| A（内核/规则） | M1、M3、M5 的 event/resolver | M1 后开始 M3 的 Compiler/RuleSet |
| B（角色/连续性） | M2、M4、M6 的记忆/人格 | M1 后开始 M2；M3 后开始 M4 |

### 9.2 三人配置

- A：kernel/space/event/resolver
- B：character/body/memory/persona
- C：app/SQLite/API/DSH/observer
- QA/harness 由三人轮值；每周一次集成 gate。

### 9.3 一人配置

严格顺序：M0 → M1 → M2 → M3 → M4 → M5 → M6。

M6 的 7 天观察可以在 M5 开发后期用稳定分支并行启动，不要等全部代码写完再开始计时；但 G5 通过前的结果只作为预演，不作为最终验收。

---

## 10. 每步 Definition of Done

任何任务完成必须同时满足：

1. 代码 + 类型检查通过。
2. 单测/契约测试通过；跨 demo 回归通过。
3. 同 seed 回放一致（涉及事件/判定的任务）。
4. 报告/日志写进 `reports/` 或任务卡。
5. 文档更新：契约/行为变化改 `ARCHITECTURE.md` 或对应 DESIGN。
6. 没有新增密钥/真实 API 依赖；cassette 可回放。
7. 失败分支已记录：失败时是回退、延迟还是缩小范围。

---

## 11. 风险登记

| 风险 | 触发信号 | 处理 |
|---|---|---|
| 合并变重写 | demo 测试开始失败/被删 | 回退到 adapter；共享代码不反向依赖 demo |
| 事件 schema 漂移 | 旧日志读不回/回放分叉 | 事件版本 + 迁移测试；快照可重建 |
| 角色统一过度 | companion 与 NPC 被迫共用过多字段 | 保留策略组合；差异放 adapter |
| Channel 语义走样 | 出现 `user` 角色/即时聊天 | 先做原文/延迟/暴露测试，再做 UI |
| 记忆不可追溯 | 出现无 `sourceEventId` 的记忆 | 写入口拒绝；固化只允许引用事实 |
| Persona 漂移 | 长程滑回助手腔 | 锚点 + delta 上限 + 版本回滚 |
| DSH 耦合 | 领域层 import 宿主类型 | contract test 在纯 Node 跑；adapter 隔离 |
| 7 天测试拖期 | 等所有功能才开跑 | G4 后开稳定分支，M5 并行观察 |
| 成本失控 | 单日 >30 调用/降级频繁 | 模板优先；夜间真实调用；预算告警 |
| 主观质量差 | 评审“不像会发生的事” | 提高 salience/摘要/日程，不先换大模型 |

---

## 12. 首批两周（1 人示例）

| 天 | 任务 | 退出 |
|---|---|---|
| D1–D2 | P0.1–P0.5：verify、基线、契约、ADR | G0 |
| D3–D4 | P1.1–P1.2：kernel/space | 单测 + demo 仍绿 |
| D5–D6 | P1.3–P1.5：EventStore/Projection、demo 适配 | G1 |
| D7–D8 | P2.1–P2.2：Character/BodyProvider | 单测 |
| D9–D10 | P2.3–P2.4：Runtime/Capability | contract 初版 |
| D11–D12 | P2.5–P2.6：T0–T3 + CM 回归 | G2 |
| D13–D14 | P3.1–P3.2：Intent/Compiler | 竖切骨架 |

> 两人配置可把 M4 的 Channel 原型提前到 D9 之后，与 M2/M3 并行；但 M3 的 gate 不降级。

---

## 13. 明确不做

- 不做多用户/账号体系/真实社交平台。
- 不做多模态（立绘/语音/视频）。
- 不做图形地图/自由移动/战斗手感。
- 不做平台 SDK/插件市场。
- 不做大模型训练/微调。
- 不在 M3 前做完整 Web UI；观察面板先最小只读。

---

## 14. 一页结论

**顺序**：冻结 → 抽内核 → 统一角色 → 单房间竖切 → 通信/记忆/人格 → 存储/宿主 → 7 天验证。

**每步的停止条件**：G0–G6；任何 gate 失败，先走失败分支，不进入下一步。

**最重要的三个不要**：

1. 不要先做“大一统”重写；先抽已验证模块。
2. 不要让 LLM 写状态；它只提案/说话/总结。
3. 不要把用户消息做成聊天框；它是世界内的信道事件。

按这个方案，两个 demo 的已验证结论会变成产品骨架的回归测试，而不是被合并过程消耗掉。
