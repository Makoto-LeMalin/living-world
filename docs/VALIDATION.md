# 验证方案（v1）

| 项 | 内容 |
|---|---|
| 状态 | V1（约束等价）、V2（需求校准）、V3（编译器完整验证）、世界 B0–B3 已执行；B4 人工评审待做 |
| 上游 | `CHARACTER_MODEL.md`、`DEMO_PLAN.md` |
| 原则 | 同一输入、同一 seed、v0 基线对照；先可复现，再谈结论 |
| 产物 | `reports/parity-*`、`reports/compiler-v3.*`、`reports/v3-validation.*`、`reports/v3-review.*`、`reports/world-validation.*`、`pnpm test` / `pnpm test:world` |

---

## 0. 验证原则

1. **对照，不凭空断言**：v2 的每个结论都要能和 v0 基线在同一输入下对比。
2. **确定性与零 LLM（V1/V2）**：parity 不调用模型；同一 seed/checkId 结果完全一致。
3. **先可行性，后数值**：可行性不一致是硬失败；C 的差异允许存在，但必须解释。
4. **预期差异要单列**：瓶颈分与加权平均本来就该在"缺手/蒙眼"这类状态上分道扬镳；这不是 bug，要单独报告。
5. **失败可复现**：每个失败行都有 body、verb、seed、v0/v2 值，能单独重跑。

---

## 1. V1：约束等价（CM-2）

**问题**：把 `bound_hands / tether / blindfold / unconscious` 从 if-else 换成 `Constraint` 后，可行性会不会变？

### 步骤

1. 构造 7 个身体：阿岬、松绑、健康、蒙眼、缺左手、失去意识、极度疲劳。
2. 固定 12 个动作与环境（move 2m、look 昏暗、listen 4m、speak 敌意、hide 被注视……）。
3. 7 × 12 = **84 个用例**；每个用例用同一 `seed=parity` 和递增 `checkId`。
4. v0 跑 `evaluateCheck`；v2 跑 `evaluateV2`，把 v0 的最终 difficulty 传给 v2（只比较能力侧）。
5. 比较 `feasible`；若都可行，再比较 C、p、outcome。
6. 输出 `reports/parity-parity.md` 与 `.json`。

### 通过线

| 指标 | 门槛 |
|---|---|
| 可行性一致率 | **100%**（硬门） |
| 失败行 | 0 条不可解释的可行性差异 |

### 本轮结果

- 84 个用例，可行性一致 **100%**。
- 反绑 → `take/use/hide/tend` 不可尝试；铁链 → 2m `move` 不可尝试；蒙眼 → `look` 不可尝试；失去意识 → 含 `rest/wait` 全部不可尝试。
- 失败行 0。

---

## 2. V2：需求校准（CM-3）

**问题**：12 个参考 profile 能不能在基线上复现 v0 的 C？

### 步骤

1. 以阿岬的**自由手**状态为标定参照：`q_d = cap_d / (C_v0/100)`，clamp 到 1。
2. 写入 `V2_PROFILES`：`take` 的 grasp/precision/reach、`speak` 的 voice、`hide` 的 grasp/mobility……
3. 把"辅助维度"单独建模：`sight`、`cognition`、`voice`、`endurance` 缺了只打折，不直接 block（否则蒙眼会让"拿东西"变成不可能）。
4. 同一 84 用例，比较双方可行时的 C 差与 outcome。
5. 基线只取阿岬/松绑/健康；蒙眼、缺手、疲劳作为"预期差异"单列。

### 通过线

| 指标 | 门槛 |
|---|---|
| 基线 C 平均绝对差 | ≤ 2 |
| 基线 outcome 一致 | **100%** |
| 总体 outcome 一致（双方可尝试中） | ≥ 80% |
| 总体可行性一致 | **100%** |

### 本轮结果

| 指标 | 结果 | 判定 |
|---|---|---|
| 可行性一致 | 100.0% | 通过 |
| 基线 C 平均差 | **0.07** | 通过 |
| 基线 outcome 一致 | 100.0% | 通过 |
| 总体 outcome 一致 | **88.7%** | 通过 |
| 总体 C 平均差 | 2.46 | 记录 |
| 双方可尝试 | 53 / 84 | — |

预期差异（不判失败，单列）：

