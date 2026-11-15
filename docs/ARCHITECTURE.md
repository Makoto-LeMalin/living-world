# Living World · 整体架构（v1.0）

| 项 | 内容 |
|---|---|
| 版本 | v1.0（2026-11-15） |
| 状态 | 架构提案，待评审；与 PRD 冲突时以 PRD 为准 |
| 上游 | [PRD.md](PRD.md)、[DESIGN.md](DESIGN.md)、[DEMO_PLAN.md](DEMO_PLAN.md)、[CHARACTER_MODEL.md](CHARACTER_MODEL.md) |
| 执行计划 | 逐步任务、依赖与门见 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) |
| 依据 | 具身 demo（100 测试）、世界 demo（67 测试、B2 12/12、B3 13/13）、共享内核（27 测试）的实测结论 |
| 范围 | 引擎、角色、世界、LLM、通信、存储、宿主、验证；不含排期与商业决策 |
| 不做什么 | 多用户、真实社交平台、多模态、图形地图、平台 SDK、模型训练 |

---

## 0. 结论先行

Living World 的整体架构可以压成一句话：

> **一个不可变的、以事件为唯一真相的世界内核；一套 PC 与 NPC 共用的角色运行时；一组只提案、不写状态的 LLM 服务；一个把用户消息变成世界内感知的信道层。**

具体有五条硬边界：

1. **世界持有真相。** `EventLog` 是唯一写路径；位置、库存、价格、关系、信念、记忆都是事件的投影，不是另一份可随手修改的状态。
2. **意图与结果分离。** 角色只产生 `Intent`；`Compiler` 只把它翻译成 `ActionDemand`，不判“能不能”；可行性由世界规则按 canon 判定；难度由 `ActionDM` 给出；结果由规则掷骰。
3. **身体是约束，不是提示词。** 硬约束不通过就不掷骰，给世界内理由；能力值只进 `C`，永远不进 `D`。
4. **LLM 只在注意力点上出现。** 规则 tick 同步、确定、零 LLM；玩家回合、focus 对话、高 salience 事件才进入异步 LLM 路径，并受预算/回退/cassette 约束。
5. **用户不是角色。** 用户是“装置另一头的声音”，只通过 `Channel` 进入世界；不建模用户身体，不把 `user` 角色直接塞进角色上下文。

### 0.1 当前落地程度

| 能力 | 状态 | 证据 / 缺口 |
|---|---|---|
| 身体、约束、能力、判定、叙述 | ✅ 已验证 | 具身 demo 100 测试；V3 16/16 |
| 事件日志、事实/信念、三源、A→B→A | ✅ 已验证 | 世界 B2 12/12；668 事件 |
| CharacterRuntime、T0–T3、群体、双预算 | ✅ 已验证 | 世界 B3 13/13；760 事件 |
| 完整 3 天真实 LLM + cassette | ✅ 已验证 | 4 Director + 14 角色对话；0 miss |
| Channel、用户消息入世 | 🟡 只有设计与局部测试 | 尚无产品级 Channel 实体/延迟/暴露 |
| 五类记忆、固化、删除/导出 | 🟡 部分（Belief/事件溯源） | 尚无 MemoryStore/固化/用户控制 |
| Persona 锚点、版本、回滚 | 🟡 只有设计 | 尚无版本化 delta/确认 |
| SQLite、服务端、观察面板 | ⬜ 未做 | 当前 JSONL + CLI |
| DSH 宿主适配 | ⬜ 未做 | 先保持引擎独立 |

这张表决定迁移顺序：先把 ✅ 的模块抽成共享包，再补 🟡，最后接 ⬜；不要为了“整体”先重写已验证部分。

---

## 1. 需求到架构的映射

### 1.1 不可违反的架构约束

| 需求 | 架构约束 | 落点 |
|---|---|---|
| P1 世界持有真相 | 所有 gameplay 状态只能由 `World.emit` 写入；投影可重建 | `EventLog` / `WorldProjection` |
| P2 意图与结果分离 | `Intent` 不含结果；`EventPlan.direction` 不含成功/失败；结果由 resolver 产生 | `Intent` / `EventPlan` / `Resolver` |
| P3 身体是约束 | 硬约束在掷骰前短路；能力值只进 `C` | `Constraint` / `Capability` |
| P4 记忆可重建 | 记忆带 `sourceEventId`，不能凭空写；删除只删个人记忆，不改世界事实 | `MemoryRecord` |
| P5 未知优于全知 | 心智只拿 `Perception`，不拿全局 `WorldState`；信念可错、可缺 | `Perception` / `Belief` |
| P6 陪伴不索取 | 主动消息有配额与静默时段；世界不因用户离开而停 | `Channel` / `Scheduler` |
| P7 配置可见 | 配置随存档；会破坏一致性的选项必须显式命名 | `WorldConfig` / `SaveFile` |
| D5 消息入世 | 用户原文逐字保留在外层感知中；角色认知里没有“用户/消息”概念 | `ChannelEvent` |
| D6 观察受限 | 观察面板只读投影，不显示 thought / 他人秘密 | `ReadModel` |
| D7 角色可主动开口 | 主动消息是 `Intent`，受配额、延迟、可打断 | `ProactivePolicy` |

### 1.2 验收目标对应的架构位置

| 验收 | 架构责任 |
|---|---|
| T1 叙述/裁决不冲突 | `OutcomeFacts` 由 resolver 生成；`Narrator` 的 claims 强制 ⊆ outcome |
| T2 不滑回助手腔 | `Persona` 锚点 + `Narrator/Dialogue` 的元词扫描 + 版本化演化 |
| T3 长程召回 | `MemoryStore` + 事件溯源 + 每日固化 |
| T4 无人 24h 自主 | `Scheduler` + `NpcRuntime` + `T0–T3` LOD |
| T5 成本上限 | `Budget` 分角色/世界两类，超限降级不中断 |
| T6 数据安全 | 事件日志/快照/canon 独立于宿主；纯 Node 可读 |
| T7 陪伴不负担 | `Channel` 延迟/静默/配额 + 主动消息策略 |
| T8 入世框架 | `ChannelEvent` 是唯一入口；`MetaScan` 阻断外部概念 |
| T9 信念演化 | `Belief` 版本 + `ChannelTheory` 可解释更新 |

