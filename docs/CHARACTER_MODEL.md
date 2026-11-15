# Living World · 角色与判定内核（v2 方向）

| 项 | 内容 |
|---|---|
| 状态 | 提案，未实现；当前 demo 仍是 v0 基线 |
| 目的 | 回答"状态和动作枚举撑不住"之后的通用方案 |
| 关系 | 不替代 `PRD.md`；是 `DESIGN.md` 的实现方向 |
| 适用 | 具身 demo 的判定内核 + 世界 demo 的角色管理 |

---

## 0. 结论

1. **不要枚举状态和动作，枚举物理维度和效果原语。** 世界是开放的，但身体能做的事可以用一小组维度描述。
2. **动作开放，需求封闭。** 自由意图由 Action Compiler 编译成 `ActionDemand`（14 个维度上的需求），规则只对需求做判定。
3. **LLM 管语义，规则管机制。** LLM 负责"这句话在物理上要求什么"，规则负责"这个身体做不做得到"。
4. **状态是数据，不是代码分支。** 约束带来源、锚点、效果、移除条件；新状态由模板组合生成，不改代码。
5. **PC 和 NPC 共用同一个 Character 组件。** 差异在策略组合（决策频率、记忆、感知粒度、持久化），不在另一套实现。
6. **NPC 生命周期 = 重要性 × 相关性 × 注意力预算。** 分层、滞回、晋升/降级/回收；群体 NPC 是一等实体。

一句话：**把"枚举"从动作/状态层，下移到物理维度/效果原语层；上面用 LLM 编译，下面用规则判定。**

---

## 1. 为什么现在的枚举会崩

| 现在 | 规模一上来会怎样 |
|---|---|
| `statuses: bound_hands / tether / blindfold ...` | 每加一种原因就要加一个枚举、一个分支、一段理由文案 |
| `ACTION_SPECS` 12 个动词 + 每动词权重 | 开放世界动作是长尾；加"用牙咬""把草席卷起来堵门缝"就要改表 |
| `MIN_REASON` / 硬规则 if-else | 机制和叙事耦合；规则表变成不可维护的特例集合 |
| 每个 NPC 一套脚本或全量 LLM | 前者僵硬，后者成本不可持续 |

问题不在"枚举得不够多"，而在**枚举的层级错了**。动作是开放的，但动作对身体的**要求**是有限的；原因是开放的，但原因对身体的**影响**是有限的。

---

## 2. 闭内核 / 开表面

| 层 | 封闭（代码/类型） | 开放（数据/LLM） |
|---|---|---|
| 身体 | 14 个物理维度、7 个效果原语、部位表 | 具体约束实例、来源、叙事描述 |
| 动作 | `ActionDemand` 结构、5 个机械族（派生） | 自由意图、目标、工具、手法、参数 |
| 判定 | 瓶颈评分、掷骰、后果表 | 难度（DM）、后果提示 |
| 角色 | `Character` 接口、策略类型 | 人设、记忆、关系、日程、目标 |
| 世界 | 事件/谓词、空间关系 | 事件内容、NPC 反应 |

这张表是整份方案的核心：**封闭集合要小到可维护，开放表面要大到位居其上。**

---

## 3. 身体：约束（Constraint）与效果原语

### 3.1 物理维度（14）

| 维度 | 含义 | 例子 |
|---|---|---|
| `reach` | 够得到 | 隔着栏杆够门闩 |
| `grasp` | 抓得住、拿得稳 | 拿炭笔、拖人 |
| `precision` | 精细操作 | 写字、撬锁、包扎 |
| `force` | 发力 | 推门、挣脱、举石 |
| `mobility` | 位移 | 走、跑、爬 |
| `balance` | 平衡 | 站起、负重、船上 |
| `breath` | 呼吸/憋气 | 潜水、被勒、喊叫 |
| `voice` | 发声 | 说话、低语、呼救 |
| `sight` | 视觉 | 看、找、瞄准 |
| `hearing` | 听觉 | 听、辨位 |
| `smell` | 嗅觉/味觉 | 闻霉味、尝水 |
| `touch` | 触觉 | 摸黑数砖、辨材质 |
| `cognition` | 注意/判断/记忆 | 识破谎言、回忆 |
| `endurance` | 持续 | 长跑、熬夜、忍痛 |

