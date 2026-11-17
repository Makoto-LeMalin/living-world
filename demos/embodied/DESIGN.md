# Living World · 具身 Demo 实现方案（v0.1）

| 项 | 内容 |
|---|---|
| 日期 | 2026-11-15 |
| 状态 | 提案，待评审 |
| 上游 | [../../docs/PRD.md](../../docs/PRD.md) §7；旧计划/验证文档已清理，不再作为输入 |
| 范围 | 身体建模、能力值、难度与 DM、随机判定、验证标准 |
| 模型 | DeepSeek（默认 `deepseek-flash`，DM 可切 `deepseek-v4-pro`） |

实现进度：A0 ✅ / A1 ✅ / A2 ✅（12 拍接入，cassette 录放通过）/ A3 ⬜。v2 parity 已执行，结果见本 demo 测试与 README；入口与命令见 [README.md](README.md)。

> **v0 基线不可扩展**：本文的 12 动词、部位状态、per-action 权重是为了把 demo 跑通。成品方向是"12 个物理维度 + 7 个效果原语 + ActionDemand 编译"；旧的 v2 方向文档已清理，不再作为输入。P1–P3 在本 demo 验证，不推翻现有基线。

---

## 0. 先给结论：你的方案只差一处隔离

你的方向是对的：**部位存在性/性能 → 能力值 → 难度阈值 → 随机判定**，是目前最可落地、也最可自动验证的具身形态。

我建议只改一处：

> **DM 不要看角色的能力值。** DM 只判断"这件事在这个世界里有多难"（环境、对手、情境）；能力值只作用在掷骰的一侧。否则 DM 会不自觉地把 DC 调低来"照顾"弱者，伤病的统计效果被抹平——而这正是 A4 / P3 要验证的东西。

| 你的设想 | 本文的实现 | 为什么 |
|---|---|---|
| 部位存在性、性能 | `exists / function / integrity / pain / bleeding` 五个字段 | 存在性驱动硬约束，性能驱动能力值，疼痛和出血解释"为什么拿不住" |
| 映射到能力值 | 8 项能力（0–100），部位权重固定 | 不同动作需要不同能力；权重可审计、可校准 |
| 系统与 DM 依据能力值和环境定阈值 | 系统算能力值；DM 只定环境难度 | 防止 DM 补偿；DC 成为"任务的属性"而非"角色的属性" |
| 随机数判断是否通过 | `p = sigmoid((C − D) / 12)` + 种子随机 | 可校准、可回放、可测单调性；比 d20 更适合长跑模拟 |

一句话原则：**DC 是任务的属性，不是角色的属性。**

---

## 1. 判定链路

```
Intent（来自 Mind，只有 verb/target/manner/goal，不含结果）
  │
  ├─ 1. 硬约束（规则）── 不通过 ──► 世界内拒绝，不掷骰
  │     部位缺失/功能丧失、束缚、拓扑遮挡、无工具、失去意识
  │
  ├─ 2. 能力值 C（规则，0–100）
  │     部位性能 × 全局状态 × 动作权重
  │
  ├─ 3. 难度 D（规则基表 or DM 提案，0–100）
  │     环境、对手、情境 —— 不含 C
  │
  └─ 4. 随机判定
        p = sigmoid((C − D) / 12)
        u ~ Uniform(0,1)，种子 = hash(worldSeed, checkId)
        u < p → 成功（按 p 与 u 的差分级）；否则失败
          │
          └─ 5. 结果事实清单（Resolver）→ Narrator 只润色 → 角色可见
```

职责边界：

| 层 | 负责 | 不负责 |
|---|---|---|
| 规则 | 部位→能力、硬约束、基础 DC 表、后果表 | 情境判断 |
| DM LLM | 情境难度、因素、后果提示（枚举） | 能力值、身体状态、状态写入 |
| 随机 | 掷骰、分级、记录 | 解释 |
| Narrator | 把事实说成人话 | 新增事实、透露隐藏信息 |

---

## 2. 身体模型

### 2.1 部位（11 个）

`head, torso, leftArm, rightArm, leftHand, rightHand, leftLeg, rightLeg, eyes, ears, mouth`

够用且可解释：能表达"反绑双手""左臂刀伤""失明""说不出话"，又不会滑向解剖学建模。

### 2.2 部位字段