---

## 2. 两个 demo 已经证明什么、还缺什么

### 2.1 具身 demo 的可复用结论

| 结论 | 证据 | 进入整体架构的方式 |
|---|---|---|
| 硬约束必须前置 | 反绑时 `take` 直接不可尝试，不给高 DC 假装 | `ConstraintEngine` 在掷骰前返回 `not_attemptable` |
| 能力值只进 C | DM 不看能力；C 由身体派生 | `CapabilityProvider` 与 `ActionDM` 输入白名单 |
| 自由动作可编译成需求而不拒绝 | V3 100/100 合法；本体依赖动作只产出 tags | `ActionCompiler` 输出 `ActionDemand`，不输出 verdict |
| 世界规则决定可行性 | 物理/秘法/未注册 tag 的准入在世界侧 | `WorldRuleSet` 是可行性权威，不是编译器 |
| 叙述必须被事实约束 | ClaimCheck 拦新增状态谓词 | `Narrator` 只润色 `OutcomeFacts` |
| 判定可回放 | 同 seed 同 check、日志可重放 | `RNG` 分流 + 事件日志 |

**不能直接搬的部分**：具身 demo 是单房间脚本，没有世界传播、没有 NPC 社会、没有跨会话记忆。它证明的是“身体/判定/叙述”这一段的正确性。

### 2.2 世界 demo 的可复用结论

| 结论 | 证据 | 进入整体架构的方式 |
|---|---|---|
| EventLog 单一写路径 | B2 668 / B3 760 事件可重建、可回放 | `EventStore` 是唯一 append |
| Fact / Observation / Belief 三分 | 知识边界 0 泄漏；传闻可错 | `FactStore`、`KnowledgeBase` 分离 |
| EventPlan 方向先定、细节后补 | 三源事件、计划状态机 | `PlanScheduler` + `EventComposer` |
| 自然/主动/特殊三源 | ambient/actor/special 都有 provenance | `EventSource` 分流 |
| T0–T3 LOD | 完整 3 天 P1/D2；群体 1 次个体化+合并 | `AttentionScheduler` |
| 双预算 | B3 峰值 7/30，offstage 0 | `Budget` 两类调用分开记账 |
| 世界离开后继续 | A→B→A 的 ReturnDiff/Echo | 离线推进 + 投影/事件差分 |

**不能直接搬的部分**：世界 demo 的 `pc_observer` 是脚本替身，不是产品角色；世界 NPC 的动作 100% 规则，LLM 只说话。整体架构要把“角色心智”接到同一套身体/判定/事件上。

### 2.3 合并后必须补齐的四块

1. **一个角色，两个身体视角**：产品 companion 同时拥有物理身体（具身 demo）和社会身份（世界 demo）。
2. **同一套 CharacterRuntime**：companion 和 NPC 共用接口，差异只在策略、信道、身体详细度。
3. **通信/记忆/人格**：两个 demo 都只做了局部；产品连续性靠 `Channel`、`MemoryStore`、`PersonaVersion`。
4. **宿主适配与生产存储**：从 CLI/JSONL 走向 SQLite/服务端，但不把宿主写进领域层。

---

## 3. 总体分层

```
┌──────────────────────────────────────────────────────────────┐
│ 宿主/表现层                                                   │
│  DSH 适配器 · CLI · HTTP/WS · 观察面板 · 通知                 │
│  只读 ReadModel；用户消息只写 ChannelInbox                     │
└───────────────────────────────┬──────────────────────────────┘
                                │ ChannelEvent / ReadModel
┌───────────────────────────────▼──────────────────────────────┐
│ 应用层                                                        │
│  SimulationService · Scheduler · SessionManager · QueryService │
│  Budget · Attention · OfflineCatchUp · ProactivePolicy        │
└───────────────────────────────┬──────────────────────────────┘
                                │ domain commands
┌───────────────────────────────▼──────────────────────────────┐
│ 领域层                                                        │
│  World · CharacterRuntime · Body · Mind · Persona · Memory    │
│  Perception · Rules · Constraints · EventPlan · Resolver      │
└───────────────────────────────┬──────────────────────────────┘
                                │ EventLog / Snapshot
┌───────────────────────────────▼──────────────────────────────┐
│ 基础设施层                                                    │
│  Kernel(clock/rng/ids) · Space · EventStore · Projection      │
│  LLMGateway · Cassette · SQLite/JSONL · Harness · Telemetry   │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 依赖方向

- 宿主 → 应用 → 领域 → 基础设施。
- 领域层**不 import** 宿主、不 import DSH、不 import Web。
- LLM 适配只在基础设施层；领域层只依赖 `LlmPort` 抽象。
- `ReadModel` 只能读投影，不能反向写世界。
- `ChannelInbox` 是宿主唯一能写的入口；它写的是“信道事件”，不是世界事实。

### 3.2 模块职责

| 模块 | 负责 | 不负责 |
|---|---|---|
| `kernel` | 时钟、tick、RNG 分流、ID、规范化 JSON、快照 | 剧情、语义 |
| `space` | 区域/聚落/房间、路线、可见可听、遮挡 | 网格、连续物理 |
| `world` | canon、Fact、Trace、Projection、EventPlan | 角色心智 |
| `characters` | Character、Body、Mind、Persona、Memory、Runtime | 世界生成 |
| `rules` | 约束、能力、难度、判定、经济、法律、火灾、传闻 | LLM 编排 |
| `perception` | 把世界过滤成角色可感知的 `Perception` | 自然语言 |
| `llm` | 各角色服务的 prompt/校验/预算/cassette | 写状态 |
| `app` | tick 循环、会话、离线推进、查询、通知 | 领域规则 |
| `host` | DSH/CLI/HTTP 适配 | 世界真相 |
| `harness` | Meta/Claim/Leak/Invariant/Replay/Metrics | 产品 UI |

M1 已落地的共享模块：`src/kernel/`（clock/rng/ids/canonical-json/snapshot）、`src/space/`（Space）、`src/world/`（EventStore/Projection 契约）、`harness/`（replay/invariant）。两个 demo 已改为依赖这些入口，`demos/world/src/kernel/` 已删除；兼容性证据见 [M1.md](M1.md)。

---

## 4. 核心契约

### 4.1 Event：唯一写路径

```ts
interface WorldEvent {
  id: string;
  tick: number;
  type: string;
  actorId?: string;
  roomId: string;
  placeId: string;
  witnesses: string[];
  sourceEventIds: string[];
  visibility: "private" | "room" | "place" | "public";
  facts: Fact[];
  traces: Trace[];
  payload: Record<string, unknown>;
  provenance: {
    source: "ambient" | "actor" | "special" | "system";
    planId?: string;
    proposalId?: string;
    model?: string;
    seed?: string;
    ruleVersion: string;
    injected?: boolean;
  };
}
```

规则：

- 事件不可变；修正历史只能追加 `FactStatusChanged` / `BeliefRevised` / `Lie` 等事件。
- `witnesses` 在 emit 时计算，不是事后猜。
- 所有 gameplay 事件带 provenance；`injected` 只允许用于“起火点/盗窃尝试”这类种子，不允许决定结果。
- LLM 不能直接构造 `WorldEvent`；只能产出 proposal / speech / summary，由规则层转成事件。

### 4.2 Fact / Observation / Belief

```ts
interface Fact {
  id: string;
  kind: "crime" | "fire" | "trade" | "law" | "weather" | "relationship" | "event" | "suspicion" | "testimony";
  subjectId: string;
  objectId?: string;
  placeId: string;
  detail: Record<string, string | number | boolean | string[]>;
  status: "active" | "resolved" | "superseded";
  salience: number;
  summary: string;
  sourceEventId: string;
  validFromTick: number;
  validToTick?: number;
}

