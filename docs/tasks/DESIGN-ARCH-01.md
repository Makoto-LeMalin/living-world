# DESIGN-ARCH-01：整体架构设计

| 项 | 内容 |
|---|---|
| 阶段 | 设计（独立设计会话执行） |
| 状态 | READY：待设计会话领取；最终审计需等待 World / Character 设计产物 |
| 依据 | 用户指出“还没有做架构设计”；现有 `docs/ARCHITECTURE.md` 是 2026-11-15 的历史提案，未按 D-003–D-008 更新，未经独立审计 |
| 输入 | 现有架构草稿、PRD 草案、D-001–D-008、R0 审计、当前代码、DESIGN-WORLD-01 / DESIGN-CHAR-01 / DESIGN-WC-01 |
| 输出 | `docs/design/ARCHITECTURE.md`（新架构）＋`docs/design/ARCHITECTURE_CONTRACTS.md`（模块契约/依赖矩阵） |
| 下游 | 设计审计通过后，才作为实现与 M2/World 顺序决策的依据 |

---

## 1. 背景

项目有 `docs/ARCHITECTURE.md`，但它不是当前流程下的“架构设计”：

- 写于 2026-11-15，由同一 agent 在 M0/M1 之前完成，未经独立审计；
- 状态写的是“架构提案，待评审”；
- 早于 D-003（Channel 模块化）、D-004（世界卡独立模块）、D-005（内容框架不提供服务）、D-008（WC 延后）；
- 早于 R0 门禁修复与独立审计结论；
- 其中的 Channel 实体、观察面板、World Card 位置、存储/宿主假设都可能与新决定冲突。

因此它是**输入草稿**，不是已完成的架构设计。本任务要重新做架构裁决，不是润色旧文。

---

## 2. 设计目标

产出一份可作为实现依据的架构设计：

1. **边界**：系统边界、宿主/应用/领域/基础设施的职责与依赖方向。
2. **模块**：World、Character、Channel、World Card/Prompt、Storage、Host、Harness 等模块的职责与接口。
3. **真相与写路径**：EventLog/EventStore/Projection/Snapshot 的关系；回放、确定性、迁移。
4. **运行时**：tick/clock（stepped/realtime）、Scheduler、异步 LLM、预算、离线推进、失败回退。
5. **契约**：模块之间的数据/控制契约，尤其是 World ↔ Character ↔ Channel ↔ World Card。
6. **质量属性**：可回放、可测试、可替换宿主、成本可控、可演进。
7. **迁移**：从两个 demo + 当前代码到目标架构的阶段、风险、失败分支。
8. **顺序依赖**：M2、World、WC 的依赖矩阵，供用户决定顺序；不替用户决定。

---

## 3. 非目标

- 不写代码、测试、schema 实现、部署脚本。
- 不重写 World / Character / Channel / World Card 的具体设计；只定义架构边界与契约。
- 不提供内容审核服务。
- 不决定产品内容、剧情、角色名单。
- 不把旧 PRD/旧 ARCHITECTURE 当权威。
- 不替用户决定 M2/World/WC 的顺序。

---

## 4. 必须回答的问题

### 4.1 系统边界与分层

- 宿主、应用、领域、基础设施的边界是什么？
- 哪些是引擎，哪些是适配器；移除宿主后哪些必须仍可运行？
- 哪些模块是运行时，哪些是编辑期/生成期（World Card 生成器、canon 工具）？
- 依赖方向与禁止反向依赖的规则。

### 4.2 模块与职责

至少覆盖：

- Kernel/Clock/RNG/IDs/Canonical JSON/Snapshot；
- Space、World、EventStore、Projection、Plan/Resolver；
- Character/Runtime/Body/Mind/Persona/Memory；
- Channel / ChannelProfile / 观察；
- World Card / Prompt Composer / Content Envelope；
- LLM Gateway / Cassette / Budget；
- Storage（JSONL/SQLite）、Query/ReadModel；
- Host/DSH adapter；
- Harness/Verification。

每个模块给：职责、输入/输出、依赖、不做什么。

### 4.3 真相、写路径与回放

- EventLog 是否仍是唯一真相；EventStore 与 Projection 的边界；
- 快照/回放/迁移；同 seed 可复现的边界；
- 外部输入（用户消息、LLM 提案）如何进入事件，谁裁决；
- 事件 schema/版本/兼容策略；
- 32 位 hash 与字节级证据的边界（R0 已暴露）。

