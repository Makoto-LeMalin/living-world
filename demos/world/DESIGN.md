# 世界 Demo 设计（v0.2）

| 项 | 内容 |
|---|---|
| 状态 | B0–B3 已实现并验证（13/13 门）；完整 3 天真实 DeepSeek（4 Director + 14 角色对话）+ cassette 零 miss；B4 人工评审未做 |
| 上游 | [../../docs/PRD.md](../../docs/PRD.md) §5–§8；旧计划/角色方向文档已清理，不再作为输入 |
| 入口 | [README.md](README.md) · 验证：运行 `pnpm report:world` 生成 `reports/world-validation.md`（本地，gitignored） |

本文件只记录**实现决策**；范围、场景脚本、验收门以本文与 demo README 为准。

## 0. 结论先行

1. **先规则，后生成。** 手写 12 个房间、10 个 NPC 的 canon；`WorldBuilder(seed)` 只参数化名字/性格/日程/初始库存，不做拓扑生成。世界 demo 要证明的是"规则能养活 NPC"，不是"生成器能造世界"。
2. **事件日志是唯一写路径。** 所有状态变更先成为 `WorldEvent`，状态是事件的投影；LLM 不能直接写状态。
3. **事实 / 观察 / 信念三分。** 世界持有 canonical `Fact`；角色只有 `Observation` 与 `Belief`。传闻是"某人说了一个 claim"，不是"世界改了"。
4. **tick 只跑规则，LLM 只做台词。** 日程块 + 事件队列驱动 NPC；所有 NPC 动作由规则选择，LLM 只在 `focus` 对话里填充 `speech`，且 `claims ⊆ 已知事实`。
5. **脚本注入事件，不注入结果。** D2 只注入"盗窃尝试"，D3 只注入"起火"；是否成功、谁目击、传多远、抓不抓人、价格涨多少，全部由规则和种子决定。
6. **JSONL + 快照，不上 SQLite。** 事件日志可读、可 diff、可回放；内存投影做查询。事件量 >10k 或需要跨进程查询再迁移。
7. **NPC 行为是规则层的一等公民。** 工作、交易、巡逻、八卦、指控、帮助、偷窃、逃跑都产出事件；没有 PC 在场也照常跑。
8. **跨地点靠"人带传闻"，返回靠"事件差分"。** 旅人携带 `RumorPacket`，客栈/市场 gossip pulse 放大；A→B→A 用 `DepartureSnapshot → ReturnDiff → Echo` 保证"变了的东西有来源，没变的东西有 id"。

## 1. 五个启动问题

| # | 问题 | 决策 | 理由 |
|---|---|---|---|
| 1 | 生成器还是手写？ | **手写拓扑 + `(seed, id)` 参数化内容** | 生成器的不变量是另一个风险；手写 12 房间已足够跑传播链。20 个 seed 仍可测（同一拓扑、不同参数）。 |
| 2 | NPC 决策频率？ | **日程块 + 事件唤醒**；每 tick 只跑规则，不做全量 LLM | 10 世界分/tick，144 tick/日；大多数 NPC 大多数时间只需日程/需求。 |
| 3 | LLM 调用面？ | **只做 focus 对话**（2–3 个 NPC）；传闻/价格/执法/日程全规则 | A2 要的是"规则 ≥90% 决策"；本 demo 直接把 NPC 动作做成 100% 规则。 |
| 4 | 传播链深度？ | 盗窃链 **5 跳**；火灾链 **4 跳**；每跳 `sourceEventId` | 足够覆盖"罪→目击→传闻→执法→拘禁→物价"，又不至于变成经济模拟器。 |
| 5 | 日志格式？ | **JSONL 事件日志 + JSON 快照** | 事件 <10k；可读、可回放、可人工审计；查询用内存索引。 |

### 1.1 场景 tick 标定（已实现）

1 tick = 10 世界分；144 tick/日；3 日 = 432 tick。`DEMO_PLAN.md` 旧的 200/1000 与 3 天不自洽，已按下面重标定：

| 事件 | 时间 | tick |
|---|---|---|
| D1 06:00 | 开始 | 0 |
| D2 12:20 | 阿潜因饥饿/机会尝试盗窃 | 182 |
| D2 13:10 | PC 离开 A | 190 |
| D2 13:40 | PC 到 B 客栈 | 193 |
| D2 19:10 | PC 开始返回 | 229 |
| D2 19:40 | PC 回到 A / 返回差分 | 232 |
| D2 22:20 | 仓库起火（概率场景种子） | 242 |
| D4 06:00 | 观察者查询 | 432 |

盗窃/执法/PC 出发不再由固定 tick 触发；上表是 seed 7 的实测结果。其他 seed 的时点会变。

## 2. 总体架构

```
canon + seed
    │
    ▼
WorldBuilder ──► WorldState（投影，只读给查询）
    │
    ▼
Scheduler ──► due intents / events
    │
    ▼
RuleResolver ──► WorldEvent ──► EventLog（唯一写路径）
    │                 │
    │                 ├─► Projections（位置/库存/价格/关系/痕迹/信念）
    │                 └─► Perception（按角色过滤）
    │
    ▼
CharacterRuntime.decide(ctx) ──► Intent
    │
    └─ focus 对话 ──► LLM ──► Speech（claims 校验）──► Event
```

模块：

| 模块 | 职责 | 不做什么 |
|---|---|---|
| `src/kernel/`（共享） | 时钟、tick、RNG 分流、ID、规范化 JSON、快照/JSONL | 不做世界规则 |
| `world/` | 房间图、实体、库存、价格、法律、痕迹、事件追加与投影 | 不做网格/寻路/光照 |
| `agents/` | `CharacterRuntime`、日程、需求、知识、关系、LOD | 不做情绪模型/性格演化 |
| `rules/` | 盗窃、目击、传闻、调查、拘禁、火灾、价格 | 不做深度战斗/经济 |
| `query/` | `chronicle`、`ask`、`inspect`、`metrics` | 不做 Web |
| `llm/` | 台词生成、cassette、成本记账（复用共享层） | 不写状态、不选动作 |

**唯一写路径**：`RuleResolver.emit(event)` → `EventLog.append` → `Projection.apply`。LLM 输出只能变成 `Speech` 事件，且必须过 `claims` 校验。

## 3. 事实、观察与信念

这是世界 demo 与具身 demo 最大的结构差异：世界 demo 的核心不是"身体能不能做"，而是"谁知道了什么"。

