# M0 / M1 独立审计报告

| 项 | 内容 |
|---|---|
| 审计人 | Auditor（独立只读；未参与 M0/M1 的设计、开发、测试） |
| 日期 | 2026-11-16 |
| 审计对象 | M0（基线冻结，commit `7164dfa`）、M1（抽共享内核，commit `fc86803` + `eca4cbc`） |
| 审计范围 | 技术声明可复现性、工程证据强度、文档与代码一致性、密钥安全、流程合规性 |
| 不在范围 | 重做设计、改代码、修测试、评估 M2 方案；不做出项目决策 |
| 审计立场 | 只采信可重跑的输出、已提交的 git 历史、代码本身。文档自述不作为证据 |

---

## 0. 总结论

### 0.1 技术结论：**CONDITIONAL PASS（有条件通过，需补证）**

M0/M1 的**核心数字与模块边界经独立重跑全部复现**，没有发现造假或不可复现的数值；M1 的抽取是真实的代码迁移而非空壳改名。因此**技术成果可以保留，不需要重做 M1**。

但证据链有结构性缺陷：仓库基线由 `pnpm verify` 自己重写、测试数是硬编码常量、没有任何对照校验或 CI。也就是说，**“基线没变”这一点目前只能靠 git 历史人工比对来证明（本审计已做），不能靠项目自带的门来证明**。这些缺陷必须在 M2 之前补上，否则 M2 的回归结论同样不可信。

### 0.2 流程结论：**FAIL（不通过）**

M0 与 M1 的全部产出（设计文档、代码、测试、报告、基线、结论）由**同一个 agent、在同一 36 分钟窗口内、以同一 git 作者身份连续完成**；仓库内不存在任何独立评审、独立复现或 CI 记录。M0/M1 属于**自审（self-audit）**，按用户新规则该阶段流程无效。**这一条不受技术结论影响**：技术数字是对的，不代表流程有效。

### 0.3 一句话

> 技术：数字可信、边界真实，但“门”是自证的，需补独立对照与 CI。
> 流程：M0/M1 全程一人多角色、无独立复核，**流程不通过**，需重做的是“审计与验证环节”，不是重写 M1 代码。

### 0.4 需求权威边界（补记）

本次审计**只审 M0/M1 的技术与流程**，不裁决需求是否正确：

- 旧 PRD 的 **D6（观察面板不显示思绪）**、**R-CH4（信道必须会坏/暴露）** 出自同一份有问题的草案，**不作为需求权威**。本报告没有、也不应以它们为依据判定任何缺陷。
- `docs/DEMO_PLAN.md`、`docs/VALIDATION.md` 在本报告中**仅被当作“门 id 的登记表”**用于追溯性核对（E34/E35、I-5），**不是需求权威**，也不用于反推需求。
- 若某处文档与用户最新决定冲突，本报告只记为“**文档待重写**”，**不计为技术失败**；此类问题不进入 §3 的阻断/重要分级，也不进入 §4 的前置条件（除非同时是证据链问题）。

---

## 1. 方法与约束

**只读手段**：`git`（含历史对象 `git show`/`git diff`/`git ls-files`）、文本扫描、重跑验证命令、重生成被 gitignore 的报告。

**明确未运行**（遵守任务约束）：

- `pnpm verify`：会执行 `pnpm baseline`，**重写 tracked 的 `reports/baseline.md`/`.json`**。
- `pnpm baseline`：同上。

因此 `docs/M1.md:128` 声称的“`pnpm verify` 通过”属于**未能端到端验证**的声明；但其全部组成步骤（typecheck / check:imports / test:all / check:secrets / report）已由本审计**逐条单独运行并复现**（见 §2）。唯一未被本人复跑的环节是最后的 baseline 写入本身——而这一步恰恰是问题所在（见 §3.1 B-1）。

**允许的写入**：仅重生成 `reports/world-*`（gitignored，任务明确允许）与本报告 `docs/audits/M0-M1-AUDIT.md`。重生成前后 `git status --short` 均为空，**未触碰任何 tracked 文件，未提交 git**。

