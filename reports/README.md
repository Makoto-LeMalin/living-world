# reports

每次 `scenario` / `scenario llm` 运行的产物：

| 文件 | 内容 | 是否进 git |
|---|---|---|
| `<name>-<seed>.jsonl` | 每条 check 的完整输入、结果、bodyHash、LLM trace | 否（`.gitignore`） |
| `<name>-<seed>.log` | 后台逐步输出；`--trace off` 时退化为 transcript | 否（`*.log`） |
| `parity-<seed>.md/.json` | v0 vs v2 的 7 身体 × 12 动作对照报告 | 否（`reports/parity-*`） |
| `compiler-v3.md/.json` | V3 编译器：100 条 × blind/aware、本体标签、漂移、明细 | 否（`reports/compiler-*`） |
| `v3-validation.md/.json` | V3 完整验证：16 道门槛、1500 例端到端、覆盖、稳定性 | 否 |
| `v3-review.md/.csv` | 100 行人工抽检包，按风险标记排序 | 否 |
| `world-validation.md/.json` | 世界 demo B0–B2：12 道门、20 seed、3 天、盗窃/火灾链、12h 知情率、返回差分 | 否 |
| `world-b3-validation.md/.json` | B3：完整 3 天真实 DeepSeek、CharacterRuntime/T0–T3/群体、CM-1/5/6/7/8、13 门 | 否 |
| `baseline.md/.json` | P0/M1 回归基线：194 测试、B2/B3 事件/hash/门、cassette 数；期望锚在 `baseline.expected.json` | 是（对照通过后生成） |
| `world-events.jsonl` | seed 7 的完整 `WorldEvent` 日志（可回放/审计） | 否 |
| `world-chronicle.md` | 从事件日志生成的 3 天编年史 | 否 |

## 怎么读

- 想看重播：`pnpm demo:embodied replay --log reports/tablet-night-42.jsonl`
- 想看每一步：直接读 `.log`，或重跑并加 `--trace full`。
- 想看 v0/v2 对照：`pnpm demo:embodied parity --seed parity`，报告在 `reports/parity-parity.md`。
- 想看编译器：`pnpm demo:embodied compiler --record`，报告在 `reports/compiler-v3.md`。
- 想看完整 V3：`pnpm demo:embodied v3 --replay`，汇总在 `reports/v3-validation.md`，人工抽检包在 `reports/v3-review.md`。
- 想看世界 demo：`pnpm report:world`，汇总在 `reports/world-validation.md` 与 `reports/world-b3-validation.md`，原始事件在 `reports/world-events.jsonl`。裸 `node demos/world/src/cli.ts report` 不写新鲜度印记，`check:baseline` 会拒绝。
- 想看世界 B3：`node demos/world/src/cli.ts b3 --replay --seed 7 --days 3`；完整 3 天真实响应副本在 `demos/world/fixtures/llm-b3/`。单点 `talk`/`director` 仍可用 `--record`/`--replay`。
- 想看世界编年史：`node demos/world/src/cli.ts chronicle`，输出 `reports/world-chronicle.md`。
- 想看机器可读结果：`--json` 输出到 stdout（此时 trace 自动关闭）。

## tag

`[body]` `[caps]` `[check.*]` `[dm.request]` `[dm.prompt]` `[dm.raw]` `[dm.valid]` `[dm.fallback]` `[narrator.*]` `[result]` `[facts]` `[log]`

日志里不会有 API key，也不会有 HTTP headers。
