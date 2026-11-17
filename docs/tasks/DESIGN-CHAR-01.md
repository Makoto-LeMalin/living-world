# DESIGN-CHAR-01：Character / M2 统一运行时设计

| 项 | 内容 |
|---|---|
| 阶段 | 设计（独立设计会话执行） |
| 状态 | READY：待设计会话领取 |
| 依据 | 用户对角色 demo 的批评：角色也不能只靠 demo 证明；M2 与 World 的顺序需要两份设计都完成后再定 |
| 输入 | [CHARACTER_MODEL.md](../CHARACTER_MODEL.md)（v2 草案，非权威）；具身 demo 100 测试；世界 B3 的 CM-1/6/7（机制证据，非质量证明）；[DESIGN-WC-01](DESIGN-WC-01.md)、[DESIGN-WORLD-01](DESIGN-WORLD-01.md) |
| 输出 | `docs/design/CHARACTER_PLAN.md`（模型/运行时/契约/M2 计划）＋ `docs/design/CHARACTER_QUALITY.md`（质量模型与评估） |
| 下游 | 设计审计通过后，才创建 M2 实现任务卡 |

---

## 1. 背景

当前角色能力分散在两个 demo：

- 具身 demo：身体、约束、能力、判定、叙述；但场景动作是脚本，没有产品级 Mind；
- 世界 demo：`CharacterRuntime` 契约、T0–T3、群体、预算；但 PC 是 `ScriptedPcRuntime`，NPC 动作 100% 规则，语言只有模板/少量 LLM 对话。

B3 的 CM-1/6/7 证明的是：

- 三类角色能共用一组接口；
- 降级/晋升能保留身份/关系/关键记忆；
- 群体个体化/合并能复用身份。

它们不证明：

- 角色说话像这个人；
- 角色有稳定语域/关系史/目标；
- 角色能自然拒绝、沉默、撒谎、误解；
- companion 的内心/言语/行动能接成产品链路；
- M2 的运行时能同时服务具身身体与世界 NPC。

M2 的目标是“统一运行时”，不是“把 demo 拼起来”。本设计必须先定义统一什么、保留什么差异、怎么验收。

---

## 2. 设计目标

1. **Character 模型**：companion / NPC / crowd 共用什么，差异用什么策略表达。
2. **CharacterRuntime**：同步 `decide` + 异步 `Mind.propose` 的边界；感知/意图/行动/事件回调/快照。
3. **BodyProvider**：full/summary/aggregate 三种视图；LOD 升降时不丢身份/关系/关键记忆。
4. **语言与声音**：NPC/companion 的语域、关系史、目标、说话目的；不是只保证 claims 合法。
5. **契约**：Character ↔ World、Character ↔ World Card、Character ↔ Channel、Character ↔ Mind/LLM。
6. **M2 计划**：阶段、依赖、门、迁移路径；与 World 的依赖关系，供后续决定 M2/World 顺序。
7. **质量模型**：身份连续性、语言自然度、角色一致性、知识边界、约束遵守；可测量/可评审。

---

## 3. 非目标

- 不写代码、测试、schema 实现。
- 不重写 World / World Card / Channel 设计。
- 不实现完整 M4 记忆/人格系统；只定义 M2 需要的接口边界与依赖。
- 不提供内容审核服务。
- 不决定具体角色内容（名字、背景、剧情）。
- 不把 B3 的机制门当成质量证明。

---

## 4. 必须回答的问题

### 4.1 Character 模型

- `identity / persona / body / social / mind / presence / schedule / relationships / memory` 各自由谁维护？
- 三个身体（物理/现象/社会）在数据上如何分开；哪些是 companion 独有，哪些 NPC 也有？
- companion、T0–T3、crowd 的差异用“数据 + 策略”还是“子类”？给判定规则。
- 角色卡的输入是什么？与世界卡、世界 canon 的边界在哪里？

### 4.2 CharacterRuntime

- `perceive / decide / act / onEvent / snapshot` 的精确契约；
- 为什么 `decide` 必须同步；`Mind.propose` 异步的边界在哪；
- 同步决策如何拿到异步意图；LLM 超时/失败如何回退；
- companion 的“内心/言语/行动”三分如何表达；NPC 是否也有内心；
- 群体 Runtime 如何做一次判定作用于分布，个体化时如何升级。

### 4.3 BodyProvider 与 LOD

- full/summary/aggregate 各保留什么字段；
- 降级时丢什么、保留什么；晋升时如何恢复；
- 身份哈希/关系/关键记忆/位置/日程如何跨层级保持；
- 焦点角色是否强制 full；summary 是否允许掷骰；
- 身体视图与判定的关系：C 从哪来，DM 永远看不到什么。

### 4.4 语言、声音与能动性

- 语域、方言、称呼、禁忌、口头禅、沉默习惯从哪里来；
- 关系史、目标、情绪、身份如何影响“说不说、怎么说”；
- speech act：警告/套话/撒谎/试探/拒绝/闲聊/求助，如何建模；
- 内心想法与说出的话如何分离；NPC 是否有“未说出口”的部分；
- 角色如何自然拒绝、沉默、说谎、误解，而不是“立刻照做”；
- 如何评估“像这个人说的”，而不是“claims 合法”。