```ts
interface Fact {
  id: string;              // f_theft_001
  kind: "crime" | "fire" | "trade" | "relationship" | "law" | "weather";
  subjectId: string;
  objectId?: string;
  placeId: string;         // 事实发生/所属地点
  detail: Record<string, string | number | boolean>;
  status: "active" | "resolved" | "superseded";
  salience: number;        // 0..1，决定传播/回忆优先级
  traceIds: string[];      // 可见痕迹
  validFromTick: number;
  validToTick?: number;
}

interface WorldEvent {
  id: string;              // e_000123，确定性递增
  tick: number;
  type: string;
  actorId?: string;
  roomId: string;
  witnesses: string[];     // emit 时按感知计算，不是事后猜
  sourceEventIds: string[];
  visibility: "private" | "room" | "public";
  facts: Fact[];
  payload: Record<string, unknown>;
}

interface Observation {
  factId: string;
  observerId: string;
  channel: "sight" | "hearing" | "rumor" | "inference";
  confidence: number;      // 0..1
  sourceEventId: string;
  learnedAtTick: number;
}

interface Belief {
  factId: string;
  content: string;         // 允许与 canonical 细节不同（误传）
  confidence: number;
  sourceEventId: string;
  learnedAtTick: number;
  version: number;
}
```

规则：

- **目击者由事件计算**：同房间 + 视线/光线/遮挡/注意；不是"所有在场者都知道"。
- **只有 Observation 进个人知识**：角色查询 `KnowledgeBase`，不读 `EventLog` 全局。
- **传闻是一条 Speech 事件**：`claims: factId[]`；听者生成 `Belief`，confidence 衰减；最多 5 跳，避免全城皆知。
- **允许版本差异**：`Belief.content` 可与 canonical 不同（例如把"偷面包"说成"偷钱"）；canonical `Fact` 不被覆盖。
- **thought 永不进事件日志**：世界 demo 的 NPC 没有玩家可见的 thought；合并 X 的 PC thought 走独立私有存储。

### 3.1 事实的生命周期与地点状态

- **Fact 不删除，只改状态**：`active → resolved → superseded`；每次变化发 `FactStatusChanged`，保留 `validFrom/validTo`。拘禁不会抹掉盗窃事实，只会把它标成 resolved，价格/关系/传闻仍可引用。
- **PlaceState 是投影**：每个地点保存 `activeFacts`、`traces`、`entities`、`stocks/prices`、`socialClimate`、`lastEvents`。投影可重建，不作为真相。
- **地点 LOD 不改变因果**：PC 所在地点 `fine`（逐 tick 细节），其他地点 `coarse`（按小时聚合同样规则）。12 房间/10 NPC 的 demo 直接全量跑；LOD 是为更大世界预留，不是"离开就不算"。
- **不做薛定谔的 A 地**：PC 离开后 A 继续按规则跑并写事件；返回时读日志 + 投影，不"现场生成一段发生了什么"。这是 P1"世界持有真相"的实现方式。

离开/返回用两个结构：

```ts
interface DepartureSnapshot {
  placeId: string;
  tick: number;
  visibleIds: string[];        // 当时能看见的实体/痕迹
  prices: Record<string, number>;
  climate: SocialClimate;
  pcBeliefs: string[];         // 当时已知的 factId
}

interface ReturnDiff {
  stableIds: string[];         // 还在、且没变
  changed: Array<{
    id: string;
    eventIds: string[];
    summary: string;           // "面包摊换了新锁"
  }>;
  addedIds: string[];
  removedIds: string[];
  climateDelta: Partial<SocialClimate>;
  echoes: Echo[];              // 传闻与事实的对照
}
```

- **stable 用 id 重新识别，不重新描述**：门、神龛、码头、老狗还在，就还是同一个 id；只有 `changed` 需要新描述。这是"返回时哪些不变"的实现方式。
- **ChangeBudget**：每个地点每天最多 2–3 个高 salience 事件，其余是价格/情绪/日程的连续漂移。变化是稀缺的，才不会"离开三天，回来全变了"。
- **痕迹是变化的证据**：`Trace` 持久化并引用 `sourceEventId`；新锁、血迹、烧痕、告示都是返回时可以看见的"事实回执"。

## 4. 时间、日程与规则

### 4.1 时钟

- 1 tick = 10 世界分；144 tick/日；3 日 = 432 tick。
- 每 tick：推进时钟、处理到期日程、结算需求、价格/法律/火灾的慢变量。
- 每 6 tick（1 小时）：重算 importance/LOD、传闻传播机会、价格更新。
- 每 24 tick（4 小时）：固化一次信念/关系摘要（避免无限增长）。

### 4.2 日程与需求

```ts
interface ScheduleBlock {
  startTick: number;       // 当日 tick
  endTick: number;
  activity: "sleep" | "eat" | "work" | "trade" | "patrol" | "worship" | "drink" | "home";
  roomId: string;
  priority: number;
}

interface Needs {
  hunger: number;          // 0..100
  fatigue: number;
  safety: number;
  social: number;
  coin: number;
}
```

- 日程是默认；需求越界（饿/累/不安全）可偏离，偏离必须写 `Deviation` 事件并给原因。
- 决策只在**日程边界**或**事件唤醒**时发生，不每 tick 重算。
- 移动是房间图的一跳；1 tick 走一个出口；不做 A*，不做连续坐标。

### 4.3 规则模块

| 模块 | 输入 | 输出事件 | 关键参数 |
|---|---|---|---|
| `movement` | 当前位置、目标房间、门/锁 | `Moved` / `MoveBlocked` | 出口连通、锁、体力 |
| `economy` | 库存、需求、事件修正 | `PriceChanged` / `Trade` | 基础价、弹性、上下限 |
| `theft` | 机会、注意、技能、目击者 | `TheftAttempt` / `TheftSucceeded` / `TheftFailed` | 成功率、目击半径 |
| `law` | 犯罪事实、证据、守卫信念 | `Investigated` / `Accused` / `Arrested` / `Jailed` | 证据阈值、巡逻 |
| `fire` | 起火点、可燃物、风向 | `FireStarted` / `FireSpread` / `FireDamaged` | 蔓延率、扑救 |
| `rumor` | 知情人、关系、salience | `RumorTold` | 传播率、衰减、5 跳上限 |
| `trace` | 事件、房间/物体 | `TraceCreated` | 血迹/破损/告示持久化 |

经济只做 4 种商品（粮、鱼、布、工具），价格是"基础价 × 供需 × 事件修正"，clamp 到区间；不做均衡模型。