---

## 2. 证据表

| # | 检查项 | 命令 | 结果 | 关键数字 / 文件 |
|---|---|---|---|---|
| E1 | 工作区状态 | `git status --short` | **空**（干净，无未提交改动） | 重生成报告后再次为空 |
| E2 | 提交范围 | `git log --oneline -5` | 3 个提交，无分支 | `eca4cbc` M1；`fc86803` clock；`7164dfa` M0 |
| E3 | 提交作者/时间 | `git log --format='%h %an %ci %s'` | **同一作者 Makoto-LeMalin，23:50:46 → 00:01:38 → 00:26:50，共 36 分 04 秒** | 流程证据，见 §3.1 B-2 |
| E4 | 类型检查 | `pnpm typecheck` | exit 0，0 错误 | `tsconfig.json:14` 覆盖 `src/test/demos/engine/harness/llm` |
| E5 | 测试总数 | `pnpm test:all` | 具身 **100 pass / 0 fail**；世界 **67 / 0**；内核 **27 / 0** | 合计 **194**，与 `reports/baseline.json:6-12` 完全一致 |
| E6 | 依赖方向门 | `pnpm check:imports` | `ok: no dependency violation (11 files)` | src 9 + engine 2；`scripts/check-deps.mjs` |
| E7 | 密钥扫描 | `pnpm check:secrets` | `ok: no secret pattern found` | `scripts/check-secrets.mjs` |
| E8 | B2/B3 门（独立重生成） | `node demos/world/src/cli.ts report` | **B2 gates 12/12 PASS；B3 gates 13/13 PASS** | 只写 `reports/world-*`（gitignored） |
| E9 | B2 数值（重生成后读 JSON） | 读 `reports/world-validation.json` | 事件 **668**；sources `{ambient:33,actor:504,special:3,system:128}`；projectionHash **fb6cb1e3**；fullHash **8b77f4ae** | 与 E10、baseline 三项一致 |
| E10 | B3 数值（重生成后读 JSON） | 读 `reports/world-b3-validation.json` | 事件 **760**；sources `{31,595,1,133}`；`hashA=hashB=`**46c85469**；identical=true；misses 0；cassettes 17 | 与 E9 同源重跑 |
| E11 | M0→HEAD 基线差异 | `git diff 7164dfa HEAD -- reports/baseline.json` | **仅 `tests` 块变化（167→194，新增 kernel:27）**；B2/B3 全部字段（事件数、来源分布、三个 hash、门 id）**逐字节未变** | 这是“M1 行为不变”**唯一独立、已提交**的证据 |
| E12 | M0 已提交基线 | `git show 7164dfa:reports/baseline.json` | 668 / fb6cb1e3 / 8b77f4ae / 760 / 46c85469；tests 100+67=**167** | 与当前一致 |
| E13 | 中间快照（P1.1 时钟） | `git show fc86803:reports/baseline.json` | tests kernel **12** / total **179**；B2/B3 与 E12 相同 | 三次独立快照数值一致 |
| E14 | 测试数是如何进基线的 | 读 `scripts/baseline.mjs:50-56` | **硬编码字面量** `{embodied:100, world:67, kernel:27, total:194}`，不读测试输出 | 见 §3.1 B-1；M0 版本同样硬编码 167 |
| E15 | 门号是如何进基线的 | 读 `scripts/baseline.mjs:109,119` | 模板为 `${gates}/${gates}`，**同一变量除自身**，恒为 “N/N” | 见 §3.2 I-5 |
| E16 | verify 的构造 | 读 `package.json:22` | `typecheck && check:imports && test:all && check:secrets && report && baseline`；**最后一步重写 tracked 基线，之后无任何 diff 断言** | 见 §3.1 B-1 |
| E17 | 是否存在“期望基线”对照 | 扫描 `scripts/*.mjs` 找 `git diff`/`exit-code`/`expected`；全仓找 `*expected*` | **均无** | 自证闭环 |
| E18 | CI 配置 | 查 `.github`、`*.yml/*.yaml`、`.husky`、`.git/hooks/pre-commit` | **全部不存在** | 无自动门 |
| E19 | demo 是否真 import 共享模块 | grep `from ".../src/kernel/*"` 于 `demos/**` | **真 import，共 40+ 处**；`check.ts`/`world.ts`/`canon.ts`/`runtime.ts`/`budget.ts`/`fire.ts`/`theft.ts`/`agents/*` 均引用 | 非“仅改名” |
| E20 | demo 旧内核是否删除 | `git ls-tree 7164dfa -- demos/world/src/kernel` vs 磁盘 | M0 有 `clock.ts`+`rng.ts`；**现在目录已不存在** | 删除真实 |
| E21 | 谁还在直接依赖 engine | grep `from ".*engine/` | 仅 4 个文件：`llm/cassette.ts`、`harness/replay.ts`、`src/kernel/canonical-json.ts`、`src/kernel/rng.ts` | demo 已全部改走 `src/kernel`，符合 `DEPENDENCIES.md:70` |
| E22 | 时钟是否为真实现 | 读 `src/kernel/clock.ts`（236 行）对比 M0 `demos/world/src/kernel/clock.ts`（32 行） | M0 仅 5 个纯函数；现含 `ClockSpec` 校验、`WorldClock`、暂停/恢复/序列化/补齐、`dueTicks` | 真扩展，非搬运 |
| E23 | RNG/JSON 是否为转发 | 读 `src/kernel/rng.ts:9-11`、`canonical-json.ts:8-11` | 两者**再导出 `engine/*`**；rng 新增 `stream/roll/chance/pick`（与 M0 demo 版逻辑完全相同），canonical-json 新增 `hashCanonical` | 属“搬迁+入口”，见 §3.3 M-1 |
| E24 | EventStore / Projection 是否分离 | 读 `src/world/event-store.ts`、`src/world/projection.ts`、`demos/world/src/world/world.ts:94-100,341-342` | 接口与类已分离；`World.emit` 改为 `events.append(e)` 再 `this.apply(e)` | **但同一数组别名**，见 §3.2 I-3 |
| E25 | 共享 harness 是否被采用 | grep `InvariantBuilder/verifyReplays/combineReports/duplicateIds` | `verifyReplays`→B2（`run.ts:98`）与测试；`InvariantBuilder`→canon 检查；`combineReports` **零调用**；`duplicateIds` **仅测试** | 部分采用 |
| E26 | Space 是否被生产代码使用 | grep `new Space / scopeRoomIds / neighbors / validate` | `World` 用 `room/placeOfRoom/roomsInPlace/routeBetween(经 travel)/scopeRoomIds`；`neighbors`/`validate` **仅测试调用** | 见 §3.3 M-2 |
| E27 | 测试分布 | 统计各文件 `test(` | 内核：clock 12 / kernel 7 / space 5 / event-store 3 = **27**；世界 8 文件合计 67 | 与文档口径一致 |
| E28 | 密钥是否入库 | `git ls-files`（152 个文件） | **无 `.env`**；仅 `.env.example`；`.gitignore` 已忽略 `.env`/`.env.*` | 合规 |
| E29 | cassette 是否含 key/headers | 扫描 19 个 JSON 的字段名 | `authorization`/`api-key`/`apikey`/`headers`/`bearer`/`sk-` **命中均为 0**；文件仅 `{request,response}` | 合规 |
| E30 | cassette 是否入库 | `git ls-files demos/world/fixtures` | llm-b3 **17** 个 + llm 探针 **2** 个，均已提交 | 与 baseline “17/2” 一致 |
| E31 | 门级报告是否入库 | `git ls-files reports/` | **仅** `README.md`、`baseline.json`、`baseline.md` | `world-validation.*`/`world-b3-validation.*` 被 gitignore，见 §3.2 I-6 |
| E32 | 运行时依赖 | `package.json` + `pnpm-lock.yaml` | 无 `dependencies`；仅 `@types/node`、`typescript` 两个 devDeps；代码只用 `node:` 内建 | 符合 G1“不新增运行时依赖” |
| E33 | 非确定性源 | grep `Math.random|Date.now` | 代码 **0 处**（仅注释中出现） | 符合“不读挂钟” |
| E34 | B2 门的规格来源 | 对比 `docs/DEMO_PLAN.md:244-253` 与报告（该表**仅作门 id 登记**，非需求权威，见 §0.4） | 登记表为 **WB-1..WB-10**（10 门）；报告为 12 门（多 `A→B→A`、`PROV`） | 见 §3.2 I-5 |
| E35 | B3 门的规格来源 | 对比 `DEMO_PLAN`/`VALIDATION.md` 的 B3-* id 与报告（同上，仅作门 id 登记） | 13 个 id **完全一一对应** | B3 门可追溯 |