### 4.5 契约

- Character ↔ World：世界提供 canon/事实/位置/事件；角色提供意图/语言/行动；不得互相硬编码。
- Character ↔ World Card：卡提供语气/角色钩子/限制；角色保留身份/persona；覆盖规则。
- Character ↔ Channel：用户消息如何进入 Perception；角色的解释/怀疑/拒绝如何表达；Channel 不决定角色人格。
- Character ↔ Mind/LLM：LLM 只提案，不写状态；输入白名单；claims/元词/数值校验。
- Character ↔ Memory/Persona（M4）：M2 需要哪些最小接口，哪些留到 M4。

### 4.6 M2 计划与 M2/World 顺序

- 把 M2 拆成可验收阶段（可沿用 P2.1–P2.7，也可调整），给依赖、门、失败分支；
- 哪些能力必须先有 World 设计输入（canon/事件/LOD），哪些可以独立做；
- 哪些能力是 World 实现的前置（统一 runtime、BodyProvider、voice hooks）；
- 明确回答：如果先做 M2，World 会缺什么；如果先做 World，M2 会缺什么；
- 不替用户决定顺序，只给依赖/风险/成本对比。

### 4.7 质量模型

至少定义：

- 身份连续性（跨降级/晋升/会话）；
- 语言自然度 / 角色一致性 / 语域稳定；
- 知识边界（不知道就是不知道）；
- 约束遵守（身体做不到就是做不到）；
- 能动性（拒绝/沉默/说谎/误解的合理性）；
- 人工评审协议（样本、盲评、失败标准）；
- 至少 3 个“接口过但角色不像人”的负向案例。

---

## 5. 交付物

1. `docs/design/CHARACTER_PLAN.md`：
   - 模型、Runtime、BodyProvider/LOD、语言/声音、契约、M2 阶段/门；
   - M2 ↔ World 依赖矩阵；
   - 迁移路径（从两个 demo 到统一运行时）；
   - 失败分支与未决问题。
2. `docs/design/CHARACTER_QUALITY.md`：
   - 质量指标与口径；
   - 自动检查 + 人工评审；
   - 样本量与盲评协议；
   - 当前具身/世界 demo 能证明/不能证明什么；
   - 至少 3 个负向案例。

设计文档必须带版本、日期、输入决策、未决问题、可验收标准。

---

## 6. 验收标准

- [ ] companion / NPC / crowd 的共用量与差异有明确规则，不是“都实现同一个接口”；
- [ ] `CharacterRuntime` 的同步/异步边界、失败回退、快照/恢复明确；
- [ ] BodyProvider 的 full/summary/aggregate 与 LOD 升降有可执行规则；
- [ ] 语言/声音/能动性有设计，不只是 prompt 口号；
- [ ] 与 World / World Card / Channel / Mind / Memory 的契约清晰；
- [ ] M2 阶段/门/迁移路径可执行；
- [ ] 给出 M2 ↔ World 依赖矩阵，能支撑顺序决策；
- [ ] 质量模型可测量/可评审，含负向案例；
- [ ] B3 CM-1/6/7 被明确标注为机制证据；
- [ ] 不含实现代码；未决问题明确。

---

## 7. 角色矩阵

| 角色 | Agent / 会话 | 状态 |
|---|---|---|
| Coordinator | `coordinator` | assigned |
| Document Manager | `document-manager` | assigned |
| Designer | 独立设计会话（只做设计） | pending |
| Auditor | 设计完成后独立审计 | pending |
| Implementer / Verifier | 本任务不参与 | N/A |

---

## 8. 写入范围

- Designer：`docs/design/CHARACTER_PLAN.md`、`docs/design/CHARACTER_QUALITY.md`
- Coordinator / Document Manager：`docs/tasks/`、`docs/README.md`
- Auditor：设计审计报告

禁止：代码、测试、schema 实现、`demos/`、`src/`、`scripts/`、`.github/`。

---

## 9. 停止条件

- 设计需要改代码/写实现；
- 设计把 B3 CM-1/6/7 当质量证明；
- 设计只给“让 LLM 更好”的口号，没有指标/门；
- 设计试图替 World/World Card/Channel 做决定；
- 设计需要改旧 PRD 才能成立（先登记新决策）；
- 设计无法给出 M2 ↔ World 依赖矩阵，只能给偏好。

---

## 10. 交接

```
stage: DESIGN-CHAR-01
plan: docs/design/CHARACTER_PLAN.md
quality: docs/design/CHARACTER_QUALITY.md
inputs: M2 目标；具身/世界 demo 机制证据；DESIGN-WC-01 / DESIGN-WORLD-01
open questions: ...
auditor verdict: pending
```

Auditor 通过后，才创建 M2 实现任务卡；M2 与 World 的顺序由用户在读完三份设计后决定。