### 4.4 运行时与 LLM

- tick/clock：开发 stepped、应用 realtime、暂停/加速/离线；
- Scheduler 的单写者与幂等；
- 异步 LLM 注意力点、超时/回退、预算、降级；
- Mind/Intent/Compiler/DM/Resolver 的边界；
- Channel/用户消息的异步路径。

### 4.5 模块契约

- World ↔ Character：canon/事实/位置/事件 ↔ 意图/语言/行动；
- Character ↔ Channel：消息如何成为 Perception；角色解释/拒绝/怀疑；
- World Card ↔ World/Character/Prompt Composer：卡提供什么，谁覆盖谁；
- Storage ↔ 领域：接口、迁移、只读投影；
- Host ↔ 应用：消息入口、观察 API、调度、通知。

### 4.6 数据、配置与迁移

- 世界存档包含什么；配置随存档；
- World Card 版本、世界版本、角色版本如何关联；
- schema 迁移、旧存档、回放兼容；
- 多世界/单世界边界。

### 4.7 质量属性

- 可回放/可审计/可测试；
- 宿主可替换；
- 成本/延迟上限；
- 故障隔离（LLM/宿主/存储）；
- 可演进（模块替换、内容扩展）。

给出权衡与拒绝的方案，不只列优点。

### 4.8 与设计任务的关系

- World/Character/WC 设计输出如何进入架构；
- 哪些架构决策必须先于它们，哪些可以后置；
- M2/World/WC 依赖矩阵：谁需要谁的什么；
- 明确“先做哪个”依赖，不替用户拍板。

### 4.9 当前代码到目标架构的差距

- 两个 demo 与 `src/` 的现状；
- 哪些保留、哪些迁移、哪些废弃；
- 分阶段迁移与回滚；
- 每阶段 gate 与证据要求（含 R0 基线门）。

---

## 5. 交付物

1. `docs/design/ARCHITECTURE.md`：
   - 系统边界、分层、模块职责；
   - 核心数据流/写路径/回放；
   - 运行时/LLM/存储/宿主；
   - 质量属性与权衡；
   - 当前代码差距与迁移阶段；
   - M2/World/WC 依赖矩阵；
   - 未决问题与 ADR 列表。
2. `docs/design/ARCHITECTURE_CONTRACTS.md`：
   - 模块接口契约（可以是伪 TypeScript）；
   - 依赖矩阵；
   - 禁止依赖/循环依赖；
   - 事件/命令/查询边界。

设计文档必须带版本、日期、输入决策、未决问题、可验收标准。

---

## 6. 验收标准

- [ ] 不把旧 ARCHITECTURE/PRD 当权威；D-003–D-008 被显式处理；
- [ ] 系统边界、分层、依赖方向明确；
- [ ] 每个核心模块有职责/输入输出/不做什么；
- [ ] EventLog/EventStore/Projection/Snapshot/回放边界明确；
- [ ] 运行时/LLM/预算/失败回退明确；
- [ ] World/Character/Channel/World Card/Storage/Host 契约明确；
- [ ] 当前代码到目标架构的差距与迁移阶段可执行；
- [ ] 质量属性有取舍，不是口号；
- [ ] M2/World/WC 依赖矩阵可支撑顺序决策；
- [ ] 未决问题明确；不含实现代码；
- [ ] 独立 Auditor 通过。

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

- Designer：`docs/design/ARCHITECTURE.md`、`docs/design/ARCHITECTURE_CONTRACTS.md`
- Coordinator / Document Manager：`docs/tasks/`、`docs/README.md`
- Auditor：设计审计报告

禁止：代码、测试、schema 实现、`demos/`、`src/`、`scripts/`、`.github/`。

---

## 9. 停止条件

- 设计需要改代码/写实现；
- 设计只是对旧 ARCHITECTURE 的润色，没有重新裁决；
- 设计把旧 PRD 的 D6/R-CH4 当权威；
- 设计替 World/Character/Channel/WC 做具体设计；
- 设计无法给出 M2/World/WC 依赖矩阵，只能给偏好；
- 设计把内容审核服务引入架构。

---

## 10. 交接

```
stage: DESIGN-ARCH-01
architecture: docs/design/ARCHITECTURE.md
contracts: docs/design/ARCHITECTURE_CONTRACTS.md
inputs: D-001..D-008; R0 audit; current code; design tasks
open questions: ...
auditor verdict: pending
```

Auditor 通过后，才作为实现与顺序决策的依据。