---

## 3. 发现

### 3.1 阻断级

#### B-1（阻断，技术）基线是自证的，且测试数是硬编码

- `package.json:22`：`verify` 的**最后一步**是 `pnpm baseline`。
- `scripts/baseline.mjs:89-90`：直接 `writeFileSync` 覆盖 **tracked** 的 `reports/baseline.md`/`.json`。
- 之后**没有任何** `git diff --exit-code`、没有独立 expected 文件、没有 CI（E17/E18）。
- `scripts/baseline.mjs:50-56`：测试数 `{100,67,27,194}` 与 `verifiedBy:"pnpm test:all"` 是**字面量**；M0 版本写的是 `{100,67,167}`（`git show 7164dfa:scripts/baseline.mjs`）。测试数增减时基线**不会**自动反映，`baseline.md:10` 的“由 `pnpm test:all` 验证”是**错误归因**。
- 后果：M1+ 任何行为回归，只要重跑一次 `verify`，基线就被“更新为新事实”，门不会红。**“M0 基线未变”这一结论在项目内部不可证**——本审计只能靠 `git diff 7164dfa HEAD`（E11）证明它，而这是人工动作，不是门。
- 判定：**M0 作为“不可回退基线”的技术承诺不成立**。数字本身可信（E5/E9/E10/E11/E12/E13），但“可回归”不成立。