### 4.4 NPC 行为：不只是对话

NPC 必须**自己会做事**；没有 PC 在场时也一样。行为是规则层的一等对象，不是 LLM 的附属品。

| 行为 | 触发 | 产出事件 | 对社会的影响 |
|---|---|---|---|
| `work` / `trade` | 日程 + 需求 | `Worked` / `Trade` | 库存、价格、钱 |
| `patrol` | 守卫日程 + 犯罪压力 | `Patrolled` / `Investigated` | 安全感、抓捕 |
| `gossip` | 同房间 + 高 salience 信念 | `RumorTold` | 传闻、关系 |
| `accuse` | 愤怒 + 怀疑 + 证据 | `Accused` | 冲突、执法 |
| `comfort` / `help` | 关系 + 他人困境 | `Helped` | 信任、关系 |
| `steal` | 饥饿/贪欲 + 机会 | `TheftAttempt` | 犯罪链 |
| `flee` / `hide` | 恐惧 + 危险 | `Fled` / `Hid` | 位置、传闻 |
| `repair` / `mourn` | 火灾/死亡后 | `Repaired` / `Mourned` | 痕迹、气氛 |
| `drink` / `worship` / `visit` | 日程/情绪 | `Visited` | 社交网络、传闻 |

选择用简单效用，不做 GOAP/BT：

```
score(behavior) =
  w1 × needFit + w2 × goalFit + w3 × moodFit
+ w4 × relationshipFit + w5 × normFit
+ w6 × opportunity + seededNoise
```

- 日程是强先验；需求/情绪/事件可以偏离，但偏离要写 `Deviation`。
- **同房间的 NPC 之间也会互相作用**：gossip / accuse / comfort / trade 都是 NPC→NPC，不需要 PC 在场。这些事件是传闻和关系演化的主要来源。
- 离屏 NPC 照常跑上述规则；`coarse` 只是降低事件粒度，不是暂停。PC 回来看到的变化，必须能在离屏事件里找到来源。

### 4.5 思想、情绪与社会风气

NPC 的"思想"不是一段自由文本，而是可计算、可追溯的状态：

```ts
interface Mood {
  fear: number;       // 0..1
  anger: number;
  trust: number;
  hope: number;
  suspicion: number;
}

interface SocialClimate extends Mood {
  placeId: string;
  updatedAtTick: number;
  dominantNarrative: string;   // "市场在传守卫抓错了人"
}
```

**评价（appraisal）**：事件被观察后，按规则改 mood / relationship / reputation。

| 事件 | 变化 |
|---|---|
| 目击盗窃 | fear +0.2，anger +0.1，trust −0.05 |
| 自己被偷 | anger +0.2，fear +0.1 |
| 火灾 | fear +0.4，hope −0.2 |
| 守卫抓错人 | trust −0.2，anger +0.1 |
| 被人帮助 | trust +0.2，relationship + |
| 被骗并被揭穿 | trust −0.3，suspicion +0.2 |

**社会风气**不是单独写死的剧本变量，而是地点内 NPC mood 的影响力加权：

```
climate.d = Σ(mood_i.d × influence_i) / Σ(influence_i) + eventModifier.d
```

每小时更新，clamp 到 0..1。它反过来影响规则：

- `fear ↑`：囤货、价格上浮、人群避开集市、传闻传播更快；
- `anger ↑`：冲突/指控/巡逻增加；
- `trust ↓`：守卫合作下降、假传闻更容易被信；
- `hope ↓`：外迁、交易减少；
- `suspicion ↑`：外来者被盯、PC 声誉更容易受损。

**Reputation** 是"公开事实的投影"：

```ts
interface Reputation {
  subjectId: string;
  placeId: string;
  tags: Record<string, number>;   // thief:0.7, hero:0.2
  score: number;
  sourceEventIds: string[];
}
```

PC 在 A 做的事会变成公开事实，随传闻到 B；B 的 NPC 在见到 PC 前就可能已有态度。这样"名声先到人"。

LLM 只在对话时拿到 `knownFacts + mood + relationship + climate` 的摘要；它可以把状态说成人话，但不能改状态，也不能说出未观察到的全局事实。

### 4.6 事件生成：自然、主动、特殊

事件不是一张随机表。三种来源的**发起者、方向确定时机、推演者**都不同，必须分开建模。

| 来源 | 谁发起 | 方向何时确定 | 谁推演 | 例子 |
|---|---|---|---|---|
| `ambient` 自然 | 地区压力/环境 | 触发时 | 规则验概率 + `WorldDirector` 提方向 | 雾、渡船搁浅、意外火灾、疫病、塌方 |
| `actor` 主动 | PC / T0 / T1 | 意图或计划创建时 | `ActionDM` 定难度/方向 + 判定器掷骰 | 偷窃、纵火、抓捕、交易、逃跑 |
| `special` 特殊 | canon / 势力议程 / 世界导演 | 世界构建或弧线触发时 | canon 作者或 `WorldDirector` 编排 | 集市日、税日、清洗、葬礼、瘟疫、商队 |

#### 4.6.1 EventPlan 与状态机

事件在"发生"之前先是一份**计划**；发生后才成为带细节的 `WorldEvent`。

```ts
type EventSource = "ambient" | "actor" | "special";

interface EventPlan {
  id: string;
  source: EventSource;
  type: string;                 // "theft" | "fire" | "crackdown" | "ferry_delay"...
  placeId: string;
  actorIds: string[];
  targetIds: string[];
  factionIds: string[];
  timeWindow: { startTick: number; endTick: number };
  direction: string;            // "在集市偷面包"; 只定方向，不定结果
  stakes: number;               // 0..1
  preconditions: string[];
  branches: {
    onSuccess: string;
    onFailure: string;
    onPartial?: string;
  };
  visibility: "private" | "room" | "place" | "public";
  createdBy: "rule" | "action-dm" | "world-director" | "canon";
  proposalId?: string;
  parentPlanId?: string;
  state:
    | "proposed"
    | "validated"
    | "scheduled"
    | "pending"
    | "resolving"
    | "resolved"
    | "aborted";
}
```

状态机：

```
proposed → validated → scheduled → pending → resolving → resolved
                                      └──→ aborted（前置条件不成立/超预算/被替代）
```