interface Observation {
  factId: string;
  observerId: string;
  channel: "sight" | "hearing" | "rumor" | "inference";
  confidence: number;
  sourceEventId: string;
  learnedAtTick: number;
}

interface Belief {
  factId: string;
  content: string;       // 允许与 canonical detail 不同
  confidence: number;
  sourceEventId: string;
  learnedAtTick: number;
  version: number;
  hops: number;          // 传闻最多 5 跳
  originPlaceId: string;
  suspectId?: string;
}
```

- `Fact` 是世界真相，只有规则/事件能写。
- `Observation` 是“谁在什么信道看到了什么”。
- `Belief` 是角色版本，可错、可旧、可矛盾。
- 角色上下文只装配 `Belief` + `Perception`，不装配全局 `Fact` 列表。
- 传闻必须带 `factId` 或 `basisEventId`；没有来源的断言不能进入知识库。

### 4.3 Intent / ActionDemand / Outcome

```ts
interface Intent {
  verb: string;          // 12 动词 + profile；自由动作先编译
  targetId?: string;
  instrumentId?: string;
  manner?: string;
  goal?: string;
  source: "mind" | "script" | "utility" | "channel";
}

interface ActionDemand {
  actionId: string;
  verb: string;
  dims: Record<string, number>;     // 14 维，0..100
  assist: Record<string, number>;
  ontologyTags: string[];           // 本体依赖，交给世界规则判断
  channels: string[];               // 发声/视觉/触觉等
}
```

关键边界（来自 V3 的教训）：

- **Compiler 不判可行性。** 它只输出“这个动作需要什么”；`ontologyTags` 可以包含“需要神术/需要水下呼吸”，但不由它拒绝。
- **世界规则判可行性。** 物理世界拒绝、秘法世界允许、未注册 tag 默认拒绝；拒绝理由必须是世界内的。
- **DM 不看能力/身体。** DM 只给环境难度、因素、分支；C 由角色身体算。
- **结果只由 Resolver 产生。** `Outcome` 包含成功/失败/部分成功、伤害、痕迹、目击、事实草案；Narrator 只能润色。
- **维度表是版本化 pack，不是世界公理。** 14 维只是当前 pack；正式版可以增删/映射。**不能用“维度表里没有”来判一个动作不可能**——只能交给世界规则解释。

### 4.4 CharacterRuntime：PC 与 NPC 共用

```ts
interface CharacterRuntime {
  readonly id: string;
  readonly kind: "companion" | "npc" | "crowd";

