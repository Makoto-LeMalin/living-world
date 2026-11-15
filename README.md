# Living World

**一个在文字世界里持续生活的角色，通过世界内的通信与你保持联系；你可以旁观它的生活，但不能替它决定命运。**

当前只做两个可行性 demo：**具身 LLM** 与 **带 NPC 的世界**。产品需求见 [docs/PRD.md](docs/PRD.md)。

---

## 目录

```
living-world/
├── docs/                    需求与方案（单一真相源）
│   ├── PRD.md               产品需求 v0.2
│   ├── DESIGN.md            实现备忘（可改，不构成需求）
│   ├── ARCHITECTURE.md      整体架构：分层、契约、运行时、LLM、通信、存储、迁移
│   ├── DEVELOPMENT_PLAN.md  逐步开发方案：M0–M6、任务、门、估算、失败分支
│   ├── DEPENDENCIES.md      模块允许依赖矩阵
│   ├── RISKS.md             风险登记
│   ├── adr/                 ADR-1–9
│   ├── DEMO_PLAN.md         双 demo 总纲、里程碑、验收门
│   ├── CHARACTER_MODEL.md   角色/判定内核 v2 方向（维度、约束、ActionDemand、NPC 分层）
│   ├── VALIDATION.md        v0/v2 parity 与后续验证协议
│   └── README.md            文档地图与更新规则
├── demos/
│   ├── README.md            demo 约定
│   ├── embodied/            具身 demo（A0 已可跑）
│   │   ├── README.md        入口：怎么跑、做到哪
│   │   ├── DESIGN.md        身体建模 / 能力值 / DM / 判定
│   │   ├── src/             代码
│   │   ├── test/            测试
│   │   └── fixtures/        手写世界与身体
│   └── world/               带 NPC 的世界 demo（B0–B3 已可跑）
│       ├── README.md        入口：命令、验收门、做到哪
│       ├── DESIGN.md        事件日志 / 三源事件 / 传闻 / 返回 / CharacterRuntime
│       ├── src/             kernel / world / agents / rules / query / CLI
│       ├── test/            67 个单进程测试（含 B3）
│       └── fixtures/        ferry-market.json 手写 canon + 真实 LLM cassette
├── src/contracts/           P0 冻结的共享契约（仅类型）
├── engine/                  共享内核（RNG、规范化 JSON）
├── harness/                 检查器（claims / 元词 / 数值泄漏）
├── llm/                     DeepSeek 适配、cassette 录制回放
├── scripts/check-secrets.mjs 提交前密钥扫描
├── scripts/baseline.mjs     P0 基线固化（B2/B3/hash/cassette）
├── .env.example            环境变量模板（不含真实 key）
├── .gitignore
├── package.json
└── tsconfig.json
```

## 文档

阅读顺序：

1. [docs/PRD.md](docs/PRD.md) — 要什么，不做什么
2. [docs/DESIGN.md](docs/DESIGN.md) — 打算怎么做（实现备忘）
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 两个 demo 合并后的整体架构与迁移路线
4. [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) — 逐步开发方案：任务、依赖、门、估算
5. [docs/DEMO_PLAN.md](docs/DEMO_PLAN.md) — 两个 demo 的分工、里程碑、验收门
6. [docs/CHARACTER_MODEL.md](docs/CHARACTER_MODEL.md) — 枚举撑不住之后的通用角色/判定内核（v2 方向）
7. [docs/VALIDATION.md](docs/VALIDATION.md) — 验证协议与结果（V1/V2/V3；世界 B0–B3）
8. [demos/embodied/DESIGN.md](demos/embodied/DESIGN.md) — 具身 demo 的详细模型与指标

文档地图与更新规则：[docs/README.md](docs/README.md)。

冲突时：**PRD > DEMO_PLAN > ARCHITECTURE > demo DESIGN > demo README**。demo README 只做入口，不复制指标。

## 当前进度

| 模块 | 状态 |
|---|---|
| 文档与目录 | ✅ 已整理 |
| 具身 A0：部位/能力/硬约束/CLI | ✅ 可运行，测试通过 |
| 具身 A1：动作 DC、概率、结果分级、日志、回放、场景脚本 | ✅ 100 个测试；「泥板之夜」12 拍可回放 |
| 具身 A2：DM / Narrator / ClaimCheck | ✅ 12 拍接入；cassette 录/放通过 |
| 具身 A3：E1 对照实验 / 校准 | ⬜ |
| v2 parity：约束等价 + 需求校准 | ✅ 84 用例，可行性 100%，基线 C 差 0.07 |
| V3 Action Compiler：100 条 × 2 臂 | ✅ 100/100 合法、6 本体标签、6 跨世界差异、family 95/95 |
| V3 完整验证：语义/世界/端到端/覆盖/稳定性 | ✅ 16/16 门槛；1500 例 e2e；回放逐字节一致 |
| 世界 B0：事件日志 / builder / 不变量 / 回放 | ✅ 20 seed 全过；JSONL + snapshot |
| 世界 B1：日程 / 需求 / NPC 行为 / 三源事件 | ✅ 3 天；日程 100%；零 LLM |
| 世界 B2：盗窃 / 火灾 / 传闻 / 执法 / A→B→A | ✅ 12/12 门；668 事件；回响含 confirmed/distorted |
| 世界 B3：CharacterRuntime / T0–T3 / 群体 / 真实 3 天 LLM | ✅ 13/13 门；67 个世界测试；真实 DeepSeek 4 次 Director + 14 次角色对话；cassette 零 miss |
| 世界 B4：chronicle / metrics / WB 报告 | 🟡 报告与 chronicle 已生成；人工评审未做 |
| 工程化 P0：verify / 基线 / 契约 / 依赖 / ADR / 风险 | ✅ `pnpm verify`；基线 [reports/baseline.md](reports/baseline.md) |