维度是**动作需求**和**身体能力**的共同语言。动作再多，也只落在这些维度上。

### 3.2 效果原语（7）

```ts
type Effect =
  | { op: "block";   dim: Dim }                    // 硬性做不到
  | { op: "scale";   dim: Dim; factor: number }    // 0..1，按比例削弱
  | { op: "drain";   resource: Resource; rate: number } // 血/体力/氧/体温
  | { op: "impair";  channel: Sense; amount: number }   // 感知噪声/缺失
  | { op: "signal";  tag: string; visibility: Visibility } // 血迹/束缚/气味
  | { op: "limit";   range: number }               // 空间可达半径
  | { op: "damage";  part: PartId; severity: 1 | 2 | 3 | 4 };
```

`block` 和 `scale` 是机制；`signal` 是社会身体；`drain` 是资源和时间；`damage` 是结构变化。

### 3.3 约束是数据

```ts
interface Constraint {
  id: string;
  kind: "restraint" | "injury" | "sensory" | "exposure" | "intoxication" | "social" | ...;
  anchors: PartId[] | "space" | "whole";
  effects: Effect[];
  sourceEventId: string;      // 可追溯到发生过的事（P4）
  description: string;        // 给角色/叙述用的世界内描述
  visibility: "private" | "observable" | "social";
  removal?: RemovalSpec;      // 切开/解开/治疗/等待
  expiresAt?: number;         // tick；空 = 不会自然消失
}
```

当前 demo 的状态可以一一映射，且**不再需要 per-action 分支**：

| 当前状态 | v2 约束 |
|---|---|
| `bound_hands` | `block(grasp)`、`block(precision)`、`scale(force, .2)`、`signal("restrained")`，锚点双手 |
| `tether` | `limit(1m)`，锚点空间 |
| `blindfold` | `block(sight)`、`signal("blindfolded")` |
| 左臂刀伤 | `scale(force,.5)`、`scale(precision,.6)`、`drain(blood,.2)`、`signal("blood")`、`damage(leftArm,2)` |
| 低烧 | `scale(cognition,.7)`、`scale(endurance,.7)`、`drain(stamina,.1)` |
| 醉酒 | `scale(cognition,.6)`、`scale(balance,.5)`、`impair(hearing,.2)` |
| 失去意识 | `block(all)`，由 `consciousness` 阈值自动生成 |

### 3.4 新约束怎么来

三层：

1. **模板库（数据）**：`restraint / wound / poison / blind / deaf / exhaustion / fear / exposure / disease / intoxication`。每类有参数范围，比如 `wound { part, severity 1-4, bleeding }`。
2. **组合**：没有合适模板时，LLM 只能用 7 个原语组合，并给出锚点和移除条件；规则校验数值范围、锚点存在、是否与既有约束冲突。
3. **固化**：反复出现的组合提升为模板（数据），进入评审，不改代码。

LLM 负责"这是什么伤、怎么描述、能不能移除"；规则负责"它让哪些维度变成什么样"。

### 3.5 一个例子：被藤蔓缠住

```json
{
  "kind": "restraint",
  "anchors": ["leftLeg", "rightLeg"],
  "effects": [
    { "op": "block", "dim": "mobility" },
    { "op": "scale", "dim": "force", "factor": 0.4 },
    { "op": "signal", "tag": "entangled", "visibility": "observable" }
  ],
  "removal": { "actionTags": ["cut", "tear"], "instrumentTags": ["blade"], "minForce": 0.3 },
  "description": "湿藤缠住脚踝，越挣越紧。",
  "sourceEventId": "evt_812"
}
```

没有新增任何动词，也没有新增 `entangled` 枚举；判定层只看 `mobility/force`。

---

## 4. 动作：自由意图 → ActionDemand

### 4.1 数据结构

```ts
/** 机械族：从 dims 推导，不让 LLM 选 */
type Family = "manual" | "locomotion" | "perception" | "vocal" | "impact";

interface ActionDemand {
  /** 推导值，不参与判定 */
  family?: Family;
  label: string;                       // 自由文本，给日志/叙述
  target?: EntityRef;
  instrument?: EntityRef;
  dims: Partial<Record<Dim, number>>;  // 硬需求，0..1
  assist?: Partial<Record<Dim, number>>; // 辅助需求，缺了打折
  parts: Partial<Record<PartId, number>>;
  durationTicks: number;
  noise: number;                       // 0..1
  visibility: "private" | "witnessed" | "public";
  harmPotential: number;               // 0..1
  intentTags: string[];                // social / attack / defend / deceive...
}
```