#### B-2（阻断，流程）M0/M1 全程一人多角色、无独立复核

证据：

1. E3：三个提交**同一作者**，跨度 **36 分钟**，覆盖 M0 基线 + 时钟 + M1 全部抽取。
2. `7164dfa` 一个提交就包含 **108 个 demo 文件 + 11 个 docs + 基线 + 契约**（`git show --stat`），即“M0 冻结”与“两个 demo 实现”同时落地——**不存在“先有 demo、后冻结基线”的历史**，M0 是自我快照，不是对既有状态的冻结。
3. 仓库内**无** `docs/audits/`（本报告为首份）、无评审记录、无 CI、无 hooks（E18）。
4. 唯一的“验证”是作者自己跑 `pnpm verify` 并把结果写进自己的文档（`docs/M1.md:128-140`）：**自测自审**。
5. 基线文件在同一阶段被**重写两次**（`fc86803` 与 `eca4cbc` 均修改 `reports/baseline.*`），每次都是作者自己的命令产物。

判定：M0/M1 **流程无效**，属于自审。补救不是重写代码，而是补独立复核（见 §4）。

### 3.2 重要级

#### I-1 “字节一致”的措辞强于证据

`DEVELOPMENT_PLAN.md:130`（G1）要求“事件日志**字节一致**”，`M1.md:24,122` 与 `DEVELOPMENT_PLAN.md:148` 声称“均与 M0 相同”。
实际证据只有：**32 位（8 hex）哈希相等**（`fullHash`/`projectionHash`/`replayHash`）+ 事件数与来源分布相等。`fullHash` 覆盖含 `eventLog` 的整个状态，因此是有意义的强证据，但**不是逐字节比较**；且报告 `reports/world-events.jsonl` 被 gitignore（E31），版本库里没有可字节比对的事件日志样本。32 位哈希存在理论碰撞空间。
建议改为“32 位内容哈希一致 + 计数一致”，或提交一份事件日志样本做真正的 diff。