  perceive(world: WorldView, level: LodLevel): Perception;
  decide(ctx: DecisionContext): Intent | null;
  act(intent: Intent): ActionResult;
  onEvent(event: WorldEvent): void;
  snapshot(): CharacterSnapshot;
}
```

实现差异只用策略组合：

| 策略 | companion | T0 NPC | T1 NPC | T2 NPC | T3 crowd |
|---|---|---|---|---|---|
| `decision` | LLM Mind + 规则 | 规则 + focus 对话 | 规则 | 日程/utility | aggregate |
| `body` | full | full/summary | summary | needs only | aggregate |
| `memory` | full | full/summary | summary/index | index | crowd stats |
| `perception` | detailed | detailed | coarse | coarse | aggregate |
| `channel` | 用户信道 | 无 | 无 | 无 | 无 |
| `llm` | 每回合/主动 | focus 对话 | 事件对话 | 直接交互 | 群体摘要 |

**重要修订**：`decide` 保持同步，保证规则 tick 可确定回放；LLM 的“想做什么”由 `Mind.propose()` 在异步注意力点先算，再把 `Intent` 交给 runtime。这样不会让每个 tick 都变成 async/不确定。

```ts
interface Mind {
  propose(perception: Perception, memory: MemoryView, persona: PersonaView): Promise<Intent | null>;
}
```

### 4.5 Perception：心智的唯一输入

```ts
interface Perception {
  self: { id: string; body: BodyView; social: SocialView };
  place: { regionId: string; settlementId: string; roomId: string; light: string };
  present: EntityView[];
  audible: AudibleEvent[];
  visibleFacts: FactView[];
  channelEvents: ChannelEventView[];
  gaps: string[];          // “墙后看不见”“听不清”
  uncertainty: number;     // 0..1
}
```

- `Perception` 由 `PerceptionBuilder` 从投影 + 角色知识 + 信道生成。
- 它必须包含**缺口**，而不是假装全知。
- `thought` 永不进 `Perception`；用户的原文只在 `ChannelEvent.rawText` 中，角色看到的是外层感知 + 引号原文。

### 4.6 CharacterRecord：降级后的压缩

```ts
interface CharacterRecord {
  id: string;
  name: string;
  role: string;
  tier: "T0" | "T1" | "T2" | "T3";
  identityHash: string;
  relationships: Record<string, Relationship>;
  keyMemories: MemoryRecord[];
  needs: Needs;
  mood: Mood;
  currentRoomId: string;
  schedule: ScheduleBlock[];
  lastState: string;
  lastTick: number;
  tombstone: boolean;
}
```

- 降级丢逐部位细节与低权重 observation，保留身份/关系/关键记忆/位置/日程。
- 晋升恢复关键记忆；`identityHash` 保证“还是同一个人”。
- 曾被观察过的角色保留 tombstone；从未观察且远离才允许回收。

---

## 5. 运行时主循环

### 5.1 两类时钟

| 时钟 | 用途 | 规则 |
|---|---|---|
| `WorldClock` | 世界 tick，默认 10 世界分/tick，144 tick/日 | 只由 Scheduler 推进；回放按 tick |
| `SessionClock` | 真实时间/会话节奏 | 可暂停、加速、回看；映射到 WorldClock，不直接改世界 |

**应用运行时按现实时间等比推进**；比例属于世界记录，不是进程配置：

```ts
interface ClockSpec {
  mode: "stepped" | "realtime"; // 开发/回放用 stepped；应用用 realtime
  tickMinutes: number;          // 10
  ticksPerDay: number;          // 144；tickMinutes * ticksPerDay 必须 = 1440
  timeScale: number;            // 世界时间 / 现实时间；60 = 现实 1 分钟推世界 1 小时
  maxCatchUpTicks: number;      // 单轮最多补多少 tick；0 = 不限
  advanceWhenEmpty: boolean;    // 无人在线是否继续推进
}
```

- 映射从锚点直接计算：`tick = epochTick + floor((now - epochRealMs) * timeScale / (tickMinutes * 60000))`。不做增量累加，避免长跑漂移。
- `stepped` 由测试/CLI/replay 直接推进 tick，不读挂钟；`realtime` 才由宿主按现实时间调用 `dueTicks()`。两者 tick 语义相同。
- `maxCatchUpTicks` 只限制单轮工作量；超出的 backlog 按 tick 顺序下一轮继续，**不跳过**。
- 暂停冻结世界时间；恢复时平移锚点，暂停时长不补给世界。暂停状态与锚点一起持久化。
- 改比例只影响之后的推进速度，不重算历史 tick，也不改写已发生事件；变更记入世界配置版本。
- 领域层不调用 `Date.now()`：宿主传入 `realMs`，保证测试与回放可注入。

用户不使用时，`SessionClock` 可以停，但 `WorldClock` 仍可按 `advanceWhenEmpty` 离线推进；下次进入时补一段“这段时间发生了什么”的摘要。**补的是已发生的事件，不是现场编一段。**

### 5.2 每 tick 的顺序

```
1. WorldClock.advance()
2. due schedules / 需求/情绪慢变量
3. due EventPlan: pending → resolving
4. NPC 规则决策（NpcRuntime）
5. ambient hazard 判定
6. 高 salience/特殊事件：WorldDirector（异步、预算内）
7. 结算/Composer：facts/traces/witnesses → EventLog
8. 投影更新（位置/库存/价格/关系/信念/气候）
9. 每小时：importance/LOD 重算、传闻 pulse、价格
10. 每日：睡眠固化、预算归零、tombstone 清理
```

### 5.3 异步注意力点

规则 tick 不 await LLM。只有以下点进入 `async`：

- 玩家发来一条 `ChannelEvent`，且 companion 醒着/能感知；
- T0 NPC 与 companion 同房间并被直接互动；
- 高 salience 自然/特殊事件需要 WorldDirector；
- 每日固化/长摘要；
- 主动消息评估。

每点都有预算、超时、回退；失败不阻塞世界 tick。

### 5.4 离线推进

```ts
interface OfflineCatchUp {
  fromTick: number;
  toTick: number;
  mode: "fine" | "coarse" | "cold";
  maxEvents: number;
  llmBudget: 0;            // 默认 0，避免离线烧钱
}
```

- 先按规则快进；高 salience 事件只保留计划/事实，不调用 LLM 编故事。
- 回到焦点时，先给角色一个 `ReturnSummary`（从事件/事实生成），再进入 focus。
- 不能用“回来后现场生成”替代离线事件；这是 P1 的底线。

---

## 6. 角色架构：一个角色，三个身体

### 6.1 Character 数据

```ts
interface Character {
  id: string;
  kind: "companion" | "npc" | "crowd";
  identity: Identity;          // 名字、角色、声音、锚点
  persona: PersonaState;       // 可变价值/态度/禁忌
  body: BodyState;             // 物理身体
  social: SocialState;         // 关系、名声、阵营、可见状态
  mind: MindState;             // 目标、情绪、注意、记忆索引
  presence: Presence;          // 位置、可见性、群体归属
  schedule: ScheduleBlock[];
  tier: "companion" | "T0" | "T1" | "T2" | "T3";
}
```

### 6.2 三个身体

| 身体 | 数据 | 作用 |
|---|---|---|
| 物理身体 | 部位、伤、饿、累、醉、束缚 | 硬约束 + 能力值 C |
| 现象身体 | 内感受、感知缺口、疼痛描述 | 角色只能看到定性描述，不看数字 |
| 社会身体 | 伤口、衣着、名声、阵营、通缉 | NPC 对它的反应；传闻先于见面 |

companion 用 full body；T0 NPC 可以 full/summary；T1 summary；T2 只保留 needs；T3 用群体统计。**同一 `BodyState` 类型，不同 `detailLevel`。**

### 6.3 Companion 与 Observer

- `Companion` 是产品角色，拥有 `Mind`、`Channel`、full body。
- `Observer` 是 UI/读模型，不是 Character；它没有身体、没有意图、不能写世界。
- 世界 demo 的 `pc_observer` 只是测试替身；合并时替换为 `ScriptedCompanion` 或 `CompanionRuntime`，不把 observer 当产品 PC。

### 6.4 T0–T3

- T0：永久/半永久，full/summary memory，focus 时 LLM 对话，规则决策。
- T1：区域内存续，summary/index，事件对话。
- T2：背景，index，只有被直接交互才升级。
- T3：群体，aggregate；一次判定作用于分布；被点名成员个体化。
- 晋升 0.7 / 降级 0.4 / 冷却 1 世界日；importance 每小时算一次。
- 任何层级变化写 `CharacterTierChanged`；降级写 `CharacterRecord`。

---

## 7. 世界与事件

### 7.1 事实的生命周期

- `Fact` 不删除，只 `active → resolved → superseded`。
- 每次状态变化发 `FactStatusChanged`，保留 `validFrom/validTo`。
- 拘禁不会抹掉盗窃事实；价格/关系/传闻仍可引用。
- `Trace` 是可见证据：新锁、血迹、烧痕、告示；带 `sourceEventId`。

### 7.2 EventPlan

```
proposed → validated → scheduled → pending → resolving → resolved
                                      └──→ aborted