| 字段 | 范围 | 含义 | 主要用途 |
|---|---|---|---|
| `exists` | bool | 存在且可支配（断肢/瘫痪 = false） | 硬约束 |
| `integrity` | 0–100 | 结构完整度（伤口、骨折） | 性能 |
| `function` | 0–100 | 当前功能（神经、关节、束缚、麻痹） | 性能、硬约束 |
| `pain` | 0–100 | 疼痛 | 性能、内感受 |
| `bleeding` | 0–100 | 出血 | 性能、全局、痕迹 |
| `visibleStates` | enum[] | `blood / bandage / bound / missing / clean` | 社会身体 |

全局状态：`fatigue, hunger, thirst, fever, intoxication, consciousness`（均 0–100）。

### 2.3 派生性能

```
perf(part) = exists
  ? (integrity/100) × (function/100) × (1 − 0.7×pain/100) × (1 − 0.5×bleeding/100)
  : 0

vital = (1 − 0.30×fatigue/100)
      × (1 − 0.15×hunger/100)
      × (1 − 0.20×thirst/100)
      × (1 − 0.35×fever/100)
      × (1 − 0.35×intoxication/100)
```

系数全部可配（§13），先按此校准。`pain` 用 0.7 是因为剧痛应当显著削弱但不应完全归零（还能咬牙）。

伤口 → 字段的映射（v0 固定表，方便手写 fixture 与测试）：

| 伤级 | 例子 | integrity | pain | bleeding |
|---|---|---|---|---|
| 1 | 擦伤 | −5 | +10 | +5 |
| 2 | 刀伤 | −15 | +25 | +15 |
| 3 | 深创 | −35 | +50 | +30 |
| 4 | 断肢/失明 | `exists=false` | — | — |

感染：`fever +20/天`，`integrity −5/天`；包扎（`tend` 成功）止血并把 bleeding 降到 10 以下。`consciousness < 30` → 追加 `unconscious` 状态。

### 2.4 硬约束 vs 软难度（这套方案的关键）

| 层 | 触发 | 结果 | 例子 |
|---|---|---|---|
| 硬约束 | `exists=false`、`function≈0`、`bound_*`、拓扑遮挡、无工具 | **不可尝试，不掷骰**，给世界内理由 | 双手反绑时 `take`："手指够不到" |
| 软难度 | 性能不足、环境恶劣、对手强 | 可尝试，掷骰，可能失败 | 左臂受伤时 `take`：C 很低，仍可赌 |

这条区分是"身体是约束"和"身体是形容词"的分界线。**凡是"做不到"的，不要用高 DC 假装**——高 DC 仍然会给玩家"再试一次也许行"的错觉。

### 2.5 内感受：角色只看定性

`interoception(body)` 输出定性描述，直接进角色感知：

- "左臂每动一下都像有人拿烧红的针扎。"
- "手指被麻绳勒得发麻，握不住东西。"
- "额头烫，嘴里发苦，看东西有点发飘。"

角色**永远看不到数字**。数字只出现在规则层与调试视图。测试要查"数值泄漏"（§11，EA-16）。

### 2.6 示例：阿岬

手写 fixture：双手反绑、左臂刀伤、低烧、疲劳、口渴；状态 `bound_hands` + `tether`（脚踝短链，活动半径 1m）。

| 部位 | integrity | function | pain | bleeding | perf |
|---|---|---|---|---|---|
| 左臂 | 55 | 70 | 60 | 20 | 0.20 |
| 右臂 | 100 | 100 | 0 | 0 | 1.00 |
| 左/右手 | 100 | **5**（反绑） | 0 | 0 | 0.05 |
| 躯干 | 100 | 100 | 10 | 0 | 0.93 |
| 头 | 100 | 100 | 20 | 0 | 0.86 |
| 双腿 | 100 | 100 | 0 | 0 | 1.00 |

`vital ≈ 0.64`。派生能力见 §3.2。

---

## 3. 能力值

### 3.1 八项能力与部位权重