#### I-2 `check:imports` 的覆盖面远小于 `DEPENDENCIES.md` 的矩阵

`scripts/check-deps.mjs` 实际只做三件事，且只扫 **11 个文件**：

- 只扫 `src/**` 与 `engine/**`（`check-deps.mjs:44,61`）；`harness/`、`llm/`、`demos/` 不在扫描范围。
- 只检查**相对路径** import（`if (!spec.startsWith(".")) continue`，`:49,66`）：任何别名/裸说明符可绕过。
- 只实现 3 条规则：src→demos 禁止、contracts 只能自依赖、engine 不依赖 llm/harness/src。
- `DEPENDENCIES.md:31-44` 矩阵的绝大多数单元格（如 `src/kernel` 不得 import `src/characters`、`src/space` 不得 import `src/world`、`llm` 不得依赖领域层、`harness` 不得依赖 src）**完全没有被检查**。
- `DEPENDENCIES.md:44,79` 声称的“`src/host` 不能带宿主类型”在当前**没有 `src/host`**，是空检查（`DEPENDENCIES.md:44` 自己也承认“先留检查”）。
- 结论：`check:imports` 是**文本扫描的 3 条最小规则**，不是“依赖矩阵的门”。文档 `DEPENDENCIES.md:74-82` 的描述基本准确（“扫描是文本级”），但 G1 把“`check:imports` 通过”当作“依赖方向正确”的证据，强度不足。

#### I-3 `EventStore`/`Projection` 已分离，但“唯一写路径”仍只是约定

- 形式上：`EventStore`（`src/world/event-store.ts`）与 `Projection`（`src/world/projection.ts:8-10`）是两个独立抽象，`World implements Projection`，`emit` 改为 `append` + `apply`（`world.ts:341-342`）。这是**真实的结构改变**，不是改名。
- 但隔离是假的：`world.ts:97-100` 中 `this.state.eventLog = events; this.events = new EventStore(events);` —— **同一个数组被两处持有**，`append` 只是往共享数组 push；任何持有 `world.state` 的代码仍可直接 `push` 绕过 store。
- 更严重的是测试把这个别名**固化成了契约**：`test/event-store.test.ts:45` 断言 `assert.equal(world.events.all(), world.state.eventLog)`（引用相等）。将来想真正隔离（复制/只读视图/换存储）会**直接撞测试**。
- `EventStore` 也没有注入点：`World.apply` 是硬编码调用，`Projection` 接口当前只被 `World` 自己实现，`replayProjection` 仅测试使用。
- 结论：“记录与解释分离”在**接口层成立**，在**写路径隔离层不成立**；`ARCHITECTURE.md`/`DEMO_PLAN` 的“EventLog 是唯一写路径”仍是**靠自觉的约定**。这不否定 M1，但 M1.md 对此的表述偏乐观（`M1.md:104` 已部分承认“投影未拆”）。

#### I-4 文档漂移（5 处，均与 M1 事实冲突）

| # | 位置 | 现状 | 应有 |
|---|---|---|---|
| D-1 | `docs/DEVELOPMENT_PLAN.md:8`（头部“当前基线”） | “具身 100 测试；世界 67 测试” | 应含 27 内核 / 194 总数（同文件 `:102` 已写 194，自相矛盾） |
| D-2 | `reports/README.md:15` | “P0 基线：**167** 测试” | 194（该行还标注“是（P0 冻结）”，与自身内容不符） |
| D-3 | `demos/world/README.md:85` | 目录树含 `src/kernel/  时钟、RNG 流` | 该目录**已被 M1 删除** |
| D-4 | `demos/world/DESIGN.md:796` | 目录树含 `kernel/  clock, rng` | 同上，已删除 |
| D-5 | `demos/embodied/README.md:112` | “共享代码：`engine/`（RNG、规范化 JSON）、`harness/claim.ts`、`llm/`” | 具身 demo 现在实际 import 的是 `src/kernel/rng.ts`、`src/kernel/canonical-json.ts`；未提 `src/kernel` 属误导 |