```

- `direction` 在计划创建时定；细节在 `resolved` 时补。
- `EventValidator` 验 ID/地点/时间/类型/canon/预算/隐私。
- `pending` 检查前置条件（人还在、门还锁、库存还有）；不成立就 abort/重排。
- 同一 plan 可被更高优先级 plan 替代（清洗期间集市日照常，但巡逻覆盖）。

### 7.3 三源事件

| 来源 | 发起 | 方向 | 推演 | 例子 |
|---|---|---|---|---|
| `ambient` | 地区压力/环境 | 触发时 | hazard + WorldDirector | 雾、渡船、火灾、疫病、塌方 |
| `actor` | companion / T0 / T1 | 意图/计划创建时 | ActionDM + 判定 | 偷窃、纵火、抓捕、交易、逃跑 |
| `special` | canon / 议程 / 导演 | 世界构建/弧线触发时 | canon 或 WorldDirector | 集市日、税日、清洗、葬礼、瘟疫 |

自然事件没有主动 actor；WorldDirector 不能借自然事件生成“某人决定去偷”。

### 7.4 WorldDirector 与 ActionDM

| | WorldDirector | ActionDM |
|---|---|---|
| 问题 | 世界上可能发生什么 | 这个意图在这个情境下多难 |
| 输入 | canon、地区摘要、时间/压力、允许类型 | 意图、目标、环境、公开状态、canon |
| 不看 | PC 私有 thought、NPC 隐藏记忆、未公开能力 | 角色能力/身体/私有 thought |
| 输出 | type/place/room/direction/stakes/branches | direction/stakes/difficulty/opposition/branches |
| 不输出 | 成功/失败、actor 主动事件 | 成功/失败、状态写入 |
| 校验 | EventValidator；非法回退模板 | schema + 因素白名单；非法回退规则基表 |

### 7.5 EventComposer

`resolved` 时补：

- 具体谁看见（witnesses）；
- 损失/价格/伤势；
- facts/traces；
- 目击者/行动者的 Belief；
- 可选的 RumorPacket；
- 可选的 Narrator 文本（claims 必须 ⊆ outcome）。

Composer 可以走模板；需要文风时可选 LLM，但不能新增 canonical fact。

---

## 8. 通信与陪伴

### 8.1 Channel 是世界实体

```ts
interface Channel {
  id: string;
  ownerId: string;             // companion
  kind: "tablet" | "dream" | "omen" | "letter";
  durability: number;          // 会坏
  charge: number;              // 会耗尽
  secrecy: number;             // 会被旁人看见
  knownBy: string[];
  exposed: boolean;
}
```

### 8.2 用户消息的路径

```
User text
  → ChannelInbox.append(rawText, receivedAt)
  → ChannelEvent {
      channelId, rawText,      // 原文逐字
      percept: "泥板上慢慢浮出几行字……",
      delayTicks, integrity, exposure
    }
  → 到达 companion 的 Perception.channelEvents
  → Mind 解释（神谕/祖灵/巫术/幻觉），决定信/怕/听/拒绝
  → Intent（读/回/藏/毁/问）
  → 规则/判定/世界事件
```

硬规则：

- 不得把 `role:"user"` 的消息直接塞进角色上下文；角色看到的是 `ChannelEventView`。
- 原文逐字保留；外层感知可以增加“字迹残缺/泥板发热”等，但不能改写原文。
- 回复是 `speak/write` 动作，有耗时、可被打断、可被旁观。
- 信道暴露会引发他人反应（恐惧、告发、巫术嫌疑）；损坏会失联；失联时世界继续走。
- 主动消息有配额（建议 ≤3/日）、同类冷却（≥6 世界小时）、静默时段。

### 8.3 关系三轴

- 信任、依赖、隐瞒；只对用户呈现为模糊描述，不显示数值。
- 角色可以拒绝、沉默、说谎；理由必须来自处境（怕、伤、不信任），不能来自“为了戏剧性”。
- 每次关系变化写 `RelationshipChanged`，带 `sourceEventId`。

### 8.4 一次消息的完整链路

```
用户写：“今晚别去集市。”
  │
  ├─ Host → ChannelInbox（原文、收到时间）
  ├─ ChannelEvent（延迟 3 tick，integrity=0.9，rawText 逐字）
  │
  ├─ tick+3：Perception.channelEvents = [{
  │     percept: "泥板边缘发热，浮出几行歪斜的字",
  │     rawText: "今晚别去集市。"
  │   }]
  │
  ├─ Mind：按 ChannelTheory 解释（神谕？有人在警告？）
  │    → Intent { verb: "speak", target: channel, goal: "问清是谁" }
  │
  ├─ Compiler → ActionDemand（发声/读写/本体标签）
  ├─ WorldRuleSet：嘴是否 free、泥板是否可见、是否被旁人看见
  ├─ ActionDM：环境难度（昏暗/有人在旁/手被绑）
  ├─ Resolver：C（身体）× D（环境）→ 掷骰
  │
  ├─ OutcomeFacts：字迹是否被读出、是否被狱卒看见、是否留下痕迹
  ├─ EventLog：ChannelRead / Spoke / Trace
  ├─ 旁人 Perception：可能看见“他在对一块泥板说话”
  │
  └─ 回复路径：Intent(speak/write) → 判定 → ChannelEvent(outbound)
       → 延迟到达用户；期间可被打断/夺走/失效