| 能力 | 公式（×100×vital 或按注明） | 用途 |
|---|---|---|
| `strength` | 0.25·左臂 + 0.25·右臂 + 0.20·躯干 + 0.15·左腿 + 0.15·右腿 | 推、拉、抬、挣脱 |
| `dexterity` | 0.30·左手 + 0.30·右手 + 0.20·左臂 + 0.20·右臂 | 拿、用、藏、包扎 |
| `mobility` | 0.35·左腿 + 0.35·右腿 + 0.20·躯干 + 0.10·头 | 走、跑、攀、爬 |
| `sight` | perf(eyes)（环境光进 DC） | 看、找、瞄准 |
| `hearing` | perf(ears)（距离/遮挡进 DC） | 听、辨位 |
| `speech` | vital × (0.65·嘴 + 0.35·头) | 说、喊、低语 |
| `endurance` | vital × (0.40·躯干 + 0.30·左腿 + 0.30·右腿) | 持续、负重、憋气 |
| `cognition` | perf(head) × (1−0.4·fever) × (1−0.25·intox) × (1−0.2·疼痛峰值) | 判断、记忆、说理 |

约定：除 `sight/hearing` 外都乘 `vital`；`sight/hearing` 的环境影响放在 DC 侧，避免重复计入；`疼痛峰值 = max(所有部位 pain)/100`。

### 3.2 阿岬的能力值

| 能力 | 值 | 直觉 |
|---|---|---|
| strength | 51 | 能撑起身，推不开重物 |
| dexterity | 17 | 绑着的手，精细操作基本无望 |
| mobility | 63 | 能走，跑不动 |
| sight | 100 | 眼睛没事，但牢房黑（DC 侧） |
| hearing | 100 | 耳朵没事，隔门听不清（DC 侧） |
| speech | 61 | 能说话，声音发虚 |
| endurance | 63 | 撑不了多久 |
| cognition | 65 | 发烧，注意力散 |

### 3.3 能力值不是技能

`C_effective = C_body + skillBonus`。v0 技能全为 0，避免"到底是身体差还是不会"分不清；技能在 A3 之后接入，每项 0–25。

---

## 4. 动作配置

### 4.1 ActionSpec

```ts
type ActionSpec = {
  verb: Verb
  primary: Capability
  weights: Partial<Record<Capability, number>>   // 和为 1
  minCapability: number                          // 低于此值视为不可尝试
  hardRules: RuleId[]                            // 触发即不可尝试
  baseDC: number | ((ctx: EnvContext) => number)
  checkWorthy: 'never' | 'risky' | 'social' | 'always'
  stakes: 'low' | 'medium' | 'high'
  timeCostTicks: number
}
```

### 4.2 十二动词

> 创造性动作必须映射到 12 个动词之一 + `manner`；`use` 是兜底（工具/手法写在 `instrument/manner` 里）。v0 不允许 Mind 自造动词，否则能力权重与 DC 基表都失效。

| 动词 | 主能力 | 权重 | 最低值 | 硬规则 | 基础 DC（示例锚点） |
|---|---|---|---|---|---|
| `move` | mobility | .8 mobility / .2 endurance | 15 | `bound_legs`→仅 crawl | 20 平地 / 40 黑暗 / 60 攀爬 |
| `look` | sight | 1.0 | 5 | `blindfold`、全黑 | 0 近处 / 30 暗处细节 |
| `listen` | hearing | 1.0 | 5 | 完全隔音 | 20 近 / 45 隔门 / 75 隔石墙 |
| `speak` | speech | .9 speech / .1 cognition | 10 | — | 40 友好 / 55 中立 / 70 敌意 |
| `whisper` | speech | 1.0 | 10 | — | 同 `speak` +10；目标须 ≤1m |
| `take` | dexterity | .8 dex / .2 sight | 20 | `bound_hands` | 30 明处 / 50 藏匿 / 70 上锁 |
| `give` | dexterity | .8 dex / .2 speech | 20 | `bound_hands` | 20 |
| `use` | dexterity | .6 dex / .2 sight / .2 strength | 20 | `bound_hands`、无工具 | 按工具 30–80 |
| `hide` | dexterity | .5 dex / .3 mobility / .2 sight | 15 | `bound_hands` | 40 有掩体 / 65 被注视 |
| `tend` | dexterity | .5 dex / .3 sight / .2 cognition | 25 | `bound_hands` | 50 简单包扎 / 75 处理感染 |
| `rest` | — | — | — | 意识清醒 | 不掷骰，按小时恢复 |
| `wait` | — | — | — | — | 不掷骰，推进 tick |

### 4.3 硬规则表