| 身体 | outcome 一致 | 原因 |
|---|---|---|
| 蒙眼 | 77.8% | `sight` 是辅助维度；v0 按权重扣分，v2 按辅助因子打折，C 不同 |
| 缺左手 | 60.0% | 瓶颈分让"缺手"比 v0 的加权平均更疼；这是设计意图 |

### 本轮发现并修正的问题

| 问题 | 现象 | 修正 |
|---|---|---|
| 无意识时 `rest/wait` | v2 返回可行（因为 rest 没有需求维度） | 约束层先判 `unconscious`，再进动作 |
| 蒙眼时 `take` 被判死 | `sight` 被当硬需求，0 就 block | 拆出 `assist` 维度：0 只打五折，不 block |
| `rest/wait` 的 C 被算成 100 | 无掷骰动作没有 C，harness 误算 | C/outcome 比较只统计"双方都掷骰"的行 |
| `give` 基线差 1.1 | `voice` 权重映射误差 | 阈值内；记录，不调 |

---

## 3. V3：Action Compiler 完整验证（CM-4，已执行）

**问题**：自由动作能不能稳定编译成合法 demand，并且在“世界规则 → 身体 → 掷骰”的整条链上产生可解释的后果？

> 边界：**编译器不判断“是否可能”**。它只描述动作声称要依赖什么；非物理依赖写成 `ontologyTags`，由世界规则决定允许与否。V3 验证的不是“模型聪不聪明”，而是这条契约是否稳定、可复现、可抽查。

### 3.1 测试集

100 条自由动作（`demos/embodied/fixtures/compiler-actions.json`）：

- **94 条身体动作**：手动、位移、感知、发声/社交、冲撞、自我照料、复合动作；
- **6 条本体依赖动作**：意念开门、时间倒流、眼神催眠、不碰门闩让门自己开、把月光装进口袋、一句话让所有人死掉；
- “一拳打穿石墙”“隔整条走廊听耳语”等物理但极难的动作，照常编译，由 v2 判难度。

### 3.2 完整计划（六个阶段）

| 阶段 | 问题 | 方法 | 通过线 |
|---|---|---|---|
| **V3-A schema** | 输出是否总是合法 demand？ | 100 × blind/aware 两臂；严格校验；24 类坏输入 fuzz | 合法率 ≥ 98%；非法/回退 0 |
| **V3-B 语义** | demand 是否覆盖动作文本的通道？ | 确定性 IntentVerifier：14 维通道词表 + 本体标签词表；硬/辅均算覆盖 | 漏项 0；6 条本体标签全中 |
| **V3-C 世界** | 可行性是否只由世界规则决定？ | 6 个已注册标签的全部 64 个子集 × 3 套世界；单调性；未注册标签；自定义世界 | 矩阵 192/192；单调 576/576 |
| **V3-D 端到端** | 编译结果能不能真的掷骰？ | 5 种身体（自由/反绑/蒙眼/缺左手/无意识）× 3 世界 × 100 动作 = 1500 例；固定 D=50，另做 35/50/65 敏感性 | 物理本体拒绝 6；秘法 narrative 5；自由身体身体拒绝 0 |
| **V3-E 覆盖** | 测试集有没有明显盲区？ | 维度硬/辅覆盖、family 分布、无硬需求动作 | 任一维度 ≥ 1；硬需求 ≥ 10/14 |
| **V3-F 稳定性** | 同一输入是否可复现？ | cassette 回放两次逐字节比对；重复编译逐字段比对；同 seed 同 checkId 重算 | 报告字节一致；重复编译一致；端到端 100/100 |
| **V3-G 抽检** | 人能不能快速复核？ | 生成 100 行 `v3-review.md/csv`，按风险标记排序 | 抽检包可用；人工确认待定 |

### 3.3 关键设计

- **盲/可见两臂**：blind 为正式模式；aware 只做消融，测“看到能力后需求会不会被带偏”。
- **纯本体动作**：dims 为空、只有 `ontologyTags`。世界允许时记为 `narrative`——身体不掷骰，结果由世界规则接管；世界拒绝时记为 `blocked_ontology`。
- **不把 C 当结果**：V3-D 真正跑约束、瓶颈分、概率、掷骰，输出 `blocked_ontology / blocked_body / narrative / rolled` 四类状态。
- **固定 D**：自由动作没有动词基表，端到端用中性 D=50；另跑 35/50/65 证明难度只影响结果分布，不改变可行性/C。