- `validated` 由 `EventValidator` 做结构/ID/canon/预算/隐私校验；**模型不能跳过这一步**。
- `pending` 时检查前置条件（人还在、门还锁、库存还有）；不成立就 abort 或重排。
- `resolving` 才掷骰/结算；`resolved` 才生成 facts/traces/witnesses。
- 同一 plan 可被更高优先级 plan 替代（例如清洗期间集市日照常，但巡逻覆盖）。

#### 4.6.2 自然事件

自然事件按地区、按类别算 hazard，不按 NPC 逐个算：

```
λ_region,type = base_type
  × season × weather × crowding × wealth × crimePressure
  × (1 + climate.fear)
  × eventPressure

P(event in Δt) = 1 - exp(-λ × Δt × lodFactor)
```

- `lodFactor`：`fine` 1.0、`coarse` 0.6、`cold` 0.3；`cold` 只保留高 salience 事件，低层事件按天聚合。
- 每个地区/类别有 cooldown 和 `ChangeBudget`（每天最多 2–3 个高 salience 事件）。
- **低 salience 事件走模板**（"渡船晚了半小时"）；**高 salience / 需要世界知识的走 `WorldDirector`**：
  - 输入：canon 摘要、地区摘要（人口/库存/价格/气候/最近事实/活跃 plan）、时间/天气/季节、允许的事件类型、预算、隐私约束。
  - 输出：1–3 个 `EventProposal`（类型、地点、参与者、时间窗、方向、stakes、分支、理由）。
  - `EventValidator` 验 ID/地点/时间/类型/canon/预算；通过后按 stakes/压力加权选一个，进入 `scheduled`。
- 自然事件不是"无人事件"：它可能由天气、火灾、疫病、河道、结构老化引起；但它**没有主动 actor**，所以不能凭空生成"某人决定去偷"。

#### 4.6.3 角色主动事件

主动事件由 `Intent` 开始，分两条路：

- **即时动作**（说话、买卖、走一步）：`EventPlan` 时间窗就是当前 tick；`EventResolver` 直接结算；只有对抗/复杂时才叫 `ActionDM`。
- **复杂动作**（偷窃、纵火、抓捕、长途、仪式）：`ActionPlanner` 生成 `EventPlan`，交给 `ActionDM` 定方向、stakes、难度/对手，然后 `scheduled`；到点再掷骰。

`ActionDM` 的边界：

- 看：意图、目标、环境、公开状态、已知对手/守卫、canon。
- 不看：PC 的私有 thought、NPC 的隐藏记忆、角色未公开的能力值。
- 输出：`direction`、`stakes`、`difficulty`/`opposition`、`branches`；**不输出成功/失败**。
- 判定器用 `CharacterRuntime` 的公开/实际能力与 `difficulty` 掷骰；`p = sigmoid((C-D)/12)`，结果决定走哪个 branch。
- 失败不是"事件没发生"，而是"事件以失败分支发生"：偷窃失败 → 警报/目击/追捕；纵火失败 → 留下痕迹/被撞见。

多阶段计划：

```
侦察(case) → 动手(steal) → 撤离(escape)
```

每个阶段一个 `EventPlan`，`parentPlanId` 串起来；前一阶段结果决定后一阶段是否存在。T0 具名角色可以有自己的 `Goal` + 多阶段计划；T2/T3 只做单步/聚合。

#### 4.6.4 特殊事件

特殊事件来自 canon、势力议程或世界导演，通常有**弧线**而不是单点：

| 特殊事件 | 阶段 |
|---|---|
| 集市日 | 搭棚 → 人群聚集 → 交易高峰 → 散场/盗窃机会 |
| 税日 | 公告 → 征收 → 抗税/冲突 → 守卫介入 |
| 清洗 | 巡逻加强 → 盘查/抓捕 → 审判 → 释放/流放 |
| 葬礼 | 遗体 → 仪式 → 人群情绪 → 继承/冲突 |
| 瘟疫 | 首例 → 谣言 → 封锁 → 价格/外逃 |

- 特殊事件可以是 `canon` 写死的日程，也可以是 `WorldDirector` 在压力/弧线阈值满足时提出。
- 特殊事件可以**生成子计划**：清洗生成守卫的抓捕 plan；集市日生成小偷的偷窃 plan。
- 特殊事件高 salience、低频；不能每天都有，否则世界像连续剧。

#### 4.6.5 WorldDirector 契约

`WorldDirector` 是中立的世界事件推演者；可以复用 DM 的校验/回退/cassette 基础设施，但契约不同。

```ts
interface EventProposal {
  type: string;
  placeId: string;
  actorIds?: string[];
  targetIds?: string[];
  timeWindow: { startTick: number; endTick: number };
  direction: string;
  stakes: number;
  preconditions: string[];
  branches: {
    onSuccess: string;
    onFailure: string;
    onPartial?: string;
  };
  visibility: "private" | "room" | "place" | "public";
  reason: string;
  confidence: number;
}
```

输入只给：

- canon 摘要（世界规则、势力、法律、技术/超自然边界）；
- 地区摘要（LOD 粒度：人口、库存、价格、气候、最近事实、活跃 plan）；
- 时间/天气/季节；
- 允许的事件类型、预算、隐私约束；
- **不给** PC 私有 thought、NPC 隐藏记忆、未公开的能力值。

校验/回退：

- 未知 actor/place/target ID → 拒绝；
- 违反 canon（物理世界出现神术）→ 拒绝；
- 时间窗越界/预算超限/与 active plan 冲突 → 拒绝；
- 输出含"结果已定"（"他成功偷了"）→ 拒绝，只允许方向；
- 连续两次非法 → 回退到规则模板（低 salience）或跳过（高 salience），并记录。

中立性：WorldDirector 不偏向 PC/某 faction；它只根据 canon、地区压力、公开事实和已排 plan 推演。特殊事件的势力偏向由 `WorldAgenda` 数据决定，不由模型临时决定。

#### 4.6.6 事件发生时的补全

方向在 plan 里，细节在 `resolved` 时补：

- `EventResolver`：前置条件、对抗/难度、掷骰、选 branch。
- `EventComposer`：根据 branch + 现场（witnesses、库存、天气、痕迹位）生成 `facts`、`traces`、`beliefs`、`speech`、`RumorPacket`。
- 细节可以走模板；需要文风时可选 LLM，但必须过 claim/ID 校验，且**不能新增 canonical fact**。
- `WorldEvent` 带 provenance：`source`、`planId`、`proposalId`、`model`、`seed`、`ruleVersion`。

这样"事件是什么"在 plan 阶段已经定方向；"具体怎么发生/谁看见/损失多少"在 resolved 阶段才补全，而不是让模型在事后编一个完整故事。