> **V3 实测结论：family 不能由 LLM 选。** 让编译器从 8 个 family 里选时，"把血抹在墙上吓唬他"会在 social 与 manipulate 间摇摆，"把手伸出栏杆"会被归成 move；20 条里 family 只命中 17。改为只输出 `dims/assist`，family 由需求向量推导、社交/攻击/防御放进 `intentTags` 后，100 条达到 100/100 合法、6 条本体依赖进入 `ontologyTags`、6 条跨世界差异、95/95 family、漂移 -0.04。

### 4.2 编译流程

```
自由意图（Mind 输出）
   │
   ├─ 1. 检索：ActionProfile 库（embedding/关键词）
   │      命中 → 用 profile 的 demand，按目标/工具微调
   │
   ├─ 2. 编译：未命中 → LLM Action Compiler
   │      输入只有"任务/目标/工具/手法"，不含角色能力/身体
   │      输出 dims/assist + intentTags + 置信度
   │
   ├─ 3. 校验：维度范围、硬/辅分离、多通道、时长上限
   │      family 由 dims 推导，不让 LLM 选
   │      ontologyTags 交给世界规则；编译器不判“是否可能”
   │      不合法 → 回退最近的 profile；记 COMPILER_FALLBACK
   │
   ├─ 4. 缓存：signature = hash(label 规范化 + target 类型 + instrument 类型)
   │
   └─ 5. 固化：重复出现且人工复核 → 提升为 ActionProfile
```

**关键**：Compiler 看不到角色当前能力，避免"我很弱，所以把需求说低"的自我服务偏差；它只判断任务本身在物理上要求什么。

### 4.3 判定：瓶颈分，不是加权平均

当前 demo 用加权平均，会把"绑住的手"平均掉。v2 用**最弱环节**：

```
cap_d = 该维度当前能力（0..1，由部位 + 约束算出）
margin_d = cap_d / max(q_d, ε)      // q_d 是需求
m = min(margin_d)                   // 瓶颈
可行 = 无 block 且 m ≥ m_min        // m_min 例如 0.15
C = 100 × min(1, m)
p = sigmoid((C − D) / scale)
```

这样：
- 绑手时 `grasp/precision` 的 margin 接近 0，`take` 无论腿多有力都不可行；
- 手松开后同一动作立刻可行；
- 不再需要给每个动词写 `minCapability`。

### 4.4 三个算例

| 自由动作 | Demand（节选） | 约束影响 | 结果 |
|---|---|---|---|
| "用牙咬住炭笔" | grasp .3, precision .1, 嘴/头 | 手被绑不影响嘴 | 可行，低 C |
| "把泥板塞进草堆" | grasp .5, precision .4, reach .3, sight .2 | 绑手 → `block(grasp)` | 不可尝试 |
| "隔着石门听隔壁" | hearing .6 | 身体听觉得分高；墙在空间侧 | 可尝试，DC 高，只给碎片 |

### 4.5 防钻空子

- Compiler 盲于能力/约束；
- 硬/辅分离 + 维度范围校验，避免"感知动作要求发力"这类离谱需求；
- 多通道动作允许多个硬维度，不强行归入单一 family；
- **本体依赖写成 `ontologyTags`，由世界规则决定可行性**；编译器不输出 "impossible"；
- 需求与意图文本做一致性校验（可选的 IntentVerifier）；
- 同一角色对同类任务的 demand 分布做漂移审计；
- DM 看 demand（任务难度），不看能力；需求过大时 DM 可以加难度，但不能改需求。

---

## 5. Character 组件：PC 与 NPC 共用

### 5.1 数据

```ts
interface Character {
  id: CharacterId;
  tier: "pc" | "major" | "supporting" | "background" | "crowd";
  identity: Identity;        // 人设、价值、禁忌、声音
  body: BodyState;           // 部位、资源、约束
  mind: MindState;           // 记忆、知识、目标、情绪、注意
  social: SocialState;       // 关系、名声、阵营
  schedule: Schedule;        // 日程、需求
  presence: Presence;        // 位置、可见性、群体归属
}
```

### 5.2 运行时策略