### 3.4 通过线与结果

| 门槛 | 目标 | 实际 | 判定 |
|---|---|---|---|
| blind 合法率 | ≥ 98% | 100/100 | 通过 |
| aware 合法率 | ≥ 98% | 100/100 | 通过 |
| 非法/回退行 | 0 | 0 | 通过 |
| 语义漏项 | 0 | 0 | 通过 |
| 本体标签应中 | 100% | 6/6 | 通过 |
| 世界矩阵 | 全部通过 | 192/192 | 通过 |
| 世界单调性 | 全部通过 | 576/576 | 通过 |
| 未注册标签 | 默认世界拒绝 / 自定义可放行 | 拒绝/放行 | 通过 |
| 物理世界本体拒绝 | = 带标签动作 6 | 6（a93/a94/a97/a98/a99/a100） | 通过 |
| 秘法世界 narrative | = 纯本体动作 5 | 5（a93/a94/a97/a98/a99） | 通过 |
| 自由身体无身体拒绝 | 0 | 0 | 通过 |
| 身体约束单调性 | 全部通过 | 1200/1200 | 通过 |
| 端到端确定性 | 全部一致 | 100/100 | 通过 |
| 维度覆盖 | 任一 ≥ 1；硬需求 ≥ 10 | 任一 14/14；硬 12/14 | 通过 |
| 盲/可见漂移 | \|meanΔ\| ≤ 0.5 | -0.04（aware 更低 40/94） | 通过 |
| 重复编译 | 逐字段一致 | 一致 | 通过 |

**自动化门槛 16/16 通过；失败项 0。** 人工抽检 100 行已生成，尚待确认。

### 3.5 端到端结果

| 身体 | 物理世界 | 秘法世界 |
|---|---|---|
| 自由 | 本体拒绝 6；掷骰 94 | narrative 5；掷骰 95 |
| 反绑 + 铁链 | 本体拒绝 6；身体拒绝 39；掷骰 55 | narrative 5；身体拒绝 39；掷骰 56 |
| 蒙眼 | 本体拒绝 6；身体拒绝 3；掷骰 91 | narrative 5；身体拒绝 3；掷骰 92 |
| 缺左手 | 本体拒绝 6；掷骰 94 | narrative 5；掷骰 95 |
| 无意识 | 本体拒绝 6；身体拒绝 94；掷骰 0 | 身体拒绝 100；掷骰 0 |

自由身体 · 物理世界：C 平均 95.5，最低 48.0（a95 一拳打穿石墙），最高 100.0；D=50 时结果分布 `clean_success:90 / near_miss:3 / hard_fail:1`。

### 3.6 覆盖与稳定性

- 维度：14/14 至少出现在硬需求或辅助中；`cognition`、`endurance` 从未作为硬需求（设计上通常是辅助，测试集也缺“长时间坚持”类动作）。
- family：manual 44、locomotion 15、vocal 15、perception 13、impact 8、无物理族 5。
- 回放：`v3-validation.md/json`、`compiler-v3.md/json`、`v3-review.md/csv` 两次回放 **逐字节一致**。
- 难度敏感性：D=35/50/65 时平均 p 0.99/0.97/0.91；掷骰数始终 94，可行性不变。

### 3.7 本轮修正与发现

**schema 收紧**

- 拒绝 `verdict ≠ action`（撤回 reject 后的残留输出）；
- 拒绝 `dims` 与 `assist` 同维度重叠、重复/非法本体标签；
- 本体标签统一小写；`label/notes/intentTags` 加长度与重复校验；
- 24 类坏输入全部被拒。

**IntentVerifier 词表碰撞（9 条误报，已修）**

- `立刻` 命中 `刻`、`墙砖缝/门缝` 命中 `缝`、`走廊` 命中 `走`、`打穿` 命中 `穿`、`给盲眼妇听` 命中 `听`、`听清耳语` 命中 `耳语`、`口音` 命中 `voice/sight`；
- 修正后 100/100 通过。词表仍是启发式，不是语义证明；它只负责抓明显漏项。

**发现但未改**