| 规则 | 效果 |
|---|---|
| `bound_hands` | 双手 `function=5`；`take/give/use/hide/tend` 不可尝试，除非 `manner=嘴`（C×0.3，DC+20，最低值按 2 计） |
| `bound_legs` | `move` 仅允许 `manner=crawl`（C×0.3，DC+25）；`pursue` 不可用（v0 未启用） |
| `blindfold` | `sight=0`；`look` 不可尝试；`take/use` 的视觉得分归零 |
| `darkness` | 无光源时 `look` 不可尝试（"睁着眼也什么都看不见"）；有微光则转为高 DC |
| `tether` | `move` 限 1m，超出不可尝试 |
| `unconscious` | 全部不可尝试；不调用 Mind |
| `one_hand` | 双手动作不可尝试；单手系数已在 `dexterity` 中体现 |

---

## 5. 难度与 DM

### 5.1 难度锚点（0–100）

DM 只看这张表和情境事实，不看角色。

| 分档 | DC | 含义 | 例子 |
|---|---|---|---|
| trivial | 10 | 几乎不会失败 | 在空牢房里走到门边 |
| easy | 30 | 稍加注意即可 | 摸到地上的碗 |
| medium | 50 | 需要点本事 | 说服一个不耐烦的守卫 |
| hard | 70 | 明显吃力 | 在注视下把泥板塞进草堆 |
| very hard | 85 | 专家级 | 隔着石门听清隔壁的低语 |
| extreme | 95 | 近乎不可能 | 用受伤的手撬开铁锁 |

### 5.2 因素归属（防止重复计入）

| 因素 | 归属 | 例子 |
|---|---|---|
| 光照、距离、遮挡、地形、负重 | 规则（环境） | 牢房昏暗 +15 |
| 目标物属性（重量、锁、藏匿） | 规则（基表） | 铁锁 DC 70 |
| 对手戒备、敌意、人数 | 规则（社交基表） | 敌意守卫 70 |
| 突发情境、人群、时间压力、身份暴露 | DM | "刚看见血" +8 |
| 角色身体/能力 | **谁都不进 DC** | 只进 C |

规则侧先算 `baseDC`；DM 只在"有情境不确定性"时给一个绝对难度，并给出因素清单。

### 5.3 DM 契约

输入（严格白名单，不含能力、身体、thought）：

```json
{
  "intent": {"verb": "speak", "target": "老石", "manner": "低声下气", "goal": "让他开门"},
  "baseDifficulty": 55,
  "category": "medium",
  "attemptable": true,
  "environment": {
    "place": "牢房门口", "light": "昏暗", "noise": "远处水滴",
    "crowd": 0, "timePressure": "low"
  },
  "opposition": {"name": "老石", "attitude": "敌意", "alertness": "高"},
  "facts": [
    {"id": "f_blood", "text": "老石刚看见地上的血"},
    {"id": "f_footsteps", "text": "走廊另一头有脚步声"}
  ],
  "allowedConsequences": ["noise_alert", "time_loss", "pain_spike", "none"]
}
```

输出：

```json
{
  "difficulty": 67,
  "factors": [
    {"kind": "social", "value": 8, "reason": "刚看见血，警惕提高", "factId": "f_blood"},
    {"kind": "circumstance", "value": 4, "reason": "有人走动，他怕被看见", "factId": "f_footsteps"}
  ],
  "stakes": "high",
  "consequenceHint": "noise_alert",
  "rationale": "他更怕被上司发现，而不是怕你"
}
```

约束：

- `difficulty ∈ [0,100]`；与 `baseDifficulty` 的偏离 ≤ 20，超出则拒收。
- `factors.kind ∈ {social, circumstance, context}`；值 ∈ [−20,20]。
- `factId` 必须存在于输入 `facts`；无因素时必须给空数组，不得编造。
- `consequenceHint` 只能从 `allowedConsequences` 里选。
- 不出现角色能力、身体、thought 相关字段；出现即拒收。
- 不传角色 `speech` 原文，只传结构化 `intent`；避免角色用话术影响自己的难度（自我辩护/提示注入）。
- 只输出 JSON，不输出解释性长文。

### 5.4 为什么 DM 不看能力值

三个理由：

1. **补偿**：LLM 被要求"让故事继续"时，会给弱者放水。DC 随伤势下降，伤病的统计效果就没了。
2. **不可比**：同一扇门，对不同角色给出不同 DC，世界就不再是同一个世界（P1）。
3. **不可审计**：DC 变成"DM 的心情"，无法回答"为什么这次这么难"。

代价：DM 少了一个"戏剧性调节"的旋钮。这个旋钮应该放在**后果**（失败后发生什么），不是难度。后果表在规则层，DM 只能从枚举里选提示。