同一个 `CharacterRuntime`，用策略组合差异：

| 策略 | 选项 |
|---|---|
| `decision` | `llm-every-turn` / `llm-on-event` / `utility` / `schedule` / `aggregate` |
| `memory` | `full` / `summary` / `index` / `none` |
| `perception` | `detailed` / `coarse` / `aggregate` |
| `persistence` | `persistent` / `summarized` / `pooled` / `crowd` |
| `narration` | `character` / `narrator` / `none` |

PC 与 NPC 的接口完全一致：

```ts
interface CharacterRuntime {
  perceive(world: WorldView, level: ViewLevel): Perception;
  decide(ctx: DecisionContext): Promise<Intent | null>;
  act(intent: Intent): ActionResult;
  onEvent(event: WorldEvent): void;
  snapshot(): CharacterSnapshot;
}
```

PC 和 NPC 都走 `perceive → decide → act`；区别只是 `Channel`（玩家信道）和策略组合。

### 5.3 为什么"NPC 像主角一样"不等于"每个 NPC 每 tick 都调 LLM"

NPC 的行动确实由 LLM 产生——**在它值得被 LLM 产生的时候**。

不在焦点内时，用规则维持它的世界状态；当它重新进入焦点，LLM 接管，并从摘要/日志里恢复记忆。

这不是"两套 NPC"，而是同一个 Character 在不同 **LOD（细节层级）** 下运行。

---

## 6. NPC 生命周期与注意力预算

### 6.1 分层

| 层 | 数量级 | 存在性 | 决策 | 记忆 | LLM |
|---|---|---|---|---|---|
| PC | 1 | 永久 | 玩家 + LLM | full | 每轮 |
| T0 主要 | 5–20 | 永久 | 自主 + LLM | full/summary | 焦点内每决策 |
| T1 配角 | 20–100 | 区域内存续 | LLM on event | summary/index | 每个事件 |
| T2 背景 | 数百 | 池化/按需 | utility/schedule | none | 仅被直接交互时 |
| T3 群体 | 数十群 | 聚合 | aggregate | 群体统计 | 每个群体事件 1 次 |

### 6.2 重要性

```
importance =
  0.30 × plotRelevance
+ 0.25 × relationshipToPC
+ 0.20 × proximity
+ 0.15 × recency
+ 0.10 × playerAttention
```

- 晋升阈值 0.7，降级阈值 0.4，滞回避免抖动；冷却 ≥ 1 世界日。
- 每世界小时重算一次，不每 tick 重算。

### 6.3 LLM 控制档位（按相关性）

| 档位 | 条件 | 控制方式 |
|---|---|---|
| `focus` | 同房间 + 直接互动 | 每个决策一次 LLM；详细感知 |
| `near` | 同聚落/事件参与者 | 每个事件一次 LLM；聚合感知 |
| `ambient` | 在附近但未互动 | 日程/效用策略；批量 LLM 台词 |
| `offstage` | 不在场 | 规则/统计演化；不调 LLM |

每 tick 有 LLM 注意力预算 K（例如 3 个并发角色），按 importance × relevance 取 top-K；PC 永远入选。

### 6.4 晋升 / 降级 / 回收

- **晋升**：从模板 + 当前情境生成身份、身体、初始记忆；保留同一 `id` 与确定性种子，保证再次观察一致。
- **降级**：压缩成 `CharacterRecord`（身份、关系、关键记忆、位置、日程、最后状态），丢掉逐部位细节。
- **回收**：只在"从未被观察且远离"时允许；若曾被观察，保留 tombstone，保证 P1"同一世界重复观察一致"。
- **重新进入**：按时间差推进日程与事件，补一段"这段时间发生了什么"的摘要；不假装它停在原地。

### 6.5 群体 NPC

```ts
interface Crowd extends Character {
  tier: "crowd";
  memberCount: number;
  mood: Distribution;       // 恐惧/愤怒/好奇...
  cohesion: number;
  representativeIds: string[];
}
```

- 群体行动一次判定，作用于分布；不逐个成员掷骰。
- 被 PC 点名/注视的成员 **个体化**：从群体分布采样，生成 T1 角色，群体成员数 -1。
- 成员回到群体时合并统计；个体身份保留，避免"同一个人不认得"。
- LLM 只处理群体摘要与集体反应（"人群后退半步"），不生成 N 条台词。

---

