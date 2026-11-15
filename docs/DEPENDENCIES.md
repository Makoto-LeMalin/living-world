# 依赖规则（P0 冻结）

| 项 | 内容 |
|---|---|
| 版本 | v1.0（2026-11-15） |
| 状态 | P0 冻结；M1 抽取时按此执行 |
| 上游 | [ARCHITECTURE.md](ARCHITECTURE.md) §3、§15 |
| 目的 | 防止“共享代码反向依赖 demo”“宿主类型污染领域层”“角色层复制世界状态” |

---

## 1. 当前目录

```
demos/embodied/    具身 demo（body/check/dm/narrator/v2/v3）
demos/world/       世界 demo（kernel/world/agents/rules/query/sim）
engine/            共享内核（RNG、规范化 JSON）
harness/           共享检查器（claims/meta）
llm/               DeepSeek 适配、cassette、类型
src/contracts/     P0 冻结的共享契约（仅类型）
src/kernel/        M1 起的共享内核（clock/rng/ids/canonical-json/snapshot）
src/               目标共享模块（M1 起逐步填充）
```

## 2. 允许依赖矩阵

`✓` 允许；`—` 不依赖；`✗` 禁止。

| 从 ↓ / 到 → | engine | harness | llm | src/contracts | src/kernel | src/space | src/world | src/characters | src/rules | src/app | src/host | demos |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `engine` | — | — | — | ✗ | — | — | — | — | — | — | — | ✗ |
| `harness` | ✓ | — | — | ✓ | — | — | — | — | — | — | — | ✗ |
| `llm` | ✓ | — | — | ✓ | — | — | — | — | — | — | — | ✗ |
| `src/contracts` | ✗ | ✗ | ✗ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `src/kernel` | ✓ | — | — | ✓ | — | — | — | — | — | — | — | ✗ |
| `src/space` | ✓ | — | — | ✓ | ✓ | — | — | — | — | — | — | ✗ |
| `src/world` | ✓ | — | — | ✓ | ✓ | ✓ | — | — | — | — | — | ✗ |
| `src/characters` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | — | ✓ | — | — | ✗ |
| `src/rules` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | ✗ |
| `src/app` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ✗ |
| `src/host` | — | — | — | ✓ | — | — | — | — | — | ✓ | — | ✗ |
| `demos/*` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | 同 demo 内部 |

### 说明

- **`src/contracts` 只能依赖自身**：它是所有层的共同语言，不能 import 任何实现。
- **`src/host` 只能依赖 `src/app` + contracts**：DSH/HTTP/CLI 是适配器，不能把宿主类型带进领域层。
- **`src/app` 可以依赖领域层**，但领域层不能反向依赖 app。
- **`demos/*` 可以依赖 `src/*`**（M1 之后），但 `src/*` 绝不 import `demos/*`。
- **`engine` 不依赖 `harness/llm/src`**：内核保持最小。
- **`llm` 不依赖领域层**：它只是 ChatClient/cassette；各角色 prompt 在 `src/llm/roles`（M4 后）。

## 3. 当前已知例外

M1 前允许保留，抽取后消除：

| 位置 | 现状 | 处理 |
|---|---|---|
| `demos/world/src/world/llm-director.ts` → `rules/plans.ts` | 同一 demo 内 | M1 后改 import contracts/validator |
| `demos/world/src/sim.ts` → `agents/*` + `rules/*` | demo 编排 | M3 后拆到 `src/app` |
| `demos/embodied/src/v3/*` → `v2/*` | demo 内部演进 | M2/M3 后拆到 `src/rules` + `src/characters` |
| `demos/*/src/cli.ts` → demo 内部 | 入口 | 保留；不属于共享层 |

## 4. 检查方式

M1 起加一个轻量脚本（或 CI step）：

1. 扫描 `src/**/*.ts` 的 import；
2. 命中 `demos/` → fail；
3. `src/contracts` 命中任何非 contracts → fail；
4. `src/host` 命中 DSH/Web 类型 → 人工评审；
5. `engine` 命中 `llm/harness/src` → fail。

P0 不实现扫描器；先冻结矩阵，M1 第一个 PR 加检查。

## 5. 为什么不做“大一统”

两个 demo 是**独立失败**的验证装置。共享层只抽已经证明的部分；让 `src` 反向依赖 demo 会把 demo 的场景假设带进产品内核。

规则：**先有契约，再有共享实现，最后才有 demo 迁移。**