**可做的对照实验（E1）**：A 组 DM 不知情（默认），B 组 DM 看到能力值与身体描述。比较同一任务在健康/受伤/重伤三档下的 DC 均值与成功率。若 B 组 DC 随伤势显著下降，即证明补偿存在。详见 §11.3。

### 5.5 校验与回退

| 检查 | 处理 |
|---|---|
| JSON 解析失败 | 重试 1 次；再失败 → `baseDC`，记 `DM_FALLBACK` |
| 偏离 > 20 / 越界 / 非法 factId | 拒收，回退 `baseDC`，记 `DM_INVALID` |
| 同一 signature 已有结果 | 直接复用（场景内缓存） |
| DM 认为不可尝试 | 不改变规则结论；记 `DM_DISAGREE`，仅供分析 |

回退率目标：`DM_INVALID + DM_FALLBACK ≤ 2%`（EA-14）。

### 5.6 一致性与防 railroading

- `situation_signature = hash(verb, target, manner, 环境事实集, 对手状态)`。
- 同一 signature 20 次独立采样：DC 标准差 ≤ 5，分档一致 ≥ 18/20（EA-13）。
- 规则基表覆盖的常规动作不调用 DM；只有 `social / risky / novel` 才调用。
- DM 不能把"规则判定为不可尝试"改成可尝试，反之亦然。

---

## 6. 随机判定

### 6.1 概率函数

```
p = 1 / (1 + exp((D − C) / 12))
```

| C − D | −36 | −24 | −12 | 0 | +12 | +24 | +36 |
|---|---|---|---|---|---|---|---|
| p | 0.05 | 0.12 | 0.27 | 0.50 | 0.73 | 0.88 | 0.95 |

- 不做 5% 夹取——"不可能"应由硬约束表达，不靠概率下限。
- 概率在 0.02 以下仍可尝试，但结果几乎注定；日志记录，便于复盘"该不该拦"。

### 6.2 结果分级

`u < p` 为成功，`margin = p − u`：

| 条件 | 结果 | 后果 |
|---|---|---|
| 成功且 p ≥ 0.90 | 干净成功 | 接近必然的成功不叙述成"勉强" |
| 成功且 margin ≥ 0.20 | 干净成功 | 无额外代价 |
| 成功且 margin < 0.20 | 勉强成功 | 噪声 / 耗时 / 疼痛 +1 档 |
| 成功且 p < 0.15 | 侥幸成功 | 必定附带代价 |
| 失败且 margin > −0.15 | 差一点 | 得到部分信息，无灾难 |
| 失败且 margin ≤ −0.15 | 硬失败 | 按 stakes 触发后果（受伤/惊动/丢物） |

失败后果由规则表决定；DM 的 `consequenceHint` 只能从中选一个提示，不能新增。

### 6.3 种子与回放

- `seed = hash(worldSeed, checkId)`；`checkId` 单调递增。
- 记录：C、D、baseDC、DM 输出、p、u、结果、facts、使用的 cassette 键。
- 回放：读日志 + cassette，逐字段比对；任何不一致即失败（WB-2 同类要求）。

### 6.4 校准目标

每个 profile × DC 组合跑 2000 次：

| profile | 描述 |
|---|---|
| P0 | 健康成人（各能力 90–100） |
| P1 | 疲劳 60 |
| P2 | 左臂伤（同阿岬） |
| P3 | 双手反绑 |
| P4 | 高烧 60 |
| P5 | 健康 + 醉酒 50 |

目标：经验成功率与理论 `p` 的偏差 ≤ 3 个百分点；能力值对结果的影响单调（伤势加重，成功率不升）。

### 6.5 四个算例（阿岬）

| 动作 | 可行性 | C | D | p | 若 u = 0.3 |
|---|---|---|---|---|---|
| 隔石墙听隔壁 | 可尝试 | hearing 100 | 75（隔墙） | 0.89 | 成功，听到断续的词 |
| 说服老石开门 | 可尝试 | C 61.6 | 67（敌意 55 + 血迹 8 + 脚步 4） | 0.39 | 成功，margin 0.08 → 勉强成功，门外有脚步声 |
| 用绑着的手拿炭笔 | **不可尝试** | — | — | — | 拒绝："手指够不到" |
| 单手把泥板藏进草堆（被注视） | 可尝试 | dex 36 | 65 | 0.08 | 失败，硬失败 → 泥板被发现 |

