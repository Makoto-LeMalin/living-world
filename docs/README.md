# 文档地图

本目录只放**跨 demo 的文档**。单个 demo 的细节放 `demos/<name>/DESIGN.md`。

| 文件 | 角色 | 冲突时 |
|---|---|---|
| [PRD.md](PRD.md) | 产品需求：可观察的行为、边界、验收 | 最高 |
| [DESIGN.md](DESIGN.md) | 实现备忘：分层、契约、未验证假设 | 低于 PRD |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 整体架构：分层、核心契约、运行时、LLM、通信、存储、迁移 | 低于 PRD，高于 demo 细节 |
| [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) | 执行级逐步开发方案：M0–M6、任务、依赖、门、估算、失败分支 | 低于 ARCHITECTURE |
| [M1.md](M1.md) | M1 抽共享内核：模块边界、EventStore/Projection、兼容性证据 | 执行记录 |
| [DEPENDENCIES.md](DEPENDENCIES.md) | 模块允许依赖矩阵与禁止反向依赖规则 | 低于 ARCHITECTURE |
| [RISKS.md](RISKS.md) | 风险登记：触发信号、影响、缓解、审查点 | 执行跟踪 |
| [adr/](adr/README.md) | ADR-1–10：事件真相、同步 tick、真实时间比例、Compiler 边界、DM 盲测等 | 已接受决策 |
| [DEMO_PLAN.md](DEMO_PLAN.md) | 双 demo 总纲：风险分工、里程碑、验收门 | 低于 PRD |
| [CHARACTER_MODEL.md](CHARACTER_MODEL.md) | 角色与判定内核 v2 方向：维度、约束、ActionDemand、NPC 分层 | 实现方向 |
| [VALIDATION.md](VALIDATION.md) | 验证协议与结果：V1 约束等价、V2 需求校准、V3 编译器完整验证、世界 B0–B3 | 执行记录 |
| [../demos/embodied/DESIGN.md](../demos/embodied/DESIGN.md) | 具身 demo 的细节：身体、能力值、DM、指标 | 低于 DEMO_PLAN |
| [../demos/embodied/README.md](../demos/embodied/README.md) | 具身 demo 入口：怎么跑、做到哪 | 只做入口 |
| [../demos/world/DESIGN.md](../demos/world/DESIGN.md) | 世界 demo 的细节：事件日志、三源、传闻、返回 | 低于 DEMO_PLAN |
| [../demos/world/README.md](../demos/world/README.md) | 世界 demo 入口：命令、验收结果、B4 待办 | 只做入口 |

## 更新规则

1. **需求变更**：先改 `PRD.md`，再改 `DEMO_PLAN.md` 的验收门；不要只在 demo 文档里改。
2. **实现变更**：改 `docs/DESIGN.md` 或对应的 `demos/*/DESIGN.md`，并在变更处写明"为什么"。
3. **结论/数据**：只写进 demo 的 `README.md` 或 `reports/`，不复制进 PRD。
4. **版本**：文件名不带版本；文首表格写 `v0.x` 与日期。PRD 与 DEMO_PLAN 各自维护版本。
5. **未验证假设**：保留在 `docs/DESIGN.md` §9 与 `DEMO_PLAN.md` §1，标 `○` 的不当结论用。

## 命名

- `docs/`：跨 demo 的、相对稳定的文档。
- `demos/<name>/DESIGN.md`：该 demo 的实现细节与指标，允许频繁改。
- `demos/<name>/README.md`：入口，不超过一屏半；只链接，不复制表格。
- `reports/`（后续）：每次实验的产物，按 `<demo>-<seed>-<date>.md` 命名。