已更新到位的（可保留）：根 `README.md:92,101-105`（M1 行、194、27）、`docs/README.md:11`、`docs/ARCHITECTURE.md:169`、`docs/DEPENDENCIES.md:21-23,66-70`。

#### I-5 门的“N/N”是恒等式，且 B2 门数与规格表不一致

- `scripts/baseline.mjs:109,119` 生成 `门：${gates}/${gates}`：同一数字除自己，**永远 N/N**。虽然 `assertGates`（`:28-34`）会在有失败门时抛错，使文件不会写出失败态，但**这一行本身不校验“应有几门”**；门被删/改名而总数仍通过时，基线照样显示满门。
- `baseline.mjs:51-56` 同理：没有 `expectedGateIds` 对照，`gateIds` 只是把当次报告的 id 抄了一遍。
- B2 规格：`docs/DEMO_PLAN.md:244-253` 只定义 **WB-1..WB-10**（10 门）；报告的 12 门多出 `A→B→A` 与 `PROV`（对应 `DEMO_PLAN` §4.2 机制 6、7）。两门本身合理，但“12 门”这个数字**无法从规格表逐行追溯**；B3 的 13 门则与规格 id 完全对应（E35）。
- 影响：门数是**回归时的锚点**；锚点本身无对照，M2 的“B3 13/13 不回退”也会是同一问题。
- **边界说明（按 §0.4）**：这里的缺陷是**证据链缺陷**（门数无期望表对照、门号行由恒等式生成），不是“门的设计不符合某份需求”。`DEMO_PLAN` 只被用来判断“12 这个数字能否逐行追溯”，不作为需求权威；若门表本身将随用户新方向重写，本条仍成立——M2 的回归锚点必须来自**新门表的显式期望清单**，而不是当次运行的输出。门表内容本身若需变更，只记为“文档待重写”，不构成技术失败。

#### I-6 门级证据不在版本库，README 里的链接在克隆后是断链

- `git ls-files reports/` 只有 `README.md`、`baseline.json`、`baseline.md`（E31）；`reports/world-validation.md`、`reports/world-b3-validation.md` 被 `.gitignore` 的 `reports/world-*` 忽略。
- 但 `demos/world/README.md:6-7`、`docs/DEMO_PLAN.md:216`、`reports/README.md:13-14` 都直接链接这两个文件。
- 后果：**B2/B3 的门级明细（哪一门、什么 detail）不在仓库里**，只有聚合后的 baseline 数字被提交；任何复核者必须自己重跑一次才能看到门。对本审计可接受（我重跑了，E8-E10），但对“可审计仓库”不合格。

### 3.3 次要级