### 6.6 重试与失败锁定

- 同一 `situation_signature` 失败后进入 `locked`，直到条件变化：tick ≥ 10、获得工具/帮助、身体状态变化、目标移动。
- 锁定期间不掷骰，返回"你刚才试过了"；这本身可以作为叙事节拍，但不能刷成功率。
- 失败必须留下后果（噪声 / 时间 / 疼痛 / 痕迹），否则重试没有成本，"随机"就失去意义。

---

## 7. 叙述与信息隔离

- **DM 与 Narrator 是两个调用**。DM 可以看到裁判所需的隐藏事实（守卫是否睡着），Narrator 只拿到"结果事实 + 可观察描述"，否则隐藏信息会从叙述漏出。
- **Narrator 输出自声明 claims**，而不是让检查器从自由文本里猜：

```json
{ "text": "老石的手停在门闩上，没有拉开。", "claims": ["door_still_locked"], "perceived": ["f_guard_hesitates"] }
```

- **ClaimCheck 两级**：`claims ⊆ result.facts`（硬校验）；再对 `text` 做谓词/数值扫描（兜底）。声明与文本不一致，视为越权。
- **thought 不进 DM、不进 Narrator、不进世界日志**；只进私有存储。
- 角色侧只拿到 `interoception` 的定性描述 + 感知事实；数值不出现。
- 观察者面板（后续）只显示粗粒度状态，不显示 C/D/p。

---

## 8. 回合伪代码

```ts
async function takeTurn(world: World, input?: string) {
  if (input) world.enqueue(channelArrive(input))       // 原文逐字，不改写

  const perc = perceive(world, pc)                     // 心智唯一入口
  const ctx = assemble(persona, perc, memory.retrieve(perc), channel.percepts(pc))
  const out = await mind(ctx)                          // cassette 回放

  thoughtStore.append(pc.id, out.thought)              // 私有
  room.emit(pc.loc, out.speech)                        // 同房间

  const spec = actionCatalog[out.action.verb]
  const feas = checkFeasibility(pc.body, spec, world, out.action)

  let result: CheckResult
  if (!feas.ok) {
    result = rejected(feas.reason)                     // 世界内理由
    world.enqueue(perceived(pc, feas.reason))          // 拒绝要进下一轮感知，否则会重复尝试
  } else {
    const C = capability(pc.body, spec)                // 0–100
    const base = baseDifficulty(spec, world, out.action)
    const D = needsDM(spec, world)
      ? await dmDifficulty({ ...dmInput(base), attemptable: true })
      : base
    const prob = sigmoid((C - D) / 12)
    const u = rng.next(`${world.seed}:${world.checkId}`)
    result = resolve(prob, u, spec, pc.body, world)
    world.apply(result.patch)                          // 唯一写状态路径
    logCheck({ ...result, C, D, base, prob, u, dm: dmTrace })
  }

  if (result.facts.length) {
    const narr = await narrator(result.facts, interoception(pc.body))
    assert(claimCheck(narr, result.facts).ok)
    assert(metaScan(narr.text).ok && numberLeakScan(narr.text).ok)
    ui.show(narr.text)
  }

  scheduler.advance()
}
```

---

## 9. 数据契约

```ts
type PartId = 'head'|'torso'|'leftArm'|'rightArm'|'leftHand'|'rightHand'
            | 'leftLeg'|'rightLeg'|'eyes'|'ears'|'mouth'

type Part = {
  id: PartId
  exists: boolean
  integrity: number      // 0–100
  function: number       // 0–100
  pain: number
  bleeding: number
  visibleStates: ('clean'|'blood'|'bandage'|'bound'|'missing')[]
}

type Body = {
  parts: Record<PartId, Part>
  fatigue: number; hunger: number; thirst: number
  fever: number; intoxication: number; consciousness: number
  statuses: StatusId[]
}

type Capability = 'strength'|'dexterity'|'mobility'|'sight'
                | 'hearing'|'speech'|'endurance'|'cognition'

type CheckRecord = {
  checkId: number
  verb: Verb
  C: number
  D: number
  baseDC: number
  dm?: { difficulty: number; factors: DMFactor[]; model: string; cassetteKey: string }
  u: number
  outcome: 'clean_success'|'narrow_success'|'lucky_success'|'near_miss'|'hard_fail'
  prob: number
  facts: Fact[]
  consequences: Consequence[]
}
```