#### 4.6.7 预算与 LOD

必须区分两类 LLM：

| 类别 | 用途 | 预算 |
|---|---|---|
| `character` | NPC/PC 对话 | 每日 ≤22 次；offstage 角色 0 |
| `world` | WorldDirector 事件提案 | 每日 ≤8 次；可离屏，但计入总预算 |

总预算仍 ≤30 次/日。自然事件在 `cold` 地区优先模板/聚合；只有高 salience 才调 WorldDirector。预算耗尽时：低 salience 走模板，高 salience 延迟到下一个窗口，并写 `BudgetDegraded` 事件。

> 这修正了 CM-5 的口径：`offstage 0` 指**角色对话 LLM**；WorldDirector 是另一类调用，不能混在一起算，也不能假装它不存在。

#### 4.6.8 三种来源的例子

| 来源 | 计划 | 到点发生 |
|---|---|---|
| 自然 | 河道雾大，`WorldDirector` 提"渡船搁浅/延误"；validator 通过 | 渡船晚点，旅客滞留，客栈涨价，传闻"船出事了" |
| 主动 | 饥饿的小偷生成 `steal` plan；`ActionDM` 定"集市偷面包，失败则逃向巷子" | 掷骰成功 → 盗窃 fact；失败 → 目击/警报，仍产生事件 |
| 特殊 | canon 的集市日 plan；到点人群聚集，生成小偷/商贩子计划 | 人群 climate 变化，盗窃机会上升，守卫巡逻增加 |

## 5. 角色运行时与 LOD

### 5.1 同一个接口

```ts
interface CharacterRuntime {
  perceive(world: WorldView, level: ViewLevel): Perception;
  decide(ctx: DecisionContext): Intent | null;
  act(intent: Intent): ActionResult;
  onEvent(event: WorldEvent): void;
  snapshot(): CharacterSnapshot;
}
```

世界 demo 提供三个实现，全部走同一组 contract：

- `ScriptedPcRuntime`：观察者/PC 的替身，`decide` 来自脚本队列；用于 CM-1，不调 LLM。
- `NpcRuntime`：日程/需求/事件 → `Intent`；`npcTick` 只是它的薄适配器；动作 100% 规则。
- `CrowdRuntime`：T3 群体，一次 `decide/act` 作用于整个群体，不逐个成员。

> 具身 demo 的 PC 不直接 import 世界 demo；合并 Demo X 时用一个 `EmbodiedPcAdapter` 实现同一接口。这样两个 demo 仍可独立失败。

### 5.1.1 T0–T3 生命周期

- `agents/tiers.ts` 每 6 tick 重算 importance；0.7 晋升、0.4 降级、144 tick 冷却。
- 降级写 `CharacterRecord`（身份 hash、关系、关键记忆、位置、日程、最后状态），并裁掉逐条 observation 与低权重记忆。
- 晋升恢复关键记忆；`id/name/role/homeRoomId` 不变，`identityHash` 稳定。
- CM-6 用 20 次强制降级→晋升验证：身份 40/40、关系 40/40、关键记忆 20/20。

### 5.1.2 群体

- `individualizeCrowd`：群体 size−1，生成/复用 T1 成员，保留 `crowdId` 与墓碑记录。
- `mergeCrowdMember`：心情按人数加权回写，信念取更高置信版本，size+1，成员从 `characters` 移除，记录 `tombstone=true`。
- 再次观察优先复用墓碑记录，保持同一 id/身份/关系/关键记忆；完整 3 天里真实执行 1 次个体化 + 1 次合并。

### 5.2 决策策略

| 层 | 决策 | 记忆 | LLM |
|---|---|---|---|
| PC/观察者 | 脚本/CLI | full | 不调（demo B） |
| T0 主要 | 日程 + 事件 + utility | full/summary | 仅 focus 对话 |
| T1 配角 | 日程 + 事件 | summary/index | 仅事件对话 |
| T2 背景 | 日程/utility | index | 仅被直接交互 |
| T3 群体 | aggregate | 群体统计 | 群体摘要/集体反应 |

**关键取舍**：本 demo 的 NPC **动作选择 100% 规则**；LLM 只填 `speech`。这让 A2 的"规则解决占比"不是 90%，而是可测的 100%。代价是 NPC 不会做出规则没覆盖的"聪明"动作；这是 demo 的范围，不是产品终局。

### 5.3 注意力预算

- `importance = 0.30 plot + 0.25 relationship + 0.20 proximity + 0.15 recency + 0.10 attention`。
- 晋升 0.7 / 降级 0.4，滞回；每世界小时重算。
- 每 tick 最多 K=3 个角色获得 LLM 对话额度；`Budget.canUseCharacter` 同时检查日上限、总上限、单 tick 上限。
- 角色对话每日 ≤22 次；`WorldDirector` 事件提案每日 ≤8 次；总 ≤30。两类分开记账，按 LOD/NPC/tick 写入 `BudgetConsumed`。
- `offstage` **角色**对话调用必须为 0；`focusDialogue` 在调用前检查同房间，超预算写 `BudgetDegraded` 并回退模板。
- 降级写 `CharacterRecord`（身份、关系、关键记忆、位置、日程、最后状态）；曾被观察者保留 tombstone。
- 群体：`Crowd` 一次判定作用到分布；被点名成员个体化，合并时保留 id 与关键记忆。
- 完整 3 天实测峰值：角色 5/22、Director 2/8、总 7/30、单 tick 2/3、offstage 0。

## 6. 场景与两条链

### 6.1 canon

`fixtures/ferry-market.json`：12 房间（集市、客栈、神庙、拘留所、码头、城门、仓库、巷子、三间民居、神龛），10 个具名 NPC + 2 个群体。手写初始关系、库存、价格、守卫排班、秘密。

Demo 的 A/B 先用同一聚落的两片区：**A=集市，B=码头**，中间 3 段路（集市↔巷子↔城门↔码头）。这样不扩地图也能测"离开—传闻—返回"；跨聚落版本等 B4 再加。

### 6.2 盗窃链（5 跳）

| 跳 | 事件 | 规则 | 可追溯 |
|---|---|---|---|
| 1 | `TheftAttempt` | 机会/注意/技能 → 成功或失败 | 种子 + 现场 |
| 2 | `Witnessed` | 同房间 + 视线 → 目击者集合 | `sourceEventId` |
| 3 | `RumorTold` | 关系 + salience + 衰减 → 传播 | 每跳 `sourceEventId` |
| 4 | `Investigated` / `Accused` | 守卫信念 + 证据阈值 | 指向犯罪事实 |
| 5 | `Jailed` / `PriceChanged` | 拘禁 + 供给减少 → 价格 | 指向拘禁/盗窃 |