| # | 发现 | 证据 |
|---|---|---|
| M-1 | `src/kernel/rng.ts`、`canonical-json.ts` 是**对 `engine/` 的再导出**（前者补的 4 个函数与 M0 demo 版**逐字相同**，后者补 `hashCanonical`）。真正的新实现只有 `clock`/`ids`/`snapshot`。“抽共享内核”对 RNG/JSON 实为“搬迁 + 稳定入口”，与 `M1.md:46` 自述一致，但外部易误读为全部重写 | `src/kernel/rng.ts:9-29`；`git show 7164dfa:demos/world/src/kernel/rng.ts` |
| M-2 | 共享层的死代码/半采用：`Space.neighbors`、`Space.validate` 无生产调用者；`harness/invariant.ts:32` `combineReports` 零调用；`:41` `duplicateIds` 仅测试使用；`checkWorldInvariants` 仍手写 `checks++`，与 `checkCanonInvariants` 已改用 `InvariantBuilder` 不一致 | E25/E26；`demos/world/src/world/invariants.ts:6,13,46+` |
| M-3 | `World` 保留三个近重复方法：`occupants`(:148)、`placeOccupants`(:160)、`occupantsIn`(:173)，仅谓词不同。抽取后未合并 | `demos/world/src/world/world.ts` |
| M-4 | `harness/replay.ts` 的 `hashes` 实际返回 **canonical JSON 字符串**，不是哈希；命名与语义不符，读者会误以为是摘要 | `harness/replay.ts:8-20` |
| M-5 | `check:secrets` 只匹配 `sk-` 前缀与 `DEEPSEEK_API_KEY=` 两种形态；`.env*`（除 `.env.example`）被跳过。密钥若以其他形态出现在 tracked 文件中不会被发现 | `scripts/check-secrets.mjs:10-14,30` |
| M-6 | 两套 cassette 并存：`fixtures/llm`（2 个探针）与 `fixtures/llm-b3`（17 个完整）；项目自己已列为待清理 | `demos/world/README.md:140` |
| M-7 | 无 Node 版本锁定（无 `.nvmrc`/`volta`），只在 `package.json:8` 声明 `>=24`；无 CI 检查实际 Node 版本 | `package.json:7-9` |
| M-8 | M0/M1 的提交边界与阶段声明不完全对齐：`fc86803` 是 P1.1 时钟却以 `feat:` 提交、早于“M1 完成”；M0 提交同时含两个 demo 全部实现 | E3、`git show --stat 7164dfa` |
| M-9 | `docs/ARCHITECTURE.md:0.1 当前落地程度` 表**未列 M1 的共享内核**（只有能力维度），虽不算错，但作为“当前落地程度”缺少 M1 这一行；`:169` 有补述 | `ARCHITECTURE.md:29-43,169` |

---

## 4. M2 前置条件（必须先补证/修正，均为“补证据”，非“重写代码”）

按优先级；1–4 未完成则 M2 的任何回归结论同样不可信。

1. **冻结基线对照（对应 B-1）**
   新增一份**不被命令改写**的期望值文件（如 `reports/baseline.expected.json`），或在 `baseline` 之后加 `git diff --exit-code reports/baseline.*`，使 `pnpm verify` 在数值变化时**红**。同时把 `scripts/baseline.mjs` 的测试数改为**解析 `test:all` 输出**，删除硬编码 194/167/27。
2. **CI 或等价的自动门（对应 B-1/B-2）**
   至少 `typecheck + check:imports + test:all + check:secrets` 在**提交前/推送时自动跑**（LLM 与 baseline 重写不进 CI）。当前仓库零 CI、零 hooks。
3. **`check:imports` 覆盖到文档声明的矩阵（对应 I-2）**
   要么扩展检查（补 `harness`/`llm`/`src` 子模块间规则、支持非相对说明符、加 AST 或至少加白名单式 import 表），要么在 `DEPENDENCIES.md` 明确写“本门只覆盖 3 条规则、11 个文件”，不得再以它作为 G1/G2 的依赖证据。
4. **门数与期望门表对照（对应 I-5）**
   把 `expectedGateIds`（B2 12 个、B3 13 个）写进 `baseline.mjs` 或独立配置，与报告 id 集合做**集合相等**校验；`baseline.md` 的“N/N”改为“通过/期望”。
5. **门级报告入库或改为可复现钩子（对应 I-6）**
   至少把 `reports/world-validation.md`、`reports/world-b3-validation.md` 提交（或在 `.gitignore` 与文档链接之间二选一，去掉断链）。
6. **修正 5 处文档漂移（见 I-4 D-1..D-5）**
7. **收窄“字节一致”表述（对应 I-1）**：文档改为“32 位内容哈希 + 计数一致”，或提交一份事件日志样本用于逐字节 diff。
8. **明确 EventStore 现状（对应 I-3）**：在 `M1.md`/`DEPENDENCIES.md` 写明“当前 store 与 `state.eventLog` 共享同一数组，写入隔离未强制”；M2 若要依赖该隔离，先去掉 `test/event-store.test.ts:45` 的别名断言并实现真正隔离。
9. **补一次独立复核（对应 B-2，流程）**：由另一角色（或另一独立环境）在干净克隆上重跑 E4–E10 并留存输出；本报告可作为基线，但**不能替代**第二人的复核记录。

---

## 5. 未验证项（明确“未能验证”，不做推测）

