# Living World

**一个在文字世界里持续生活的角色，通过世界内的通信与你保持联系；你可以旁观它的生活，但不能替它决定命运。**

当前仓库保留两个可行性 demo，以及一套已经清理过的工作区文档。

## 当前状态

| 项 | 状态 |
|---|---|
| 具身 demo | 可运行；机制验证，不等于产品完成 |
| 世界 demo | 可运行；B2/B3 是机制证据，不是世界质量证明 |
| 当前代码基线 | **demo 完成（7164dfa）**：代码、demos、reports 已回退；M1/真实时钟/R0 门禁脚本不在当前树 |
| R0 门禁修复 | 历史记录：曾 admitted；对应代码已回退，不可当作当前门禁 |
| 架构设计 | **待做**：[docs/tasks/DESIGN-ARCH-01.md](docs/tasks/DESIGN-ARCH-01.md) |
| World / Character / Channel / WC 设计 | 暂不建任务卡，等架构设计完成后再决定 |
| M2 | 冻结，等架构设计 |

## 文档

- [docs/PRD.md](docs/PRD.md)：产品需求草案
- [docs/DEMO_PLAN.md](docs/DEMO_PLAN.md)：双 demo 总纲与验收门（保留）
- [docs/PROCESS.md](docs/PROCESS.md)：角色互斥、阶段协议、证据规则
- [docs/DECISIONS.md](docs/DECISIONS.md)：用户决定 D-001–D-008
- [docs/tasks/DESIGN-ARCH-01.md](docs/tasks/DESIGN-ARCH-01.md)：当前唯一设计任务
- [docs/audits/](docs/audits/)：历史审计证据，不是设计输入
- [docs/verification/](docs/verification/)：历史验证记录，不是设计输入
- [docs/README.md](docs/README.md)：文档地图

旧架构、旧开发计划、旧模块依赖矩阵、旧任务卡已从工作区删除；git 历史仍可查，但不得作为新架构设计的输入。`docs/DEMO_PLAN.md` 是 demo 验收资料，保留。

## 目录

```
demos/embodied/   具身 demo
demos/world/      世界 demo
src/              共享代码（contracts/kernel/space/world）
engine/           最小原语
harness/          claims/replay/invariant
llm/              DeepSeek 适配与 cassette
scripts/          验证与门禁脚本
reports/          基线/验证产物
docs/             需求、流程、决定、当前设计任务
```

## 运行

需要 Node ≥ 24。

```bash
# 测试
node demos/embodied/test/run.ts
node demos/world/test/run.ts
node test/run.ts

# 完整门禁
pnpm verify

# 具身 demo
node demos/embodied/src/cli.ts body inspect
node demos/embodied/src/cli.ts scenario run --seed 42

# 世界 demo
node demos/world/src/cli.ts sim --seed 7 --days 3
node demos/world/src/cli.ts b3 --replay --seed 7 --days 3
pnpm report:world
```

## 约定

- 先读 [AGENTS.md](AGENTS.md) 与 [docs/PROCESS.md](docs/PROCESS.md)。
- 设计、开发、测试、审计角色互斥；同一阶段不得一人多角。
- 所有随机走 `src/kernel/rng.ts`；`.env` 不进 git。