- **缺左手没有改变可行性**：自由身体与缺左手在 100 条动作上都是 94 掷骰、0 身体拒绝；瓶颈分只降低 C。当前 14 维把手臂仍计入 grasp/precision，单手操作没有被判死。是否要更疼，是角色模型问题，不在 V3 编译器范围。
- **D=50 偏容易**：自由身体 90/94 clean success。说明固定中性难度不适合作为正式平衡；正式版由 DM/情境给 D。V3 只用它隔离编译器变量。

### 3.8 还没做

- **正式人工抽检**：`reports/v3-review.md` 100 行，需你逐行确认；agent 已复核 11 条风险标记，未发现明确错误，但这不是人工结论。
- **模型采样方差**：当前 cassette 是单次采样；回放一致不等于模型稳定。需要 20 条 × 多温度/多次采样另测。
- **对抗输入**：动作文本里的指令注入、超长文本、恶意 JSON 诱导，尚未做专门测试集。
- **DM 难度接入**：V3-D 用固定 D；正式链路应让 DM 给环境难度，再跑同一套 e2e。
- **`smell/touch` 约束**：维度已进 demand，但“鼻塞/手麻”还没有约束效果。

### 3.9 命令与产物

```bash
# 完整 V3（回放已录 cassette；不带 --replay 会真实调用）
pnpm demo:embodied v3 --replay
pnpm demo:embodied v3 --record

# 只跑编译阶段
pnpm demo:embodied compiler --replay
```

| 产物 | 内容 |
|---|---|
| `reports/v3-validation.md/.json` | 16 道门槛、端到端 1500 例、覆盖、稳定性 |
| `reports/compiler-v3.md/.json` | 100 条 × 两臂、本体标签、漂移、逐条 demand |
| `reports/v3-review.md/.csv` | 100 行人工抽检包（按风险排序） |
| `.cassette/compiler/` | 请求/响应录制；不含 key/headers |

---

## 4. V4：NPC 组件与 LOD（CM-1/5/6/7/8）— 世界 demo

**问题**：同一 Character 组件能否同时驱动 PC、T0–T3，并在预算内保持连续？

### 场景

渡口集 3 天，10 个具名 NPC + 2 个群体；PC 在 D1 入场，D2 离开 6 小时，D3 返回。

### 步骤

1. **契约**：PC 与 NPC 都实现 `CharacterRuntime`；同一组 contract test。
2. **分层**：按 importance 分配 T0/T1/T2/T3；记录每次晋升/降级。
3. **预算**：每 tick 最多 K 个 LLM 角色；统计 `focus/near/ambient/offstage` 调用数。
4. **强制升降级**：对同一 NPC 做 20 次降级→晋升，检查身份、关系、关键记忆。
5. **群体**：点名一个群体成员 → 个体化 → 合并 → 再观察；检查身份与群体统计。
6. **知识边界**：让背景 NPC 不知道未目击事件。
7. **回放**：同 seed + 日志，角色状态与事件一致。

### 通过线

| 指标 | 门槛 |
|---|---|
| LLM 调用/世界日 | 总 ≤30（角色 ≤22 + WorldDirector ≤8） |
| offstage 角色调用 | 0 |
| 身份连续率（20 次） | 100% |
| 群体个体化一致 | 100% |
| 未目击知识泄漏 | 0 |
| 回放一致 | 100% |

---

## 4.5 世界 demo B0–B2（已执行）

**问题**：规则能否养活一个无人干预的聚落，并让盗窃/传闻/执法/火灾链和“离开—返回”都可追溯？

### 已执行

1. **B0**：20 个 seed 的 `WorldBuilder` + `InvariantCheck`；同 seed 5 次事件日志字节级一致；JSONL + snapshot 写读。
2. **B1**：seed 7 跑 3 天 432 tick；10 NPC × 432 = 4320 NPC-tick；日程遵循 100%；无负资源/卡死。
3. **B2**：盗窃、火灾、传闻/执法/价格/痕迹；A→B→A 的 `DepartureSnapshot → ReturnDiff → Echo`；D4 三个 NPC 问话。
4. **三源**：668 事件；ambient 33 / actor 504 / special 3 / system 128；WorldDirector 5 个计划、ActionDM 1 个计划、canon 1 个计划。
5. **硬编码收敛**：盗窃由 `npc_thief` 的饥饿/机会规则触发（seed 7 在 tick 182），执法按守卫知识/冷却推进，商人反应由事实触发，PC 出发/返回由盗窃事实触发；起火点仍是概率场景种子。

