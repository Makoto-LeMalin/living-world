# 带 NPC 的世界 Demo

**状态：B0–B3 完整可验证（13/13 门）；B4 人工评审未做。**

- 67 个单进程测试通过；`pnpm typecheck` 0 错误。
- B2 报告：运行 `pnpm report:world` 生成 `reports/world-validation.md`（12/12 门；本地文件，gitignored）。
- B3 报告：同一命令生成 `reports/world-b3-validation.md`（13/13 门；本地文件，gitignored）。
> 裸 `node demos/world/src/cli.ts report` 只生成报告，不写新鲜度印记；`check:baseline` 会拒绝，验证请用 `pnpm report:world`。
- B3 完整 3 天真实 DeepSeek：4 次 WorldDirector 调用 / 7 个合法提案；14 次角色对话，全部 `source=llm`、claims 合法、cassette 0 miss。
- CharacterRuntime：PC/NPC/群体共用契约；T0–T3 有自然晋升/降级；CM-6 20 次降级→晋升、CM-7 个体化/合并、CM-8 0 泄漏均通过。
- NPC 动作仍 100% 规则；LLM 只做 WorldDirector 提案和同房间角色台词。
- 主线：seed 7 / 3 天 / 12 房间 / 10 具名 NPC / 2 群体。

## 这个 demo 回答什么

**主问题**：规则能否养活一个无人干预的聚落，并让它可回放、可查询、可解释？
**副问题**：一条“罪 → 目击 → 传闻 → 执法 → 拘禁 → 物价”的链，能否全程由规则完成？
**新增问题**：PC 从 A 到 B 再回 A，路上遇到谁、在 B 听到什么 A 的传闻、回 A 时哪些没变/哪些变了、变化如何与传闻对照？

## 跑法

```bash
# 构建 + 不变量
node demos/world/src/cli.ts build --seed 7

# 三天 headless；打印事件量、盗窃/火灾链、日程、预算、返回差分、D4 问话
node demos/world/src/cli.ts sim --seed 7 --days 3

# 同一份结果导出 JSON
node demos/world/src/cli.ts sim --seed 7 --json

# 问 NPC（只读 Belief，不读全局真相）
node demos/world/src/cli.ts ask --npc guard --q "你们抓了谁？"
node demos/world/src/cli.ts ask --npc child --q "谁偷了面包？"
node demos/world/src/cli.ts ask --npc ferryman --q "谁偷了面包？"   # 知识边界：不知道

# B3：完整 3 天真实 LLM 仿真（runtime + T0–T3 + 群体 + focus 对话）
node demos/world/src/cli.ts b3 --replay --seed 7 --days 3
node demos/world/src/cli.ts b3 --record --seed 7 --days 3   # 重新调用真实模型并写 fixtures/llm-b3

# B3 单点：focus 对话 / WorldDirector
node demos/world/src/cli.ts talk --npc merchant --q "这里发生过什么？"      # 模板，0 调用
node demos/world/src/cli.ts talk --llm --record --npc merchant --q "这里发生过什么？"
node demos/world/src/cli.ts talk --replay --npc merchant --q "这里发生过什么？"
node demos/world/src/cli.ts director --seed 7
node demos/world/src/cli.ts director --llm --record --seed 7

# 查看一个 NPC 的知识/情绪/位置
node demos/world/src/cli.ts inspect --npc guard

# 生成编年史与验证报告
node demos/world/src/cli.ts chronicle --seed 7 --out reports/world-chronicle.md
pnpm report:world

# 测试
node demos/world/test/run.ts
pnpm test:world
```

## 当前验收结果（seed 7）

| 项 | 结果 |
|---|---|
| 20 seed builder 不变量 | 20/20 |
| 确定性回放 | 5/5 事件日志内容哈希一致 |
| 日程遵循 | 100.00%（adhered 3977 / transit 123 / excused 220 / violations 0） |
| 事件三源（B2 主仿真） | 668 事件；ambient 33 / actor 504 / special 3 / system 128 |
| 盗窃链 | 成功；TheftAttempt → Succeeded → Witnessed → RumorTold → Investigated → WitnessStatement → Accused → Jailed |
| 火灾链 | FireStarted → FireSpread / FireContained → FireDamaged → PriceChanged → FireCrowd |
| 相关 NPC 知情率 | 88%（7/8，盗窃后 12h） |
| A→B→A | stable 11 / changed 12 / added 4 / removed 2；Echo 含 confirmed + distorted |
| B3 完整 3 天 | 760 事件；T0/T1/T2/T3 全在；晋升 1 / 降级 2；群体个体化 1 / 合并 1 |
| B3 真实调用 | Director 4 次 / 7 个提案；角色对话 14 次 / 7 个 NPC + 1 个个体化群体成员；cassette 0 miss |
| B3 预算峰值 | 角色 5/22、Director 2/8、总 7/30、单 tick 2/3、offstage 0 |
| B3 回放 | 同 seed 两次事件日志/投影 hash 一致（46c85469） |

## 结构

