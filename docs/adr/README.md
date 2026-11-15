# 架构决策记录（ADR-1–9）

| 项 | 内容 |
|---|---|
| 状态 | P0 冻结；后续变更必须新增 ADR，不直接改写历史 |
| 依据 | [ARCHITECTURE.md](../ARCHITECTURE.md) §16、两个 demo 的验证结论 |
| 格式 | 状态 / 背景 / 决策 / 后果 / 证据 |

---

## ADR-1：EventLog 是唯一真相

- **状态**：Accepted
- **背景**：世界 demo 已证明事件日志可重建位置/价格/事实/信念；具身 demo 的判定日志也可重放。
- **决策**：所有 gameplay 状态变更必须经 `World.emit` → `EventStore.append` → `Projection.apply`。快照只是加速，不是第二真相。
- **后果**：回放、审计、T6 数据安全成立；写路径变长，需要明确 `Patch/Event` 边界；禁止规则直接改投影。
- **证据**：B2 668 事件、B3 760 事件可回放；同 seed hash 一致。

## ADR-2：规则 tick 同步，LLM 只在注意力点异步

- **状态**：Accepted
- **背景**：B3 的 3 天真实 LLM 运行证明预算内可跑；但每 tick 调 LLM 不可回放、成本不可控。
- **决策**：`CharacterRuntime.decide` 同步；LLM 的意图由 `Mind.propose()` 在玩家回合、focus、高 salience 事件等点异步执行，再把 `Intent` 交给 runtime。
- **后果**：规则 tick 确定、可回放；LLM 延迟不阻塞世界；需要显式的“注意力点”清单与预算。
- **证据**：B3 规则 tick 与 14 次角色对话可分离；cassette 回放一致。

## ADR-3：Compiler 不判可行性

- **状态**：Accepted
- **背景**：V3 证明自由动作可编译成 `ActionDemand + ontologyTags`；早期“编译器 reject 非物理动作”被用户明确否决。
- **决策**：Compiler 只输出需求/本体标签，不输出 verdict；可行性由 `WorldRuleSet` 按 canon 判定。
- **后果**：同一动作可在物理世界失败、在秘法世界成立；Compiler 不会把世界观写死；需要世界侧准入表。
- **证据**：V3 100/100 合法；本体依赖动作 tags-only；世界矩阵全过。

## ADR-4：DM 不看能力/身体

- **状态**：Accepted
- **背景**：具身 demo 证明“DC 是任务的属性，不是角色的属性”；DM 看能力会补偿弱者，抹平伤病效果。
- **决策**：ActionDM 只看意图、目标、环境、公开状态、canon；能力/身体只进 C；D 由规则基表 + DM 情境因素给出。
- **后果**：C/D 可分离测试；DM 输入白名单必须机器校验；提示词不能代替白名单。
- **证据**：A3/A4 方向；具身测试 C/D 分离；B3 Director 不看私有 thought。

## ADR-5：T0–T3 + 双预算

- **状态**：Accepted
- **背景**：世界 demo 证明 10 NPC + 2 群体可分层；B3 证明 3 天真实调用峰值 7/30。
- **决策**：T0–T3 按 importance 晋升/降级；角色 ≤22/日、Director ≤8/日、总 ≤30/日、单 tick K=3、offstage 0。
- **后果**：NPC 不必每 tick 调 LLM；需要 CharacterRecord/tombstone；预算超限必须降级而不是中断。
- **证据**：B3 13/13；CM-1/6/7；峰值 char 5、director 2、total 7。

## ADR-6：Channel 是世界实体

- **状态**：Accepted
- **背景**：PRD D5/T8 要求用户消息以世界内感知抵达；直接把 `user` 消息塞进上下文会破坏入世框架。
- **决策**：用户只写 `ChannelInbox`；`ChannelEvent` 带 `rawText`（逐字）+ 外层 `percept`；Channel 有 durability/charge/secrecy/exposure。
- **后果**：消息有延迟、会坏、会被看见；角色可以误解/拒绝；需要原文逐字测试与 MetaScan。
- **证据**：PRD R-CH1–R-CH7；世界 demo 的传闻/目击模型可复用。

## ADR-7：记忆事件溯源，删除只标记

- **状态**：Accepted
- **背景**：PRD P4 要求记忆可重建；用户又要能删除/导出。
- **决策**：`MemoryRecord` 必须带 `sourceEventId`；固化/删除只写新记录或 `redacted` 标记，不物理删除世界事实。
- **后果**：用户删除个人记忆不等于改写世界；需要导出/审计；LLM 不能凭空写记忆。
- **证据**：世界 demo 的 Belief 带 source；B3 CM-8 0 泄漏。

## ADR-8：宿主 adapter 不持有真相

- **状态**：Accepted
- **背景**：DESIGN §8 的 DSH 依赖过早耦合会把 A1/T6 变成“宿主能否改”。
- **决策**：领域层不 import DSH；宿主只做收消息、送感知、调度、通知；世界状态存 SQLite，不进 session 日志。
- **后果**：DSH 可替换；纯 Node 可跑；需要 adapter contract test。
- **证据**：两个 demo 目前都是纯 Node CLI。

## ADR-9：开发 JSONL，生产 SQLite

- **状态**：Accepted
- **背景**：demo 事件 <10k，JSONL 可读可 diff；产品需要跨进程查询与崩溃恢复。
- **决策**：开发/验证继续 JSONL + snapshot；生产用 SQLite（WAL）+ 同一 `EventStore` 接口；迁移前不做分布式。
- **后果**：M5 前不引入数据库依赖；需要 schema 版本/迁移测试；SQLite 不是第二真相。
- **证据**：B2/B3 的 JSONL 回放；WB-8 数据安全。

---

## 变更规则

- 新增决策：`ADR-10+`，不改写 ADR-1–9。
- 推翻旧决策：新增 ADR，状态 `Supersedes ADR-x`，并在旧 ADR 标 `Superseded by ADR-y`。
- 任何实现变更如果违反 ADR，先改 ADR，再改代码。