D2 只注入"盗窃尝试"；如果种子让守卫当场抓住，链在跳 2/4 分叉，报告要记录另一条分支。

### 6.3 火灾链（4 跳）

`FireStarted`（只注入起火点）→ `FireSpread`（可燃物/风/扑救）→ `FireDamaged`（库存/房间）→ `PriceChanged`（供给）→ `Crowd` 恐慌/围观。

### 6.4 D4 查询

观察者分别问商人、孩子、守卫："这里发生过什么？"

- 商人：目击盗窃 + 价格变化；
- 孩子：听到传闻，confidence 低，版本可能错；
- 守卫：调查/拘禁记录；
- 三人的答案都带 `sourceEventId`；允许差异，不允许凭空。

### 6.5 移动、路线与路上遭遇

A/B 可以是两个聚落，也可以是同一聚落的两端；机制相同。路线不是背景，是一条会产出事件的地点。实现里 A/B 之间是 3 段：集市↔巷子、巷子↔城门、城门↔码头。

```ts
interface RouteSegment {
  id: string;
  fromPlaceId: string;
  toPlaceId: string;
  travelTicks: number;
  traffic: number;        // 0..2，商旅密度
  danger: number;         // 0..1
  patrol: number;         // 0..1
  terrain: "road" | "ferry" | "forest" | "checkpoint";
}

interface TravelState {
  actorId: string;
  routeId: string;
  segmentIndex: number;
  departTick: number;
  arriveTick: number;
}
```

**路上遇到什么，不是随机刷怪，而是"谁正好也在这条路上"。**

每个 segment 一次判定：

```
P(encounter) = clamp(
  base 0.20 × traffic × danger × timeOfDay × eventPressure,
  0, 0.9
)
```

- `eventPressure` 来自当前事实：火灾 → 逃难者/救火队；抓捕 → 巡逻/盘查；集市日 → 商旅；传闻大 → 赶路的人。
- 遭遇池由四类构成，按权重抽：
  1. **有行程的真实 NPC**（商人、守卫、朝圣者）：有 id、有起点/终点、有 `RumorPacket`；
  2. **事件驱动的 NPC**（逃犯、难民、伤者）：从 active fact 生成，带 `sourceEventId`；
  3. **机构队伍**（巡逻、征收、救援）：群体，一次判定；
  4. **低层模板**（路人）：只有被 PC 追问/观察时才个体化，仍要绑定一个当前事实或路线理由。
- **没有遭遇也是合法结果**。路可以空；空路本身传递"最近没人走"的信息。
- 遭遇结算：感知 → 对话/交易/回避/冲突 → `EncounterResolved` 事件；可能产生新事实、传闻、关系变化、PC 声誉。
- 所有 roll 用 `(seed, routeId, segmentId, tick)` 的独立 RNG 流，保证可回放。

### 6.6 传闻的通道与"回响"

传闻不是全局广播，而是**由人/机构携带的包**：

```ts
interface RumorPacket {
  factId: string;
  content: string;          // 允许与 canonical 细节不同
  confidence: number;       // 每跳衰减
  hops: number;             // 最多 5
  originPlaceId: string;
  carrierId: string;
  lastToldAtTick: number;
  distortion?: string;      // "偷面包" → "偷钱"
}
```

四条通道：

| 通道 | 机制 | 特点 |
|---|---|---|
| 面对面 | 同房间 `gossip` 行为 | 快、可信、受关系影响 |
| 旅人 | 移动时携带 packet | 跨地点，延迟 = 路程 |
| 机构 | 客栈/市场/神庙/守卫所的每小时 gossip pulse | 放大，但会变形 |
| 告示/痕迹 | `Notice` / `Trace` | 公开、持久，但只给结论 |

**B 地为什么能听到 A 地的事：**

1. A 地事件有 salience；
2. 某个 NPC/商队/信使从 A 去 B，packet 随人移动；
3. B 的客栈/市场每小时 gossip pulse，把 packet 传给在场者；
4. PC 在 B 问人/旁听，得到 `Belief`，带 `sourceEventId` 和 confidence；
5. 如果没人带、或 salience 太低，B 就听不到。**"没消息"也是信息。**

传播率大致为 `salience × tieStrength × credibility × climate.fear/anger × (1 - hops/5)`；每跳 confidence 衰减 0.1–0.2。外地新闻默认比本地新闻低 0.15 可信度。

**回响（Echo）**：PC 带着 A 的传闻回到 A 时，系统对照 `Belief` 与 canonical fact：

```ts
interface Echo {
  factId: string;
  belief: Belief;
  verdict: "confirmed" | "distorted" | "refuted";
  observedEventId?: string;
  note: string;
}
```

- `confirmed`：传闻的核心为真 → 返回时看到对应痕迹/价格/人物状态；
- `distorted`：核心为真、细节错 → 看到真实版本，NPC 可能还在传错版本；
- `refuted`：没有对应事实 → 返回时没有痕迹，或有人否认；这条传闻本身成为一个可追查的 `Lie`/`Mistake` 事件。

**硬规则**：每条传闻必须带 `factId`（或 `basisEventId`），不能凭空生成"关于世界的断言"。这样"传闻"与"返回后看到的世界"永远可以对照。

### 6.7 一次 A→B→A 的走法（已实现）

| tick | 地点 | 发生什么 | PC 知道什么 |
|---|---|---|---|
| 182 | A 集市 | 阿潜因饥饿/机会在面包摊偷两块面包；小满和人群看见，玛拉没看见；乞丐在附近 | 不在场（在神庙） |
| 183–190 | A 集市 | 小满把“像乞丐”说给人群；人群放大；信使把传闻带到 B；玛拉发现少货、涨价、换新锁 | 不知道 |
| 190 | A→B 路上 | PC 出发；路段遇到朝圣者/盐商，听到“集市出了事”（低可信） | 集市有麻烦 |
| 193–229 | B 客栈 | 店主转述信使带来的传闻；PC 停留 | “听说是乞丐干的”（distorted） |
| 194–241 | A | 守卫调查、小满改口说“船夫的儿子”、守卫仍抓乞丐；盘查随后启动 | 不在场 |
| 229–232 | B→A 路上 | PC 返回；路段遇到赶集的妇人，说“乞丐还关着” | 乞丐被拘 |
| 232 | A 集市 | PC 回到 A：新锁、面包贵、乞丐不在、守卫盘查；神庙/码头/老狗不变 | `ReturnDiff` + `Echo` |
| 242 | B 码头 | 仓库起火（概率场景种子）；市场看到烟；火灾链独立展开 | 看到烟/听到火 |
| 432 | A 集市 | D4 问商人、孩子、守卫、船夫 | 版本有差异，均有 source |

