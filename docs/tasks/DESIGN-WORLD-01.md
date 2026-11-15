# DESIGN-WORLD-01：World 实现计划与质量模型

| 项 | 内容 |
|---|---|
| 阶段 | 设计（独立设计会话执行） |
| 状态 | READY：待设计会话领取 |
| 依据 | 用户对 world demo 的批评：演化效果差、NPC 无自然语言风格、消息无意义、无信息损失；B2/B3 只是机制验证，不是世界质量证明 |
| 输出 | `docs/design/WORLD_PLAN.md`（实现计划）＋ `docs/design/WORLD_QUALITY.md`（质量模型与评估） |
| 下游 | 设计审计通过后，才创建实现任务卡 |

---

## 1. 背景

当前 `DEVELOPMENT_PLAN` 的 M0–M6 是架构迁移计划，world 只作为 demo 验证存在。B2/B3 的 12/13 门证明的是：

- 事件能写、能回放；
- 事实/信念能分开；
- 计划状态机能跑；
- 预算不超；
- 一条预设的盗窃/火灾/传闻链能完成。

它们不证明：

- NPC 说话像人；
- 消息传递有目的、有意义；
- 信息会真正丢失/变形；
- 世界演化自然、不是为过门而设计；
- 跨 seed 的剧情分布可接受。

因此需要一份独立的 World 实现计划与质量模型，而不是继续给 demo 加门。

---

## 2. 设计目标

回答：

1. **World 怎么从 demo 走到可连续运行的世界**：阶段、依赖、门、数据/内容管线。
2. **World 的质量怎么定义和验收**：不是“门过了”，而是 NPC 语言、消息意义、信息损失、因果连贯、跨 seed 分布、人工评审。
3. **World 与 World Card / Character / Channel 的契约**：谁提供什么，谁不能硬编码谁。

---

## 3. 非目标

- 不写代码、测试、schema 实现。
- 不重写 World Card 设计（见 DESIGN-WC-01）。
- 不重写 Channel 设计。
- 不提供内容审核服务。
- 不决定具体世界内容（地名、势力、剧情）。
- 不把 B2/B3 的门当成质量证据。

---

## 4. 必须回答的问题

### 4.1 世界结构与演化

- 区域/聚落/房间的尺度和数量；哪些是 canon，哪些是生成。
- 势力、经济、法律、生态、日历、灾害之间如何互相作用。
- 事件如何产生后果、如何留下痕迹、如何被再次观察。
- 无人干预时，世界靠什么继续演化；如何避免“为过门而写死链”。

### 4.2 人口与 LOD

- 多少具名 NPC、多少群体、多少背景人口；T0–T3 的分配。
- 每个层级保留什么、丢什么；晋升/降级如何不破坏身份。
- 跨聚落/跨区域的 LOD 与注意力预算。

### 4.3 NPC 语言与交流

- NPC 的语域、方言、称呼、禁忌、说话习惯从哪里来；
- 关系史、目标、情绪如何影响“说不说、怎么说”；
- 对话的目的是什么（警告/套话/撒谎/试探/拒绝/闲聊），不是只输出 claims；
- 如何评估“像这个人说的”，而不是“claims 合法”。

### 4.4 消息的语义与信息损失

当前实现只传 `factId + confidence + hops`，并硬编码少量变形。设计必须给出：

- speech act / 说话目的 / 听者解释模型；
- 哪些信息会丢失、扭曲、合并、误传；
- 听者如何验证/怀疑/传播；
- 沉默、拒绝、说谎、误解如何成为合法结果；
- 如何区分“世界事实变了”和“角色以为变了”。

### 4.5 质量模型

至少定义：

- 语言自然度 / 角色一致性；
- 消息意义保留率 / 信息损失率；
- 因果连贯性 / 可解释性；
- 事件多样性 / 跨 seed 分布；
- 人工评审协议（谁评、样本量、盲评、失败标准）。

B2/B3 应明确标注为 **mechanism evidence**，不是质量证据。

### 4.6 阶段与门

给出 World 的实现阶段（建议 W0–W6，可调整）：

- 世界命题/canon；
- 人口与声音；
- 通信语义；
- 事件生态；
- LOD/长跑；
- 质量评估；
- 内容扩展。

每阶段给：输入、产出、依赖、门、失败分支。

### 4.7 契约

- World ↔ World Card：卡提供什么限制/默认/模块；世界能否覆盖。
- World ↔ Character：世界提供 canon/事实/位置；角色提供意图/语言；不得互相硬编码。
- World ↔ Channel：世界不决定 Channel；Channel 的选择如何影响世界事件。
- World ↔ 内容管线：canon、生成、审核（如有）、版本。

---

## 5. 交付物

1. `docs/design/WORLD_PLAN.md`：
   - 世界结构、阶段、依赖、门、数据/内容管线；
   - 与 World Card/Character/Channel 的契约；
   - 失败分支与风险。
2. `docs/design/WORLD_QUALITY.md`：
   - 质量指标与口径；
   - 评估方法（自动 + 人工）；
   - 样本量与盲评协议；
   - 当前 B2/B3 能证明/不能证明什么；
   - 至少 3 个“必须失败”的负向案例。

设计文档必须带版本、日期、输入决策、未决问题、可验收标准。

---

## 6. 验收标准

- [ ] 明确 World 的实现阶段、依赖、门，不再把 demo 当产品计划；
- [ ] NPC 语言/交流有可执行的设计，不只是“让 LLM 说得更好”；
- [ ] 消息语义与信息损失有模型，不是硬编码几句变形；
- [ ] 质量指标可测量/可评审，包含跨 seed 与人工评审；
- [ ] B2/B3 被明确降级为机制证据；
- [ ] 与 World Card / Character / Channel 的契约清晰；
- [ ] 至少 3 个负向案例，证明“门过但质量差”会被拦住；
- [ ] 未决问题明确，不把猜测写成结论；
- [ ] 不含实现代码。

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

- Designer：`docs/design/WORLD_PLAN.md`、`docs/design/WORLD_QUALITY.md`
- Coordinator / Document Manager：`docs/tasks/`、`docs/README.md`
- Auditor：设计审计报告

禁止：代码、测试、schema 实现、`demos/`、`src/`、`scripts/`、`.github/`。

---

## 9. 停止条件

- 设计需要改代码/写实现；
- 设计把 B2/B3 继续当质量证明；
- 设计只给“更好”的口号，没有指标/门；
- 设计试图替 World Card/Channel 做决定；
- 设计需要改旧 PRD 才能成立（先登记新决策）。

---

## 10. 交接

```
stage: DESIGN-WORLD-01
design doc: docs/design/WORLD_PLAN.md
quality doc: docs/design/WORLD_QUALITY.md
inputs: 用户对 world demo 的批评；B2/B3 mechanism evidence
open questions: ...
auditor verdict: pending
```

Auditor 通过后，才创建 World 实现任务卡。
