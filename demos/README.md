# Demos

每个 demo 一个自包含文件夹。共享代码放根目录的 `engine/`、`harness/`、`llm/`；**demo 之间不互相 import**。

| demo | 目标 | 状态 | 入口 |
|---|---|---|---|
| [embodied](embodied/) | 身体能限制 LLM；想法不会漏；裁决不被叙述覆盖 | A0–A2/V3 可跑 | [README](embodied/README.md) |
| [world](world/) | 规则养活 NPC 世界；无人时继续演化；成本可控 | B0–B2 可跑；B3 未做 | [README](world/README.md) |

## 每个 demo 的结构

```
demos/<name>/
├── README.md     入口：目标、怎么跑、当前状态
├── DESIGN.md     细节：模型、契约、指标、失败分支
├── src/          代码
├── test/         测试（node:test）
└── fixtures/     手写输入（世界、身体、脚本）
```

## 运行约定

- Node ≥ 24，直接跑 `.ts`，不引入构建步骤。
- 随机只用 `engine/rng.ts`。
- 任一 demo 的阻断门不达标，不进入合并（见 [../docs/DEMO_PLAN.md](../docs/DEMO_PLAN.md)）。