```
demos/world/
├── README.md
├── DESIGN.md
├── fixtures/ferry-market.json     手写 canon：12 房间/10 NPC/2 群体/3 段路
├── src/
│   ├── types.ts                   共享类型
│   ├── world/                     canon/builder、World、director、llm-director、invariants
│   ├── agents/character.ts         CharacterRuntime 契约 / PC 脚本 runtime / CharacterRecord
│   ├── agents/runtime.ts           NpcRuntime（日程、需求、移动、行为）
│   ├── agents/tiers.ts             T0–T3 importance / 晋升 / 降级 / 冷却
│   ├── agents/crowd.ts             T3 群体、个体化/合并、CrowdRuntime
│   ├── agents/dialogue.ts          同房间对话、claims 校验、模板回退
│   ├── rules/                     plans、budget、economy、theft、fire、law、rumor、ambient、travel、return
│   ├── query.ts                   chronicle / ask / inspect / metrics / 正向链
│   ├── sim.ts                     三日仿真（sync/async）、B3 runtime、规则触发、返回差分
│   ├── run.ts                     12 门 B2 验证 runner + 报告
│   ├── b3-checks.ts               CM-1/5/6/7/8 可执行检查
│   ├── b3-full.ts                 完整 3 天真实 LLM 仿真
│   ├── b3-run.ts                  13 门 B3 验证 + cassette 回放
│   └── cli.ts                     CLI（sim/b3/talk/director/report）
├── fixtures/
│   ├── ferry-market.json          手写 canon
│   ├── llm/                       单点 director/对话 cassette
│   └── llm-b3/                    完整 3 天真实运行 cassette（17 个，无 key）
├── test/                          67 个测试（单进程 run.ts）
└── reports/                       生成到根 reports/
```

## 三条硬规则

1. **EventLog 是唯一写路径。** 规则调用 `World.emit`；`emit` 计算目击者、生成 fact/trace、追加事件、再投影。状态可由日志重建。
2. **Fact / Observation / Belief 三分。** 世界持有 canonical `Fact`；角色只持有 `Observation`/`Belief`；传闻是带 `factId` 的 `RumorTold`，不是世界改写。
3. **模型只提方向，不写结果。** EventPlan 先 `proposed → validated → scheduled → pending → resolving → resolved`；WorldDirector/ActionDM 只给 direction/stakes/难度/分支，结果由 `EventResolver` 掷骰。

## 事件三源

| 来源 | 本 demo 里的实现 | 例子 |
|---|---|---|
| `ambient` | 地区 hazard × LOD；高 salience 可交给 `LlmWorldDirector`（失败回退模板）→ Validator → Plan | 雾、渡船晚点、疾病、栈桥松动、火灾 |
| `actor` | NPC 日程/需求/关系 → 行为；复杂动作 `ActionDM` 定难度 → 掷骰 → 成功/失败分支 | 偷窃、交易、巡逻、八卦、指控、拘捕 |
| `special` | canon 写死或势力议程触发；弧线可生成子计划 | 集市日、失窃后的盘查 |

每个 gameplay 事件带 `source`，可选的 `planId` / `proposalId` / `injected`；`injected` 只用于“起火点”等场景种子，不用于结果。盗窃现在由 `npc_thief` 的饥饿/机会规则触发，不再固定 tick。

## 已知限制

- **T3 仍是池化群体**：CrowdRuntime 一次判定作用到分布；个体化成员是 T1，不是“每个成员一个 LLM”。
- **NPC 动作 100% 规则**：不会做出规则没覆盖的“聪明”动作；这是范围，不是产品终局。
- **WB-9 只做了结构检查**：编年史默认过滤 routine，只保留高信号事件；主观“像会发生的事”仍需 2 名评审。
- **20 seed 只跑 builder 不变量**；完整 3 天真实 LLM 只跑了 seed 7，跨 seed 剧情分布仍待评估。
- **火灾分支随 seed/roll 变化**：seed 7 当前是 `FireSpread`，也可能是 `FireContained`；两种都保留完整链。
- **B3 cassette 在 `fixtures/llm-b3/`**：17 个真实响应副本，不含 key/headers；`report` 从它回放，cassette miss=0。
- **传闻链有噪声**：actor 事件 504 条里有大量交易/巡逻/八卦；编年史仍需摘要与 salience 过滤。
- **B 地不是独立聚落**：A=集市、B=码头，同一聚落两片区；跨聚落等 B4/合并 demo。

## 下一步（B4）

1. 编年史摘要 + 2 名评审（WB-9）。
2. 跨 seed 的完整 3 天剧情分布；决定是否把 20 seed 全跑纳入常规验证。
3. 10 分钟演示脚本：`build → sim → b3 → talk → chronicle → report`。
4. 视需要把已录制的 B3 单点探针迁到 `fixtures/llm/` 或删除，避免两套 cassette 混淆。

范围与验收门以本文与 [DESIGN.md](DESIGN.md) 为准；实现决策见 [DESIGN.md](DESIGN.md)。