返回时（seed 7 实测）：

- **不变**：神庙、码头、渡船、老狗、摊位位置等 9 个 `lm_*` 地标；stable=10。
- **变了**：面包价 +18%（`PriceChanged`）、新锁（`Trace`）、乞丐被拘（`Jailed`）、守卫盘查（`CrackdownStarted`）、社会风气 fear/anger 上升。
- **呼应**：PC 在 B 听到“乞丐干的” → 回 A 看到乞丐确实被关，但孩子说“船夫的儿子”；`Echo=distorted`（盗窃 confirmed；肇事者细节错误）。价格/短缺/拘禁则 confirmed。
- **NPC 行为**：偷面包是因为饥饿/机会；小满因为害怕先说给人群；玛拉因为损失而 gossip/换锁；守卫因为传闻和压力而抓人；乞丐因为被指认而遭殃。这些都由规则事件产生，不是脚本台词。

> 实现差异：盗窃不再固定 tick；seed 7 由 `npc_thief` 的饥饿/机会规则在 tick 182 触发，PC 在 190 出发。tick 180 的旧脚本已删除。见 §1.1 与 `sim.ts` 的 `maybeNpcTheft` / `maybePcScript`。

## 7. LLM 契约

只用于 `focus` 对话，输入：

```ts
interface DialogueInput {
  identity: Identity;          // 人设、价值、禁忌、声音
  perception: Perception;      // 当前可见/可听/不知道
  knownFacts: Belief[];        // 只给已知，按 salience 排序
  relationship: Relationship;  // 对说话者
  intent: SpeechIntent;        // 规则已决定"要说"，LLM 只填内容
}
```

输出：

```ts
interface DialogueOutput {
  speech: string;              // 世界内的台词
  claims: string[];            // factId，必须 ⊆ knownFacts
  tone: "calm" | "afraid" | "angry" | "guarded";
}
```

校验：

- `claims` 必须是已知 factId 的子集；出现新 id → 回退模板；
- 出现"用户/玩家/消息/系统/AI/提示词" → 回退；
- 出现裁决未给出的状态谓词 → 回退；
- 解析失败重试一次，再失败用模板（"我不知道。" / "你问这个做什么？"）。

成本：`deepseek-flash`、JSON 模式、`thinking` 关闭；cassette 录制；角色对话每日 ≤22 次；WorldDirector 另计 ≤8；offstage 角色 0。

**B3 实现（完整）**：

- `agents/character.ts`：`CharacterRuntime` 契约、`ScriptedPcRuntime`、`CharacterRecord` 压缩/恢复。
- `agents/runtime.ts`：`NpcRuntime`；`npcTick` 变成契约适配器，行为与 B2 规则一致。
- `agents/tiers.ts`：importance、T0–T3、滞回、1 世界日冷却、`CharacterTierChanged`。
- `agents/crowd.ts`：`CrowdRuntime`、`individualizeCrowd`、`mergeCrowdMember`、墓碑复用。
- `agents/dialogue.ts`：同房间通用对话（`characterDialogue`）；`focusDialogue` 默认仍限 3 个固定 NPC；`claims ⊆ knownFacts`；`Spoke` 只记录台词，不新增 fact。
- `world/llm-director.ts`：只允许 `allowedTypes`，禁止 actorIds；`roomId` 必须在 place 内；全部过 `validateProposal` 才排期。
- `sim.ts`：`b3:true` 打开 T0–T3 调度、群体 pulse、个体化/合并、同房间对话；B2 默认路径不受影响。
- `b3-full.ts`：完整 3 天真实运行；`b3-checks.ts`：CM-1/5/6/7/8；`b3-run.ts`：13 门报告。
- 真实记录在 `fixtures/llm-b3/`（17 个文件，无 key/headers）；`report` 回放，cassette miss=0。
- 实测：760 事件；T0/T1/T2/T3；P1/D2；1 次群体个体化 + 1 次合并；4 Director 调用 / 7 提案；14 角色对话全部 `source=llm`。

## 8. 查询与编年史

| 命令 | 读什么 | 用途 |
|---|---|---|
| `chronicle --seed 7 --days 3` | EventLog | 给人读的 3 天时间线 |
| `ask --npc merchant --q "谁偷了面包？"` | NPC Belief | 知识边界与版本差异 |
| `inspect --npc guard` | 当前 Perception + known facts | 调试"它为什么这么想" |
| `metrics` | 调用/ token/ 规则决策占比 | A2 / T5 |

`chronicle` 用模板 + 事件摘要，不默认调 LLM；需要润色时单独开关，并过 ClaimCheck。

## 9. 目录

```
demos/world/
├── README.md
├── DESIGN.md
├── fixtures/ferry-market.json      手写 canon：12 房间/10 NPC/2 群体/3 段路
├── fixtures/llm/                   单点 director/对话 cassette
├── fixtures/llm-b3/                完整 3 天真实运行 cassette（17 个）
├── src/
│   ├── types.ts                    共享类型
│   ├── world/                      canon/builder, world, director, llm-director, invariants
│   ├── agents/character.ts         CharacterRuntime 契约 / PC runtime / CharacterRecord
│   ├── agents/runtime.ts           NpcRuntime（日程、需求、移动、行为）
│   ├── agents/tiers.ts             T0–T3 importance / 晋升 / 降级
│   ├── agents/crowd.ts             T3 群体 / 个体化 / 合并 / CrowdRuntime
│   ├── agents/dialogue.ts          同房间对话、claims 校验、模板回退
│   ├── rules/                      plans, budget, economy, theft, fire, law, rumor, ambient, travel, return
│   ├── query.ts                    chronicle, ask, inspect, metrics, forwardChain
│   ├── sim.ts                      三日仿真（sync/async）、B3 runtime、规则触发、返回差分
│   ├── run.ts                      12 门 B2 验证 runner + 报告
│   ├── b3-checks.ts                CM-1/5/6/7/8 可执行检查
│   ├── b3-full.ts                  完整 3 天真实 LLM 仿真
│   ├── b3-run.ts                   13 门 B3 验证 + cassette 回放
│   └── cli.ts
├── test/                           67 个测试（单进程 run.ts）
└── reports/                        生成到根 reports/
```