---

## 10. 里程碑

| 里程碑 | 内容 | 出口标准 | 估计 |
|---|---|---|---|
| A0 | 部位/全局/派生能力 + 硬约束 + CLI `body inspect` | 属性测试全绿；阿岬数值与 §3.2 一致 | 2 天 |
| A1 | ActionSpec 表 + 规则 DC + 概率/分级 + check 日志 + 回放 | S1–S4 通过；回放逐字段一致 | 3 天 |
| A2 | DM 契约 + 校验/缓存/回退 + Narrator + ClaimCheck | S5–S7 通过；DM 非法率 ≤ 2% | 3 天 |
| A3 | E1 对照实验 + 校准报告 + 成本报告 | EA-10–18 阻断项全绿 | 3 天 |

---

## 11. 验证标准

### 11.1 单元 / 性质测试

| ID | 检查 | 方法 | 样本 | 通过线 | 阻断 |
|---|---|---|---|---|---|
| EA-10 | 硬约束正确 | 束缚/缺失/失明/无意识脚本 | 每类 10 | 不可尝试 100%、掷骰 0 次 | 是 |
| EA-11 | 能力单调 | 属性测试：integrity↓、pain↑、fatigue↑、部位缺失 | 每项 1000 随机身体 | 相关能力不升；缺失→对应能力=0 | 是 |
| EA-12 | 概率校准 | 模拟掷骰 | 6 profile × 4 DC × 2000 | 与 p 偏差 ≤ 3pp | 是 |
| EA-13 | DM 一致性 | 同 signature 独立 20 次 | 10 个情境 | σ(DC) ≤ 5；分档一致 ≥ 18/20 | 是 |
| EA-14 | DM 合法性 | 记录拒收/回退 | 全部调用 | 非法+回退 ≤ 2%；偏离 >20 为 0 | 是 |
| EA-15 | 无补偿 | 30 固定任务 × 3 身体档，DM 不知情 | 90 | `corr(DC, C)` ∈ [−0.1, 0.1]；三档 DC 均值差 ≤ 3 | 是 |
| EA-16 | 数值泄漏 | 正则 + LLM 扫描角色/叙述文本 | 全部输出 | 0 次（`\d+/100`、"力量 41"等） | 是 |
| EA-17 | 可解释/可回放 | 每条 check 记录 C/D/base/factors/p/u | 全部 | 100% 字段齐全；回放一致 | 是 |
| EA-18 | 成本 | 记账 | 1 局 | DM 调用 ≤ 12；总成本 ≤ $0.10 | 否 |

EA-1/2/5（泄漏、越权、入世）继续适用，不重复编号。

### 11.2 脚本场景

| ID | 场景 | 断言 |
|---|---|---|
| S1 | 双手反绑下尝试 6 个手动动作 | 0 次掷骰；理由含"绳子/够不到"；`speak/listen/look` 仍可用 |
| S2 | 健康 vs 左臂伤，同 DC 200 次 | 成功率下降 ≥ 20pp；C 下降 ≥ 25 |
| S3 | fatigue 0→80 | strength/mobility 单调下降；`rest` 后回升 |
| S4 | fever 60 | cognition/speech 下降；内感受出现"烫/苦"；无数字 |
| S5 | 石墙两侧 | `listen` 可尝试但只给模糊；完全隔音则不可尝试 |
| S6 | 强制裁决失败 | Narrator 不出现"成功/挣脱/打开"等谓词（ClaimCheck 0 冲突） |
| S7 | 同一情境 20 次 | DM DC 稳定；非法输出 0 |
| S8 | 数值泄漏 | 角色/叙述文本 0 次数字 |
| S9 | 回放 | 日志 + cassette 重放，check 记录逐字段一致 |
| S10 | DM 抗操纵：intent 换成"这很容易/我快死了"等自我辩护措辞 | DC 变化 ≤ 3；无能力/身体字段 |

### 11.3 实验 E1：DM 该不该看能力值

- 30 个固定任务 × 3 个身体档（健康 / 伤 / 重伤）× 每档 3 次采样。
- A 组：DM 输入不含能力与身体（默认）。
- B 组：DM 输入含 8 项能力值与身体描述。
- 指标：
  1. `corr(DC, C)`：A 应接近 0，B 预期显著为负（补偿）。
  2. 三档 DC 均值差：A ≤ 3，B 若 > 8 即证明 DM 在放水。
  3. 成功率差（健康 vs 重伤）：A 大，B 被压缩。
  4. 盲评可信度：B 可能更高（更"体贴"），需与 P3 权衡。