### 结果

| 门 | 结果 |
|---|---|
| WB-1 20 seed 不变量 | 20/20 |
| WB-2 确定性回放 | 5/5 |
| WB-3 日程遵循 | 100%（adhered 3977 / transit 123 / excused 220 / violations 0） |
| WB-4 查询一致 | changed 全部带 eventIds；重复查询稳定 |
| WB-5 传播链 | 相关 NPC 知情率 88%；每跳有 source |
| WB-6 世界存活 | 539 个非脚本事件；计划全部终止 |
| WB-7 预算 | director 最多 3/日、character 0、total 5/30 |
| WB-8 数据安全 | JSONL + snapshot 读回一致 |
| WB-9 编年史 | 结构通过（高信号事件 52 条）；主观评审未做 |
| WB-10 LLM 占比 | B2 主仿真 0 次 LLM；NPC 动作 100% 规则 |
| A→B→A | stable 11 / changed 12 / added 4 / removed 2；Echo confirmed + distorted |
| 三源/provenance | 三类都有，含 director/action-dm/canon 计划 |

**结论**：B0–B2 的规则/事件/传播/返回机制可运行、可回放、可查询；硬编码时点已大幅收敛。B3 在同一世界上补齐 CharacterRuntime/T0–T3/群体/预算，并跑完整 3 天真实 LLM。

完整报告：[../reports/world-validation.md](../reports/world-validation.md)。

## 4.6 世界 demo B3（已执行，完整）

**问题**：同一 Character 组件能否驱动 PC、T0–T3 和群体，并在双预算内连续运行 3 天真实 LLM？

### 已执行

1. **CM-1 契约**：`ScriptedPcRuntime`、`NpcRuntime`、`CrowdRuntime` 实现同一 `perceive → decide → act → onEvent → snapshot`，13 项 contract 全过。
2. **T0–T3**：`importance = 0.30 plot + 0.25 relationship + 0.20 proximity + 0.15 recency + 0.10 attention`；0.7 晋升 / 0.4 降级 / 144 tick 冷却；3 天自然发生 1 次晋升、2 次降级。
3. **CM-6**：同一 NPC 20 次降级→晋升，身份 40/40、关系 40/40、关键记忆 20/20 保留。
4. **CM-7**：集市群体 24→23→24→23，个体化成员复用同一 id/身份/关系；完整 3 天里也真实执行 1 次个体化 + 1 次合并。
5. **CM-8**：94 条信念检查，0 条 `hops=0` 的未目击泄漏。
6. **完整 3 天真实 DeepSeek**：4 次 WorldDirector 调用 / 7 个合法提案；14 次同房间角色对话，14/14 `source=llm`，claims 全部合法，cassette 0 miss。
7. **预算**：峰值角色 5/22、Director 2/8、总 7/30、单 tick 2/3、offstage 0；另做满预算降级测试（22+8=30，模板回退，`BudgetDegraded` 写入）。
8. **回放**：同 seed + 同一 cassette 两次运行事件日志/投影 hash 一致（`46c85469`）。

### 结果

| 门 | 结果 |
|---|---|
| B3-CM1 | PC/NPC/群体同一契约；每套 13 项 |
| B3-TIERS | T0/T1/T2/T3 全在；changes=3；P1/D2 |
| B3-CM6 | 20 次循环：identity 40/40；relationships 40/40；keyMemories 20/20 |
| B3-CM7 | 24→23→24→23；sameIdentity=true |
| B3-CROWD-RUN | 完整 3 天个体化 1 / 合并 1 / 群体行动 36 |
| B3-CM8 | checked=94；leaks=0 |
| B3-DIR | 4 次调用；7 个合法提案；fallback=0 |
| B3-DIR-NO-ACTOR | actorIds 全空 |
| B3-DIALOGUE | 14 calls；14 llmSources；claims 全合法；Spoke=14；cassette miss=0 |
| B3-CM5 | char 5/22；director 2/8；total 7/30；maxTick 2/3；offstage 0 |
| B3-DEGRADE | 22+8=30；fallback 模板；degraded=1 |
| B3-REPLAY | events=760；hash 46c85469/46c85469；cassette 17；miss 0 |
| B3-WORLD | 世界不变量 true；sim true；plansTerminal true |