| # | 声明 | 状态 | 原因 |
|---|---|---|---|
| U-1 | “完整 3 天**真实** DeepSeek 调用（4 Director + 14 对话）” | **未能验证** | 只能验证 cassette 回放一致（miss=0、llmSources=14）。cassette 是否真由真实 API 产生，离线无法证明：仓库内无请求日志/usage/时间戳/账单证据。回放一致性 ≠ 真实调用发生过 |
| U-2 | M0 提交时点的 167 测试是否由**该提交代码**实际跑出 | **未能验证** | 无运行日志；要回溯必须 checkout `7164dfa`（会改动工作区，违规）。可确认的是：该提交的 `test:all` 只含两个 suite，167 在结构上自洽 |
| U-3 | `pnpm verify` 端到端通过 | **未能验证**（按约束未运行） | 会重写 tracked 基线。其 5/6 个组成步骤已单独复现；未复现的是 `pnpm baseline` 本身 |
| U-4 | “同 seed 事件日志**字节一致**” | **未能验证到字节级** | 仅有 32 位哈希相等 + 计数相等；无可提交的字节样本（见 I-1） |
| U-5 | WB-9“编年史可信”的主观部分 | **未验证（项目亦自认未做）** | 需 2 名人工评审；报告 `WB-9` 自述“结构检查，主观评审未做” |
| U-6 | 非 seed 7 的剧情分布、跨 seed 稳定性 | **未验证** | 20 seed 只跑 builder 不变量；完整 3 天仅 seed 7 |
| U-7 | `.env` 内的 key 是否真实/有效/是否泄漏 | **未验证（按规则不读取、不打印）** | 已确认 `.env` **未被 git 跟踪**且被忽略；文件存在（551 B） |
| U-8 | `src/host` 规则（`DEPENDENCIES.md:43,79`）是否有效 | **无法验证（空实现）** | 当前无 `src/host` 目录，检查为空转 |

---

## 6. 结论保留清单（供决策参考）

**可以保留（已独立复现，可作为 M2 起点）**

- 测试基线 **194 = 100 + 67 + 27**（E5）。
- B2：**668** 事件 / `fb6cb1e3` / `8b77f4ae` / 12 门（E8-E10）。
- B3：**760** 事件 / `46c85469`（A=B）/ 13 门 / cassette 17 / miss 0（E8-E10）。
- **M0→M1 行为未变**：已提交基线在三个快照间 B2/B3 全部字段不变（E11-E13）——这是 M1 最硬的一条证据。
- 共享内核抽取**真实存在**：demo 真 import `src/kernel`，旧 `demos/world/src/kernel/` 已删除，`clock` 为实质扩展（E19-E23）。
- 无运行时依赖、无 `Math.random`/`Date.now`、`.env` 未入库、cassette 无 key/headers（E29-E33）。
- 具身 100 / 世界 67 测试未回退（E5）。

**不可信 / 需降级表述**

- “M0 是不可回退基线” → 目前是**可被自动改写的基线**（B-1）。
- “`pnpm verify` 通过”作为 gate 证据 → 自证闭环，需换成与期望值的对照（B-1）。
- “事件日志**字节一致**” → 降级为“32 位内容哈希一致”（I-1）。
- “`check:imports` 通过 ⇒ 依赖方向正确” → 仅 3 条规则 / 11 文件（I-2）。
- “EventLog 是唯一写路径” → 接口层成立、隔离层不成立（I-3）。
- “门 12/12、13/13” → B3 可追溯；B2 的 12 与规格表 10 门不一致，且数字由恒等式生成（I-5）。

**流程定性**

M0、M1 **两个阶段均属同一 agent 的设计+开发+测试+自审**，无独立复核、无 CI、无评审记录（B-2）。按用户新规则：**这两阶段的流程结论为无效（FAIL）**；技术成果可保留，但**必须补做独立验证环节**后，才能作为 M2 的准入基线。

---

*本报告为只读审计产出；除本文件与 gitignored 的 `reports/world-*` 外，未修改任何文件，未执行 git 提交。*