## 运行

需要 Node ≥ 24（直接运行 TypeScript，无需构建）。

```bash
# 测试
node demos/embodied/test/run.ts
node demos/world/test/run.ts        # 世界 demo：67 个测试（含 B3）

# 看阿岬的身体与能力值
node demos/embodied/src/cli.ts body inspect

# 跑一次判定（默认 seed 42）
node demos/embodied/src/cli.ts check --verb take --dc 45

# 跑「泥板之夜」并回放（默认 --trace full：逐拍打印 body/caps/check/roll）
node demos/embodied/src/cli.ts scenario run --seed 42
node demos/embodied/src/cli.ts replay --log reports/tablet-night-42.jsonl

# LLM 版：录一遍，之后回放不花钱
pnpm demo:embodied scenario llm --seed 42 --record
pnpm demo:embodied scenario llm --seed 42 --replay

# V3 完整验证（编译 → 语义 → 世界 → 端到端 → 抽检包）
pnpm demo:embodied v3 --replay

# 真实 LLM：连通性 / 单次 DM / 单回合（DM → 判定 → 叙述）
node demos/embodied/src/cli.ts llm ping
node demos/embodied/src/cli.ts llm turn --verb speak --fact "老石刚看见血"
node demos/embodied/src/cli.ts dm --verb speak --fact "老石刚看见血"

# 世界 demo：构建 / 三天 / 问话 / 编年史 / 验证报告
node demos/world/src/cli.ts build --seed 7
node demos/world/src/cli.ts sim --seed 7 --days 3
node demos/world/src/cli.ts ask --npc guard --q "你们抓了谁？"
node demos/world/src/cli.ts talk --npc merchant --q "这里发生过什么？"
node demos/world/src/cli.ts director --seed 7
node demos/world/src/cli.ts talk --llm --record --npc merchant --q "这里发生过什么？"
node demos/world/src/cli.ts talk --replay --npc merchant --q "这里发生过什么？"
node demos/world/src/cli.ts b3 --replay --seed 7 --days 3   # 完整 3 天 + 真实 LLM cassette
node demos/world/src/cli.ts b3 --record --seed 7 --days 3   # 重新录制（会调用真实模型）
node demos/world/src/cli.ts chronicle --seed 7 --out reports/world-chronicle.md
node demos/world/src/cli.ts report
```

装了 pnpm 可以用脚本：

```bash
pnpm test
pnpm test:world
pnpm test:all
pnpm demo:embodied body inspect
pnpm demo:world sim --seed 7
```

测试和 CLI 是零依赖的（Node 直接跑 TS）。`pnpm install` 只用于 `pnpm typecheck`。
已验证：Node 24.18 + pnpm 12.21；`pnpm test`、`pnpm typecheck`、`pnpm demo:embodied ...` 均可用。

`scenario` 默认 `--trace full`：逐拍打印 body/caps/check/DM prompt/raw/Narrator raw，并写 `reports/<name>.log`；这些日志被 git 忽略，但随时可读。

## 环境变量

- 真实的 `.env` 只在本地存在，已被 [.gitignore](.gitignore) 忽略；模板是 [.env.example](.env.example)。
- `DEEPSEEK_API_KEY` 只从环境变量读取，禁止写进代码、文档、日志、cassette。
- `LW_SEED`：默认世界种子；可被 CLI `--seed` 覆盖。
- `LLM_CASSETTE`：`off` / `record` / `replay`；录制文件在 `.cassette/`，不含 headers/key。
- 追加变量前先写进 `.env.example`，保持模板完整。
- 提交前跑 `node scripts/check-secrets.mjs`；命中即阻断。

## 约定

- 每个 demo 自包含在 `demos/<name>/`：`README.md`（入口）、`DESIGN.md`（细节）、`src/`、`test/`、`fixtures/`。
- demo 之间不互相 import；共享代码放 `engine/`、`harness/`、`llm/`。
- 所有随机必须走 `engine/rng.ts`，禁止 `Math.random()`。
- 文档先改再写代码；需求变化改 PRD，实现变化改 DESIGN。