```

这条链路同时覆盖 T8（入世框架）、R-CH1/2（原文逐字、无 user 角色）、P3（手被绑不能写）、P5（旁人只看到现象，不知道内容）。

---

## 9. 记忆、人格与连续性

### 9.1 五类记忆

| 类型 | 例子 | 主要来源 |
|---|---|---|
| 情景 | “那天集市有人偷面包” | 目击/事件 |
| 语义 | “守卫叫罗恩” | 观察/传闻/文化默认 |
| 关系 | “玛拉欠我一次” | 互动/承诺 |
| 身体 | “左臂的伤阴天会疼” | 身体状态/内感受 |
| 承诺/债务 | “我答应替她带话” | 对话/事件 |

### 9.2 MemoryRecord

```ts
interface MemoryRecord {
  id: string;
  ownerId: string;
  kind: "episodic" | "semantic" | "relationship" | "body" | "commitment";
  text: string;                 // 主观版本，允许与 fact 不同
  sourceEventId: string;        // 必须可追溯
  factIds: string[];
  salience: number;
  confidence: number;
  createdAtTick: number;
  lastRecalledAtTick?: number;
  consolidatedInto?: string;
  redacted?: boolean;           // 用户删除/导出
}
```

- 记忆必须能从事件重建；不能凭空写。
- 遗忘 = 显著度衰减 + 定期固化；不能无限堆积。
- 允许误差（默认关）：只错细节，不错关键事实；误差也带 source。
- 用户可查看、删除、导出；删除只删个人记忆，不改世界事实。
- 跨会话连续：存档带记忆索引；会话只是宿主概念，不是世界边界。

### 9.3 固化

- 每天睡眠时 1–2 次：把当日高 salience 事件压缩成 summary，低 salience 衰减。
- 固化可以走 LLM，但必须 claims ⊆ 已知事实；失败回退模板/抽取式摘要。
- 固化结果写 `MemoryConsolidated`，保留原始事件引用。

### 9.4 Persona

```ts
interface PersonaState {
  version: number;
  anchors: { values: string[]; taboos: string[]; voice: string };
  axes: Record<string, number>;       // 0..1，可演化
  updatedAtTick: number;
  sourceEventIds: string[];
}
```

- 锚点不可变；可变轴单次/累计变化有上限。
- 每次变化有版本、可对比、可回滚；默认需用户确认。
- 变化必须可解释：能说出“因为那件事，我变了”。
- LLM 只提案 `PersonaDelta`；规则层 clamp 后写 `PersonaChanged`。

---

## 10. LLM 服务层

### 10.1 角色表

| 服务 | 输入 | 输出 | 校验 | 预算 |
|---|---|---|---|---|
| `IntentCompiler` | 自由文本意图 + profile | `ActionDemand`（dims/assist/ontologyTags） | schema；不判可行性 | 角色 |
| `ActionDM` | intent + 环境 + canon | difficulty/factors/branches | 白名单；不含能力/身体 | 角色/世界按调用点 |
| `WorldDirector` | canon + 地区摘要 + 时间/压力 | EventProposal | EventValidator；无结果/无 actor | 世界 ≤8/日 |
| `Narrator` | OutcomeFacts + body | 1–2 句文本 + claims | claims ⊆ outcome；MetaScan | 角色 |
| `Dialogue` | Perception + Belief + relationship | speech/claims/tone | claims ⊆ knownFacts；MetaScan | 角色 ≤22/日 |
| `MemoryConsolidator` | 当日事件/记忆 | summary + factIds | 不得新增 fact；可回退 | 每日 1–2 次 |
| `Name/Flavor` | canon/seed | 名称/风味 | 生成即冻结，之后不调用 | 离线 |

### 10.2 输入白名单

- `ActionDM`：意图、目标、环境、公开状态、canon；**不看**能力、身体、私有 thought。
- `WorldDirector`：canon、地区摘要、时间/压力、允许类型；**不看** PC thought、NPC 隐藏记忆、未公开能力。
- `Narrator`：OutcomeFacts、身体现象、场景；**不看**全局秘密。
- `Dialogue`：自己的 Perception、knownFacts、关系、mood；**不看**全局 Fact 列表。
- 任何 LLM 输出都不能直接写 `WorldState`；只能变成 proposal/speech/summary，由规则层校验后 emit。

### 10.3 预算与降级

- 角色对话 ≤22/日；WorldDirector ≤8/日；总 ≤30/日；每 tick 最多 K=3 个角色。
- 超限：低 salience 走模板；高 salience 延迟到下一窗口；写 `BudgetDegraded`。
- 连续非法/超时：回退模板；不中断世界 tick。
- `deepseek-flash` 默认；`deepseek-v4-pro` 可用于 DM/Director；模型路由可配。
- 所有调用经 `LLMGateway`：cassette、usage、timeout、retry、审计；key 只从环境变量。

---

## 11. 存储与数据模型

### 11.1 开发期

- `WorldEvent` JSONL + snapshot JSON + cassette。
- 优点：可读、可 diff、可回放；适合 demo 与审计。
- 事件 >10k 或需要跨进程查询时迁移。

### 11.2 生产期

SQLite（WAL）单文件；表：

```
worlds(id, canon_id, seed, config_json, created_at)
events(id, world_id, tick, type, actor_id, place_id, payload_json, provenance_json)
snapshots(id, world_id, tick, state_json, hash)
characters(id, world_id, kind, tier, identity_json, body_json, social_json, presence_json)
facts(id, world_id, kind, subject_id, place_id, status, salience, source_event_id)
observations(id, world_id, character_id, fact_id, channel, confidence, source_event_id)
beliefs(id, world_id, character_id, fact_id, content, confidence, source_event_id, version)
plans(id, world_id, state, type, place_id, time_window_json, payload_json)
channels(id, world_id, owner_id, kind, durability, charge, secrecy)
memories(id, world_id, owner_id, kind, text, source_event_id, salience, redacted)
persona_versions(id, world_id, character_id, version, anchors_json, axes_json, source_event_ids)
llm_calls(id, world_id, role, model, prompt_hash, usage, cassette_key, created_at)
```

- append-only events；snapshot 每 N tick/每日；重建 = 最近 snapshot + event replay。
- 世界数据与宿主 session 日志分离；卸载宿主后可读（T6）。
- 用户删除记忆用 `redacted` 标记，不物理删除世界事实；导出走只读 API。

### 11.3 配置与存档

```ts
interface WorldConfig {
  schemaVersion: number;
  seed: string;
  worldSpeed: number;             // 世界分/真实分
  channelKind: "tablet" | "dream" | "omen" | "letter";
  messageDelayTicks: number;
  messageCorruption: number;      // 默认 0
  bodyInfluence: "weak" | "normal" | "strong";
  memoryError: boolean;           // 默认 false
  personaEvolution: "confirm" | "auto" | "frozen";
  deathPolicy: "final" | "legacy" | "cost";   // U2 未拍板，默认由 demo 配置
  intervention: boolean;          // U3，默认 false
  proactiveQuotaPerDay: number;
  quietHours: Array<[number, number]>;
  budget: { characterPerDay: number; directorPerDay: number; totalPerDay: number };
  contentRating: "general" | "mature";
}
```

- C1/C2：默认值写进文档/界面，且可在存档中覆盖。
- C3：`memoryError`、`intervention`、`deathPolicy` 这类会破坏一致性的选项必须显式命名并提示；不能做隐藏开关。
- C4：配置、canon hash、seed、schemaVersion 随存档；读档时校验版本，必要时迁移。

---

## 12. 宿主与部署

### 12.1 引擎与宿主解耦

- 领域层/应用层纯 Node，不 import DSH。
- 宿主适配器只做四件事：收消息、送感知、调度 tick、推通知。
- DSH 适配建议：
  - `persona.complete: true`，`includeRuntimeContext: false`；
  - `ctx.tools.restrict()` 只暴露 `act/speak/observe/remember`；
  - `agent/pre-step` 把用户消息改写为 `ChannelEvent`，保留原文；
  - `dsh-schedule` 驱动 tick；`agent.followup()` 做主动唤醒；
  - 世界状态/记忆放 SQLite，不放会话日志；
  - 不 append 自定义 session 事件类型（会导致会话无法打开）。

### 12.2 v0 部署

```
Node 单进程
  ├── API/WS（观察/消息）
  ├── Scheduler（世界 tick）
  ├── SQLite（WAL）
  └── LLMGateway（DeepSeek + cassette）
