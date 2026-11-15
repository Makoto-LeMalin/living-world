# 具身 Demo

**目标**：一个 LLM 角色，在"身体做不到"和"想法不可见"都是硬约束时，还能不能像个活人。

场景：「泥板之夜」——阿岬，双手反绑、左臂刀伤、低烧，被铁链拴在牢房里。狱卒老石在门外，隔壁盲眼妇只可听。

细节方案（身体模型、能力值、DM、指标）见 [DESIGN.md](DESIGN.md)。

## 当前状态

| 层 | 状态 |
|---|---|
| 部位 / 全局状态 / 派生能力 | ✅ |
| 硬约束（束缚、缺失、失明、无意识、铁链） | ✅ |
| 12 动词能力权重 + 最低值 | ✅ |
| 基础 DC / 概率 / 结果分级 / 种子 | ✅ |
| CLI `body inspect`、`check` | ✅ |
| check JSONL 日志 / 回放 / 「泥板之夜」场景脚本 | ✅ |
| 逐拍 trace（body/caps/check/DM/Narrator） | ✅ 终端 + `reports/*.log` |
| DM 契约 / 校验 / 缓存 / 回退 | ✅ 单次真实调用已通 |
| Narrator / ClaimCheck | ✅ 单次真实调用已通 |
| 单回合 LLM：DM → 判定 → 叙述 | ✅ `llm turn` 已通 |
| DM/Narrator 接入 12 拍场景 | ✅ `scenario llm`，cassette 录/放通过 |
| 三臂实验 / E1 / 概率校准 | ⬜ |
| v0/v2 parity（7 身体 × 12 动作） | ✅ 可行性 100%；基线 C 差 0.07 |
| V3 Action Compiler（100 条 × 2 臂） | ✅ 100/100 合法、6 本体标签、6 跨世界差异、family 95/95、漂移 -0.04 |
| V3 完整验证（语义/世界/端到端/覆盖/稳定性） | ✅ 16/16 门槛；1500 例 e2e；回放逐字节一致；抽检包待人工 |

## 运行

```bash
# 身体与能力值
node demos/embodied/src/cli.ts body inspect

# 一次判定：默认自动掷骰（seed 42）
node demos/embodied/src/cli.ts check --verb take --dc 45

# 指定 seed / 输出 JSON
node demos/embodied/src/cli.ts check --verb speak --dc 67 --seed 7 --json

# 跑「泥板之夜」，写日志并回放
node demos/embodied/src/cli.ts scenario run --seed 42
node demos/embodied/src/cli.ts replay --log reports/tablet-night-42.jsonl

# 真实 LLM
node demos/embodied/src/cli.ts llm ping
node demos/embodied/src/cli.ts llm turn --verb speak --fact "老石刚看见血"
node demos/embodied/src/cli.ts dm --verb speak --fact "老石刚看见血"
node demos/embodied/src/cli.ts narrate --verb take --fact "东西到了你手里。"

# LLM 版场景：录一遍，之后回放不花钱
pnpm demo:embodied scenario llm --seed 42 --record
pnpm demo:embodied scenario llm --seed 42 --replay

# v0 vs v2 parity（零 LLM，84 用例）
pnpm demo:embodied parity --seed parity

# V3 编译器（100 条 × blind/aware；可 record/replay）
pnpm demo:embodied compiler --replay

# V3 完整验证：编译 + 语义 + 世界矩阵 + 1500 例端到端 + 抽检包
pnpm demo:embodied v3 --replay
```

或用脚本：`pnpm demo:embodied body inspect`。

## 后台 trace

`scenario` 默认 `--trace full`：每一步都打印到终端，并落到 `reports/<name>.log`。

| tag | 内容 |
|---|---|
| `[body]` / `[caps]` | 部位快照、八项能力值 |
| `[check.hard]` / `[check.blocked]` | 硬约束通过或被哪条规则拦住 |
| `[check.capability]` / `[check.difficulty]` | C、最低值、base/final DC |
| `[check.roll]` | p、u、结果分级 |
| `[dm.request]` / `[dm.prompt]` | DM 看到的完整输入 |
| `[dm.raw]` / `[dm.valid]` / `[dm.fallback]` | DM 原始返回、校验后结果、回退原因 |
| `[narrator.request]` / `[narrator.raw]` | Narrator 输入与原始返回 |
| `[narrator.valid]` / `[narrator.text]` | claims 校验与最终叙述 |
| `[result]` / `[facts]` / `[log]` | 最终判定、事实、日志落盘 |

`--trace summary` 只打一行式中间量（不含 body/prompt/raw）；`--trace off` 只打 transcript。
`reports/*.jsonl` 与 `*.log` 都在 `.gitignore` 里，但随时可读。

## 目录

```
demos/embodied/
├── README.md
├── DESIGN.md
├── fixtures/akha.json      手写身体
├── src/
│   ├── body.ts             部位、性能、能力值、内感受、伤口
│   ├── actions.ts          12 动词配置、硬规则、基础 DC
│   ├── check.ts            可行性 → 能力 → 概率 → 结果
│   ├── dm.ts               DM 契约、校验、缓存、回退
│   ├── narrator.ts         Narrator 契约 + ClaimCheck
│   ├── log.ts              check JSONL 日志 + 回放
│   ├── scenario.ts         「泥板之夜」12 拍（写死）
│   ├── scenario-llm.ts     LLM 版：DM + Narrator + cassette
│   ├── parity.ts           v0 vs v2 对照报告
│   ├── compiler.ts         V3：自由动作 → dims/assist/ontologyTags
│   ├── compiler-run.ts     V3：100 条 × 两臂报告
│   ├── v2/                 14 维度 / 约束 / ActionDemand / 瓶颈分
│   ├── v3/                 世界规则 / IntentVerifier / 端到端 / 完整验证
│   ├── fixture.ts          fixture 读取
│   └── cli.ts              调试入口
└── test/                   100 个测试（能力、约束、概率、日志、场景、DM、Narrator、cassette、DeepSeek、trace、v2、parity、compiler、v3）
```

共享代码：`engine/`（RNG、规范化 JSON）、`harness/claim.ts`（claims/元词/数值检查）、`llm/`（DeepSeek、cassette）。

## 已验证的算例

阿岬（绑手 + 刀伤 + 低烧）：

| 能力 | 值 |
|---|---|
| 力量 | 51 |
| 敏捷 | 17 |
| 移动 | 63 |
| 言语 | 61 |
| 认知 | 65 |

- `take`（拿炭笔）：**不可尝试**，理由"双手被反绑，手指够不到"。
- `listen`（隔石墙，`--dc 75`）：C=100，p≈0.89。
- `speak`（说服老石）：C=61.6，D=67，p≈0.39。

测试：`node demos/embodied/test/run.ts`。

## 下一步

1. **A3 E1**：DM 看/不看能力的两组对照，测 DC 与能力的相关性、三档身体下的成功率差。
2. **校准**：6 个 profile × 4 个 DC × 2000 次模拟，检查经验成功率与 p 的偏差。
3. **合并演示**：把 `scenario.ts` 的写死动作换成 Mind 的输出。

阻断门见 [DESIGN.md](DESIGN.md) §11（EA-10–18）。