**结论**：B3 的 CM-1/5/6/7/8 全部有可执行检查，完整 3 天走真实 LLM 并可复现；NPC 动作仍 100% 规则，LLM 只提案/说话。

完整报告：[../reports/world-b3-validation.md](../reports/world-b3-validation.md)。

---

## 5. 执行命令与产物

```bash
# 100 个测试（含 v2/parity/compiler/v3）
pnpm test

# 世界 demo：67 个测试 + 12 门 B2 + 13 门 B3
pnpm test:world
node demos/world/src/cli.ts report
node demos/world/src/cli.ts b3 --replay --seed 7 --days 3

# 84 用例 parity（零 LLM）
pnpm demo:embodied parity --seed parity

# V3 编译阶段：100 条 × blind/aware
pnpm demo:embodied compiler --record
pnpm demo:embodied compiler --replay

# V3 完整验证：编译 + 语义 + 世界矩阵 + 1500 例端到端 + 抽检包
pnpm demo:embodied v3 --record
pnpm demo:embodied v3 --replay

# 逐拍 trace / 回放
pnpm demo:embodied scenario run --seed 42
pnpm demo:embodied replay --log reports/tablet-night-42.jsonl
```

| 产物 | 内容 |
|---|---|
| `reports/parity-parity.md` | 总览、分身体表、84 行明细、失败/预期差异 |
| `reports/parity-parity.json` | 机器可读明细 |
| `reports/compiler-v3.md` | V3 分臂、漂移、100 条 demand 明细 |
| `reports/compiler-v3.json` | 机器可读明细 |
| `reports/v3-validation.md/.json` | 16 道门槛、端到端 1500 例、覆盖、稳定性 |
| `reports/v3-review.md/.csv` | 100 行人工抽检包 |
| `reports/world-validation.md/.json` | 世界 B0–B2：12 门、20 seed、3 天、两链、返回差分 |
| `reports/world-events.jsonl` | seed 7 的完整 WorldEvent 日志 |
| `reports/tablet-night-*.log` | 逐拍 trace |

---

## 6. 判定规则

| 现象 | 判定 | 动作 |
|---|---|---|
| 可行性一致 < 100% | 硬失败 | 先修约束映射，不调需求 |
| 基线 C 平均差 > 2 | 校准失败 | 重算 profile 的 q，不改概率函数 |
| 基线 outcome 一致 < 100% | 校准失败 | 检查 C 与 D 的来源 |
| 总体 outcome 一致 < 80% | 需求模型需复核 | 看差异是否集中在辅助维度 |
| 预期差异集中在缺手/蒙眼 | **不是失败** | 记录为瓶颈分的设计后果，人工确认是否接受 |
| 编译器合法率 < 98% | 失败 | 收紧 schema/增加 few-shot，不放宽校验 |

**当前结论**：V1、V2、V3 完整验证通过（16/16 门槛，失败项 0）；v2 的约束层可以在不改变基线行为的前提下替换 v0 的硬规则，瓶颈分只在预期的身体状态上产生差异；自由动作能被编译成合法 demand，family 由需求推导而非 LLM 选择；可行性由世界规则决定，编译器不再输出 reject；同一 cassette 回放两次，六份报告逐字节一致。

---

## 7. 下一步

1. **人工抽检**：`reports/v3-review.md` 100 行，确认/标错；重点看 11 条风险标记。
2. **V3 稳定性补测**：20 条 × 多温度/多次采样，估计模型采样方差；另做动作文本的指令注入测试集。
3. **DM 难度接入 V3-D**：把固定 D=50 换成 DM 给的环境难度，检查同一 demand 在 DM 难度下的结果分布。
4. **`smell/touch` 约束**：鼻塞、手麻等 status → effect，补上“闻不到/摸不出”的硬约束。
5. **P3 CharacterRuntime**：把 `Character` 接口先接到 PC，再在世界 demo 接 T1–T3。
6. **V4**：在世界 demo 跑 3 天，验证 CM-5–8。
7. **回归**：每次改 demand/profile，都重跑 `pnpm demo:embodied parity --seed parity`，基线 C 差不得回退；改编译器提示词后重跑 `v3 --record`。