## 7. 在世界 demo 里怎么验证

| ID | 检查 | 方法 | 通过线 |
|---|---|---|---|
| CM-1 | 组件复用 | PC 与 NPC 走同一个 `CharacterRuntime` 接口 | 同一套 contract test 全过 |
| CM-2 | 约束等价 | 旧 `bound_hands/tether/blindfold` 与新约束在 20 个脚本动作上判定一致 | 一致率 100% |
| CM-3 | 需求等价 | 12 个旧动词映射为 profile 后，C/D/p 与 v0 偏差 | 偏差 ≤ 5% |
| CM-4 | 编译器 | 100 条自由动作：合法率、语义漏项、世界矩阵、端到端 | 合法 ≥ 98%；语义漏项 0；世界矩阵全过；e2e 可解释 |
| CM-5 | 预算 | 角色对话 + WorldDirector 事件提案两类调用 | 总 ≤30/日；角色 ≤22；WorldDirector ≤8；offstage 角色 0 |
| CM-6 | 身份连续 | 降级→晋升 20 次，关键身份/关系事实保留 | 100% |
| CM-7 | 群体一致 | 个体化→合并→再观察，身份与群体统计一致 | 100% |
| CM-8 | 知识边界 | 背景 NPC 不知道未目击事件 | 0 次泄漏 |

世界 demo 负责 CM-1/5/6/7/8；具身 demo 负责 CM-2/3/4。

验证协议、执行矩阵与结果（V1/V2/V3；世界 B0–B3 已执行）见 [VALIDATION.md](VALIDATION.md)。

---

## 8. 迁移路径（不推倒重来）

| 阶段 | 做什么 | 退出标准 |
|---|---|---|
| P0 | 冻结当前 v0 为基线；保留 12 动词作为参考 profile | 现有 64 个测试全绿 |
| P1 | 引入 `Constraint` + 7 原语 + 14 维度；把 5 个旧状态映射过去 | CM-2 通过 |
| P2 | 引入 `ActionDemand` + 瓶颈评分；12 动词降级为 profile | CM-3 通过 |
| P3 | 抽 `CharacterRuntime`；PC 先接，NPC 用同一接口 | CM-1 通过 |
| P4 | 世界 demo 接 T0–T3、注意力预算、群体 | CM-5–8 通过 |

不做的：
- 不一次性删除 12 动词；它们是稳定先验，保留为 profile 库。
- 不让 LLM 直接写状态；仍然只提案，规则落账。
- 不追求"任意动作都能判"；无法编译的动作返回"你不知道怎么做"，也是世界内结果。

---

## 9. 风险与未决

| 风险 | 缓解 |
|---|---|
| Compiler 把需求说低（自我服务） | 盲于能力、硬/辅分离、需求漂移审计 |
| 约束组合出现极端叠加 | 数值 clamp、互斥表、灾难组合测试 |
| NPC 降级后"不像同一个人" | 身份 hash + 关键记忆 + tombstone；晋升时恢复 |
| 群体个体化后统计不一致 | 个体化扣减成员、合并回写；CM-7 |
| 成本反弹 | 注意力预算、profile 缓存、批量台词 |
| 维度不够用 | 先只加"新维度"评审，不从动作层打补丁 |

未决：

1. 14 个维度是否够？`socialPresence` 是否单列？（`smell/touch` 已由 V3 补入）
2. 5 个机械族是否够用？多通道动作是否需要按主通道拆分展示？
3. 重要性权重与晋升阈值需要世界 demo 数据校准。
4. 群体个体化的采样策略（按分布/按代表）待验证。
5. DM 是否应该看到 `ActionDemand`：本文建议"看需求、不看能力"，需要在 E1 里一并验证。

---

## 10. 与现有文档的关系

- `PRD.md`：不变；本文不改变任何可观察行为要求。
- `DESIGN.md` §1/§7：v0 分层与 effect 词表；本文是它的"开放表面"扩展。
- `../demos/embodied/DESIGN.md`：当前 12 动词/状态是 v0 基线；P1–P3 在此 demo 验证。
- `../demos/world/DESIGN.md`：NPC 分层、生命周期、群体、注意力预算在此 demo 验证（CM-5–8）。
- `DEMO_PLAN.md`：里程碑不变；P1–P4 属于 A3 之后的架构收敛，不阻塞当前 demo。