```

- 单进程足够；不做分布式。
- 观察面板只读 ReadModel；用户消息只写 `ChannelInbox`。
- 主动消息经配额/静默时段/通知适配器。

### 12.3 后续拆分

- 只有在需要多世界并发/离线任务时才拆 scheduler worker 与 API。
- 拆分前保持同一 `WorldStore` 接口；不要先上消息队列。

### 12.4 对外接口面

| 接口 | 方向 | 约束 |
|---|---|---|
| `POST /worlds/:id/channel/messages` | 用户 → 世界 | 只写 ChannelInbox；不直接改世界状态 |
| `GET /worlds/:id/observer` | 世界 → 用户 | 只读 ReadModel；无 thought/秘密 |
| `GET /worlds/:id/chronicle` | 世界 → 用户 | 从事件生成；可按天/人物过滤 |
| `WS /worlds/:id/stream` | 世界 → 用户 | 推送观察/主动消息；不可反向写 |
| `POST /worlds/:id/pause` | 用户 → 应用 | 只控制 SessionClock/推进，不改事实 |
| `GET /worlds/:id/export` | 世界 → 用户 | 事件/记忆/角色导出；只读 |

没有“直接设置角色位置/好感/结果”的接口；用户干预若要做，走显式的 `InterventionPort`，并作为世界事件留痕。

---

## 13. 可观测性与验证

### 13.1 每层 must-pass

| 层 | 检查 |
|---|---|
| Kernel | 同 seed 回放一致；事件 id 单调；快照 hash |
| Space | 出口互逆、可达、位置合法 |
| Character | CM-1 契约；身体约束；identityHash |
| World | 不变量；fact source；witnesses；plan 终止 |
| Rules | 硬约束不掷骰；C/D 分离；结果分级 |
| LLM | claims ⊆ allowed；MetaScan；预算；cassette |
| Channel | 原文逐字；无 `user` 角色；延迟/暴露 |
| Memory | 可追溯；固化不新增 fact；删除可审计 |
| Observer | 只读；不显示 thought/秘密；信息缺口 |

### 13.2 已有证据

- 具身：100 测试；V3 16/16；blind/aware 100/100；回放逐字节一致。
- 世界：67 测试；B2 12/12；B3 13/13；完整 3 天 760 事件；4 次 Director + 14 次角色对话；cassette 0 miss。
- 合并后必须新增：Channel 原文/暴露测试、Memory 固化/删除测试、Persona 版本/回滚测试、Observer 泄漏测试、离线推进一致性测试。

### 13.3 失败即改方向

| 信号 | 处理 |
|---|---|
| T1 冲突率 >0 | 缩窄 Narrator 权限；只允许 fact 复述 |
| T8 出现“用户/消息” | 修 Channel/Perception，不加提示词 |
| 预算持续超 | 砍 LLM 面：先砍 ambient 台词，保留 companion/focus |
| 回放分叉 | 稳定排序/RNG 分流/禁 Date.now/Math.random |
| 世界像数据库 | 提高 salience/摘要质量，不先上大模型 |
| 陪伴像客服 | 加延迟/沉默/拒绝；检查 Persona 锚点 |

---

## 14. 迁移路线

| 阶段 | 做什么 | 退出标准 |
|---|---|---|
| M0 冻结 | 保留两个 demo 的测试与报告；不重写 | 100 + 67 测试全绿 |
| M1 抽内核 | `kernel/space/events` 从 world demo 抽出；embodied 的 RNG/JSON 复用 | 两 demo 仍独立通过 |
| M2 统一角色 | `CharacterRuntime` 接 companion；`BodyProvider` 支持 full/summary/aggregate | CM-1 + 身体约束 contract |
| M3 统一事件/判定 | `Intent → Compiler → WorldRuleSet → DM → Resolver → EventLog` 串起来 | 一次端到端：说话/拿取/偷窃 |
| M4 通信/记忆/人格 | `Channel`、`MemoryStore`、`PersonaVersion` 接入 | T8 + 跨会话召回 + 回滚 |
| M5 存储/宿主 | SQLite + DSH 适配 + Observer API | T6 + 重启后连续 |
| M6 产品验证 | 7 天陪伴、成本、T1/T7 | PRD 验收表 |

关键：**不推倒 demo。** 先把已验证的模块抽成包，再用 adapter 接起来；任何一步失败，demo 仍能独立跑。

### 14.1 当前文件到目标模块的映射

| 当前 | 目标 | 迁移方式 |
|---|---|---|
| `demos/embodied/src/body.ts` | `characters/body.ts` | 原样抽出，补 `detailLevel` |
| `demos/embodied/src/check.ts` | `rules/resolver.ts` | 保留 C/D/掷骰，去掉 demo 专属输出 |
| `demos/embodied/src/dm.ts` | `llm/roles/dm.ts` | 输入白名单不变 |
| `demos/embodied/src/narrator.ts` | `llm/roles/narrator.ts` | 只吃 OutcomeFacts |
| `demos/embodied/src/v2/`、`v3/` | `rules/demand.ts`、`characters/compiler.ts` | 编译器/世界规则分离 |
| `demos/world/src/world/world.ts` | `world/event-store.ts` + `world/projection.ts` | 拆分 emit 与投影 |
| `demos/world/src/agents/*` | `characters/runtime.ts`、`tiers.ts`、`crowd.ts` | 保持契约，改 kind |
| `demos/world/src/rules/*` | `rules/*` | 原样抽出 |
| `demos/world/src/sim.ts` | `app/simulation-service.ts` | 把场景脚本变成配置/测试 |
| `demos/world/src/b3-*` | `harness/scenarios/b3.ts` | 验证场景保留为回归 |
| `demos/world/src/llm-director.ts` | `llm/roles/world-director.ts` | 输入白名单不变 |

**不迁移**：demo 的写死场景、`pc_observer` 替身、CLI 打印格式。它们留在 `demos/` 作为回归与演示。

---

## 15. 目标目录

```
src/
├── kernel/          clock, rng, ids, canonical-json, snapshot
├── space/           region, settlement, room, route, visibility
├── world/           canon, event-store, projection, fact, trace, plan
├── characters/      character, body, capability, mind, persona, memory, runtime, tiers
├── rules/           constraint, action, difficulty, economy, law, fire, rumor
├── perception/      builder, filter, channel-view
├── llm/             gateway, roles/{compiler,dm,director,narrator,dialogue,consolidator}, cassette, budget
├── app/             simulation-service, scheduler, session, offline, query, proactive
├── host/            dsh-adapter, cli, http, observer
└── harness/         meta, claim, leak, invariant, replay, metrics
```

当前 `demos/embodied` 与 `demos/world` 保留为回归/演示；共享代码逐步上移到 `src/`，不反向 import demo。

---

## 16. 关键决策记录

完整 ADR（背景/决策/后果/证据）见 [adr/README.md](adr/README.md)；依赖矩阵见 [DEPENDENCIES.md](DEPENDENCIES.md)；风险登记见 [RISKS.md](RISKS.md)。

| ADR | 决策 | 理由 |
|---|---|---|
| ADR-1 | EventLog 是唯一真相 | 回放、审计、P1、T6 |
| ADR-2 | 规则 tick 同步；LLM 只在注意力点异步 | 可回放；避免每 tick 不确定 |
| ADR-3 | Compiler 不判可行性 | 可行性依赖世界观；V3 教训 |
| ADR-4 | DM 不看能力/身体 | 防止 DC 补偿；C/D 分离 |
| ADR-5 | T0–T3 + 双预算 | 世界可养活；成本可控 |
| ADR-6 | Channel 是世界实体 | D5/T8；消息不能以 user 角色进入 |
| ADR-7 | 记忆事件溯源、删除只标记 | P4；世界事实不被用户删除改变 |
| ADR-8 | 宿主 adapter 不持有真相 | A1/T6；DSH 可替换 |
| ADR-9 | 开发 JSONL，生产 SQLite | 先可读，再规模 |

---

## 17. 仍待拍板

| # | 问题 | 架构上的插槽 | 默认 |
|---|---|---|---|
| U1 | 信道载体：泥板/通讯录 | `Channel.kind` + `ChannelTheory` | 泥板 |
| U2 | 死亡是否终局 | `TerminalPolicy`（终局/遗产/代价） | demo 用重伤/昏迷，不拍板 |
| U3 | 用户能否干预世界 | `InterventionPort`（默认关闭） | 关 |
| U4 | 全知调试模式 | `ObserverMode.debug`（仅开发） | 关 |
| U5 | 配置粒度 | `WorldConfig` schema | 少而稳 |

---

## 18. 一句话验收

> 同 seed 能重放；角色想法不漏；身体说不行就是不行；LLM 只提案；用户消息只从信道进来；离开后世界继续；回来时变化有来源；成本超了降级而不是崩。

这份架构不要求先把所有模块写完；它要求**每一层都有可执行的边界与回退**，并且两个 demo 的已验证结论不被合并过程破坏。