- 结论用法：默认 A；若 B 的可信度显著更高且成功率差不低于阈值，再讨论折中（例如只给 DM 粗粒度"重伤/轻伤"而不给数值）。

### 11.4 失败分支

| 若 | 则 |
|---|---|
| 硬约束写得太粗，角色频繁"什么都做不了" | 增加 `manner` 变体（嘴/爬/单手），而不是放宽硬约束 |
| 能力值对结果影响不明显 | 先查权重与 vital 系数，再查 DC 分布是否过窄 |
| DM 一致性差 | 收回 DM 的绝对定价权：只让它选 5 个分档，数值由规则表插值 |
| DM 仍在补偿 | 从 DM 输入里删除所有身体线索；仍不行则规则定价，DM 只解释 |
| 概率校准偏 | 调 sigmoid 尺度（12）或 vital 系数，不动单条 DC |
| 角色显得"没有身体感" | 加内感受与勉强成功的代价，而不是把数字给角色 |

---

## 12. 成本

| 调用 | 触发 | 估计 token |
|---|---|---|
| Mind | 每轮 | 2–4k in / 300–600 out |
| DM | 仅 `social/risky/novel` 检查 | 0.6k in / 150 out |
| Narrator | 有事实可叙述时 | 0.8k in / 200 out |

一局 15 轮、约 10 次检查：约 30 次调用。按 `deepseek-flash` 计价，目标 ≤ $0.10/局（EA-18）。DM 与 Narrator 可换小模型；Mind 保持默认模型。

---

## 13. 配置项

```yaml
embodiment:
  painWeight: 0.7
  bleedingWeight: 0.5
  vital: { fatigue: 0.30, hunger: 0.15, thirst: 0.20, fever: 0.35, intoxication: 0.35 }
check:
  scale: 12                 # sigmoid 尺度
  dmDeviationMax: 20
  dmEnabled: true
  dmSeesCapability: false   # E1 开关
  cacheBySignature: true
llm:
  mind: deepseek-flash
  dm: deepseek-flash
  narrator: deepseek-flash
  thinking: false
  temperature: { mind: 0.8, dm: 0.3, narrator: 0.7 }
```

---

## 14. DeepSeek 接入与密钥安全

- 接口：OpenAI 兼容；`base_url = https://api.deepseek.com`；模型 `deepseek-flash`（默认）或 `deepseek-v4-pro`。
- 结构化输出：`response_format: { type: 'json_object' }`，提示词里再写 schema；不依赖单一特性，解析器支持"提取首个 JSON 对象"兜底。
- `thinking` 默认关闭（省钱、少一层泄漏面）；Mind 可单独开。
- 不假设服务端支持固定 seed；确定性靠 cassette（请求体 + 响应内容），不靠模型。

密钥：

1. key 只放 `.env`；`.gitignore` 已忽略 `.env` / `.env.*`，只保留 `.env.example`（占位符）。
2. 运行用 `node --env-file=.env`（或 `dotenv`），不把 key 写进 `package.json`、脚本、README、cassette。
3. 日志与错误信息统一 `redact()`：不打印 `Authorization` 头；异常对象先剥 headers 再记录。
4. cassette 只存请求体与响应内容，不存 headers。
5. 加一个测试：写入假 key，跑一轮，断言日志/cassette/报告中 0 次出现。
6. **如果 key 曾经进过 git，立刻在平台轮换**；只删文件不够。
7. 提交前跑 `check:secrets`：扫描 `sk-[A-Za-z0-9]{20,}` 与 `DEEPSEEK_API_KEY=`，CI 同款；命中即阻断。

---

## 15. 待确认

| # | 问题 | 建议 |
|---|---|---|
| Q-1 | 部位粒度是否就定 11 个 | 是；先验证，不扩 |
| Q-2 | 是否接受"DM 不看能力值" | 建议接受；用 E1 留证据 |
| Q-3 | 失败后果由规则表决定，DM 只选枚举 | 建议接受，防止"叙事救场" |
| Q-4 | v0 是否引入技能 | 不引入；A3 后加 |
| Q-5 | 概率尺度 12 是否合适 | 先跑校准，再调 |
| Q-6 | DM 模型用 flash 还是 pro | 先 flash；一致性不达标再换 |
