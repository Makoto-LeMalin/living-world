# 文档地图

工作区已清理旧的设计文档、计划文档、模块依赖矩阵和任务卡。当前只保留：

| 文档 | 作用 |
|---|---|
| [PRD.md](PRD.md) | 产品需求（草案，非实现权威） |
| [DEMO_PLAN.md](DEMO_PLAN.md) | 双 demo 总纲与验收门（**保留**；属于 demo 资料，不是非 demo 计划） |
| [PROCESS.md](PROCESS.md) | 角色互斥、阶段协议、证据规则 |
| [DECISIONS.md](DECISIONS.md) | 用户决定（D-001–D-008） |
| [tasks/DESIGN-ARCH-01.md](tasks/DESIGN-ARCH-01.md) | **当前唯一设计任务：整体架构设计** |
| [audits/M0-M1-AUDIT.md](audits/M0-M1-AUDIT.md) | 历史审计证据（不是设计输入） |
| [audits/R0-AUDIT.md](audits/R0-AUDIT.md) | 历史审计证据（不是设计输入） |
| [verification/R0.md](verification/R0.md) | 历史验证记录（不是设计输入） |
| [../demos/embodied/README.md](../demos/embodied/README.md) | 具身 demo 入口 |
| [../demos/embodied/DESIGN.md](../demos/embodied/DESIGN.md) | 具身 demo 细节 |
| [../demos/world/README.md](../demos/world/README.md) | 世界 demo 入口 |
| [../demos/world/DESIGN.md](../demos/world/DESIGN.md) | 世界 demo 细节 |

## 说明

- 旧架构、旧开发计划、旧任务卡已删除；git 历史仍可追溯，但**不得作为 architecture 设计的输入**。
- `DEMO_PLAN.md` 是 demo 验收资料，已保留；它仍指向已删除的旧 `ARCHITECTURE.md` 的位置仅作历史引用，不是当前架构输入。
- `audits/` 与 `verification/` 只作为历史证据；它们包含旧路径引用，不代表当前设计结构。
- 当前只允许 Architecture 设计任务；World / Character / Channel / World Card 的任务卡在架构设计完成后再创建，避免预先划分模块。

## 更新规则

1. 需求变化改 `PRD.md`；
2. 用户决定登记到 `DECISIONS.md`；
3. 阶段任务写入 `docs/tasks/<stage>.md`，必须有角色矩阵；
4. 设计产物写入 `docs/design/`；
5. 审计/验证记录只追加，不改写历史。