共享：`engine/rng.ts`、`engine/json.ts`、`harness/claim.ts`、`llm/`；不 import `demos/embodied/`。

## 10. 里程碑

| 里程碑 | 内容 | 出口 | 状态 |
|---|---|---|---|
| **B0 真相层** | 事件日志、`WorldBuilder`、房间图/路线、`EventPlan` 状态机/Validator 骨架、快照、状态哈希、InvariantCheck、`ReturnDiff` 骨架 | 20 seed 不变量全过；同 seed 回放一致；零 LLM | ✅ 20/20；5/5 回放一致 |
| **B1 规则层** | 日程、需求、移动、经济、NPC 行为/效用、评价/情绪/社会风气、ambient hazard、即时/多阶段 actor plan；5 个非脚本事件 | 3 天无卡死/负资源；日程遵循 ≥95%；actor 成功/失败分支都可复现；零 LLM | ✅ 3 天；100%；539 非脚本事件 |
| **B2 事件层** | `WorldDirector` 提案/校验/回退；自然/特殊事件；盗窃/火灾/传闻/执法/拘禁/痕迹；旅人/遭遇；A→B→A 返回差分与 Echo；D4 查询 | 两链每跳可追溯；自然/主动/特殊三类都有 provenance；80% 相关 NPC 12h 内知情；知识边界 0 泄漏；返回变化全部有事件 | ✅ 12/12 门；668 事件；88% 知情 |
| **B3 注意力层** | `CharacterRuntime` 契约、T0–T3、晋升/降级、群体、同房间对话、角色/世界双预算 | CM-1/5/6/7/8；角色 ≤22/日、WorldDirector ≤8/日；offstage 角色 0 | ✅ 13/13 门；完整 3 天 4 Director + 14 对话 |
| **B4 报告** | chronicle、metrics、10 分钟演示脚本、WB 表 | 阻断项全绿或进入失败分支并记录 | 🟡 B2 12 门 + B3 13 门；人工评审未做 |

B0/B1 刻意零 LLM：先把"规则养活世界"证明，再引入台词。

## 11. 验证映射

| 检查 | 本设计对应 |
|---|---|
| WB-1 生成不变量 | `WorldBuilder(seed)` + InvariantCheck；20 seeds |
| WB-2 确定性回放 | 事件日志 + 状态哈希；5 次 |
| WB-3 日程遵循 | `ScheduleBlock` + `Deviation` 事件 |
| WB-4 观察一致 | EventLog 是 canonical；`ask` 读 Belief，重复查询稳定；`ReturnDiff` 的 changed 必须带 `eventIds` |
| WB-5 传播链 | 5 跳盗窃 / 4 跳火灾；每跳 `sourceEventId`；旅人 packet + 客栈 pulse 是跨地点传播主通道 |
| A→B→A 连续性 | `DepartureSnapshot` 对 `ReturnDiff`；stable/changed/new/gone 分类；Echo 三态；固定 seed 1 次 |
| WB-6 世界存活 | 规则触发的 5 个非脚本事件；无卡死/瞬移/负资源 |
| WB-7 成本/降级 | 角色 ≤22 + WorldDirector ≤8；总 ≤30；超限模板/延迟 |
| WB-8 数据安全 | JSONL + JSON snapshot；脱离引擎可读 |
| WB-9 编年史可信 | `chronicle` 从事件生成；2 名评审 |
| WB-10 LLM 占比 | NPC 动作 100% 规则；LLM 只台词 |
| CM-1 组件复用 | `ScriptedPcRuntime` / `NpcRuntime` / `CrowdRuntime` 同一 13 项 contract |
| CM-5 预算 | 总 ≤30；角色 ≤22；WorldDirector ≤8；单 tick K=3；offstage 角色 0 |
| CM-6 身份连续 | 降级/晋升 20 次，`CharacterRecord` 对比；identity 40/40、关系 40/40、记忆 20/20 |
| CM-7 群体一致 | 个体化/合并/再观察，id + 记忆保留；完整 3 天也跑 1 次个体化+合并 |
| CM-8 知识边界 | 未目击且无传闻 → `ask` 返回未知；完整 3 天 94 条信念 0 泄漏 |

## 12. 风险与失败分支

| 风险 | 失败信号 | 处理 |
|---|---|---|
| 规则太弱，三天没事发生 | WB-6 非脚本事件 <5 | 加社会性触发（价格/谣言/冲突），**不要用 LLM 补** |
| 传播链只靠脚本 | 除注入点外无 `sourceEventId` 链 | 先修感知/传闻规则 |
| 知识泄漏 | 背景 NPC 答出未目击事件 | 修 Perception/Belief 过滤，不加提示词 |
| 回放不一致 | 状态哈希分叉 | 稳定排序、RNG 分流、禁 `Date.now`/`Math.random` |
| 编年史像数据库 | 评审"像会发生的事" <3/5 | 加事件 salience/摘要模板，不先上 LLM |
| 成本超 | >30 次/日 | 砍 LLM 面：只留 2 个 focus NPC |
| 生成器拖垮 B0 | 20 seed 不变量过不了 | 回退手写拓扑 + 参数化（本提案已是） |

## 13. 已拍板与仍待定

已拍板并实现：

1. **拓扑**：手写 12 房间 + 参数化（不做拓扑生成器）。
2. **Demo B 的观察者**：脚本/CLI 替身，隔离 LLM。
3. **tick 标定**：10 分/tick；D4 432；盗窃/起火由规则和 seed 决定（seed 7：182/242）。
4. **事件模型预算**：WorldDirector ≤8/日 + 低 salience 走模板；角色对话 ≤22/日；总 ≤30。
5. **事件三源**：ambient / actor / special 分开建模，复杂动作走 `EventPlan`。

仍待定（B4）：

- 编年史是否需要 LLM 润色，还是模板 + 2 名人工评审即可。
- 是否把 20 seed 的完整 3 天真实 LLM 跑纳入常规验证（当前完整剧情只跑 seed 7）。
- 是否把 T3 群体从“池化 + 个体化”推进到每个成员都有独立 id 的更大规模。
- B3 已录制的单点 cassette（`fixtures/llm/`）与完整 cassette（`fixtures/llm-b3/`）是否合并成一套。
