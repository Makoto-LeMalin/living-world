# R0 独立审计报告

| 项 | 内容 |
|---|---|
| 审计人 | `r0-auditor`（独立只读；未参与 R0 设计、实现、测试） |
| 日期 | 2026-11-16 |
| 审计对象 | R0「门禁证据修复」，初始审查 `a6acc91`；条件复核至 HEAD `964e89c`（含 `f4d39c7`） |
| 审计范围 | 技术：B-1 是否真正关闭、测试有效性/覆盖评估是否成立、残留是否登记、门是否可能自证；流程：角色分离、Document Manager 写入范围、M0/M1 流程 FAIL 是否仍成立、M2 冻结、永久角色/同一 agent 多角色；复核：条件 2 的两处文档 diff、R0 §11、条件 1/3/4/5/6 关闭记录 |
| 审计立场 | 只采信可重跑输出、已提交 git 历史、代码本身；Verifier 报告只作为待核证据，不直接采信结论 |
| 只读边界 | 未运行 `pnpm verify`、`pnpm report:world`、`pnpm baseline:accept`；未读取/打印 `.env`；未提交 git；只写本文件 |

> **结论先行（复核后）**
>
> - 技术：**PASS**。B-1 在门禁层真正关闭：expected 是只读锚、普通 `check` 不改写它、测试数来自实际输出、门 id 集合相等、CI 步骤覆盖、文档主体同步。核心测试数由本审计独立重跑；B2/B3 数值、哈希、门集合与源码指纹由本审计独立读取/重算核对。此处的 PASS 指“门禁机制与核心断言成立”；CI runner 执行、YAML 解析等属未验证项，不构成技术失败；其中 U1–U4 已由 Coordinator 显式接受为残留（R0 §8）。
> - 流程：**PASS**。Implementer/Verifier/Auditor 的角色分离在记录与行为上成立；Verifier 的独立验证是实质性工作而非重跑换皮；Document Manager 的写入范围偏差已由设计所有者追认为事实同步，并已补登记（R0 §8:104、§11）；R0 角色状态/Implementer 交接替代记录已补。未再发现影响准入的流程问题。
> - 准入：**admitted**。条件 1–6 均已关闭或显式接受；条件 2 的两处文档 diff 经本审计复核为事实同步，`reports/README.md` 的 194 测试/报告说明与 `demos/world/DESIGN.md` 的模块职责表均与代码/实测一致，不改变设计结论。剩余仅为 Coordinator 对任务卡 §9 与 `docs/README.md` 索引的文字同步（记录动作，不是准入条件）、M-11 的文档措辞 nit，以及 M6 前补跑 CI 的远期义务。
>
> **复核记录（2026-11-16，HEAD `964e89c`）**：核对 `f4d39c7`（条件 1/3/4/5/6 的登记、角色状态、交接替代、索引）与 `964e89c`（设计所有者追认写入 R0 §11 / DOC-R0 §7–8）；核对两处文档 diff 与代码事实。除 §6.3 M-11 的措辞 nit 外，未发现新问题。

---

## 1. 方法与只读边界

**使用的手段**

- `git`：`rev-parse`、`log --format`、`show --stat`、`show <commit> -- <path>`、`diff --name-only`、`ls-files`、`hash-object`、`check-ignore`。
- 读文件：任务卡、决策、过程规范、审计/验证报告、`scripts/**`、`package.json`、CI、基线文件、产品侧残留文字。
- 条件 2 复核额外读取：`git show f4d39c7/964e89c`、`docs/tasks/R0.md` §8/§11、`docs/tasks/DOC-R0.md` §7–8、`reports/README.md`、`demos/world/DESIGN.md`，并对照 `src/kernel/` 文件清单与 `demos/world/src/world/world.ts:341-342` 的 append/apply。
- 重跑允许的只读检查：`pnpm test:all`（只跑测试）、`pnpm check:baseline`（只读对照；它会在通过时重写 tracked 的 `reports/baseline.json`/`baseline.md`，本审计实测两次写出的字节哈希完全不变，见 E4）。
- 直接 import 只读导出函数：`sourceFingerprint()`、`reportFingerprints()`；只读报告 JSON 与 expected JSON。

**明确未运行**

- `pnpm verify`：会写 `reports/baseline.json`/`baseline.md` 与 gitignored 报告/印记；按任务约束不运行。
- `pnpm report:world`：会写 gitignored 报告与印记；按任务约束不运行。
- `pnpm baseline:accept`：会改写 tracked 的 `reports/baseline.expected.json`；按任务约束不运行。
- 任何篡改 tracked 文件的负向探针：本审计不修改产品代码/脚本/测试；Verifier 的负向探针只做代码复核 + 其报告记录，未由本审计在临时副本重做（见 §8）。

**环境**：Node `v24.18.0`；pnpm `12.21.0`；git `2.48.1.windows.1`；Windows。审计开始时 `git status --short` 为空；本次更新只改本审计文件，未动其他文件。

---

## 2. 证据表

| # | 检查项 | 命令 / 文件 | 结果 |
|---|---|---|---|
| E1 | 当前 HEAD / 工作区 | `git rev-parse HEAD`；`git status --short` | 初始审查 `a6acc91`；复核 HEAD `964e89c`；工作区干净（本次复核更新前） |
| E2 | R0 提交范围 | `git log --format='%h|%an|%ad|%s'` | `7b42868` → … → `a6acc91` → `f4d39c7` → `964e89c`；全部作者 `Makoto-LeMalin <y0601kimo@sjtu.edu.cn>`，时间 01:47:57–02:23:09 |
| E3 | 测试数实测 | `pnpm test:all` | exit 0；embodied 100 / world 67 / kernel 27；`total=194`；skip 0 / todo 0 / fail 0 |
| E4 | 基线门实测 | `pnpm check:baseline` | exit 0；`测试 194 通过 / 194 期望；skipped 0；todo 0；B2 门 12/12；B3 门 13/13`；`报告新鲜度：ok`；expected SHA256 `BE9392DD…534893` 前后不变；`baseline.json` `5C2897F8…06817B`、`baseline.md` `06FD2167…182174` 前后不变；`git status` 空 |
| E5 | expected 是否被普通命令改写 | `git log --oneline -- reports/baseline.expected.json`；`git hash-object` vs `git rev-parse HEAD:…` | 只在 `7b42868` 创建；工作区 blob `f5203f06…` 与 HEAD blob 相同 |
| E6 | 测试数是否硬编码 | `grep -n '\b(100\|167\|194\|67\|27)\b' scripts/**` | 无命中；`scripts/baseline.mjs` 由 `runSuites()` 实测解析，见 E7 |
| E7 | 测试解析逻辑 | 读 `scripts/lib/test-suites.mjs:37-53,63-139`；`scripts/baseline.mjs:255-322` | 解析 `ℹ tests/pass/fail/skipped/todo/cancelled`；`pass !== tests`、`skipped/todo/cancelled != 0` 均记 failure；解析失败抛错，不当 0 |
| E8 | 门 id 集合 | 读 `scripts/baseline.mjs:218-252`；读报告 JSON 与 expected | B2 12 个、B3 13 个；与 `expectedGateIds` **集合相等 = true**；代码另查重复、缺门、多门、失败门、门数 |
| E9 | B2/B3 数值 | 读 `reports/world-validation.json`、`reports/world-b3-validation.json` | B2：668；`{ambient:33,actor:504,special:3,system:128}`；`fb6cb1e3`；`8b77f4ae`；12 门全 PASS。B3：760；`{31,595,1,133}`；`hashA=hashB=46c85469`；identical=true；misses 0；13 门全 PASS |
| E10 | 源码指纹与报告印记 | `node` 直接 import `scripts/lib/report-stamp.mjs` | stamp `sourceHash=4e9bec22da4220e1…`，`sourceFiles=65`；当前重算相同；`reports.b2=16256eb9…`、`b3=fe0f6819…`；当前报告哈希与 stamp 相同 |
| E11 | CI 内容 | 读 `.github/workflows/ci.yml:31-56` | 12 步：checkout、Node 24、pnpm 10、`install --frozen-lockfile`、typecheck、check:imports、test:all、check:secrets、`report:world`、check:baseline、`git diff --exit-code -- reports/baseline.expected.json`、`git diff --exit-code -- reports/baseline.json reports/baseline.md` |
| E12 | CI 是否在 runner 执行 | 无远端运行记录；R0 §8:103 | **未验证**；Coordinator 于 2026-11-16 显式接受 U1–U4 为残留，M6 前远端补跑（条件 4 关闭） |
| E13 | 文档同步（D-1..D-5） | 读 `docs/DEVELOPMENT_PLAN.md:8,129`；`reports/README.md:15`；`demos/world/README.md`；`demos/world/DESIGN.md`；`demos/embodied/README.md:112` | D-1..D-5 主体已修；“字节一致”在 `DEVELOPMENT_PLAN.md:129` 已降级为“32 位内容哈希一致 + 事件数/来源一致”；D-1 头部列出 100/67/27（未单列总数 194，见 M-1） |
| E14 | EventStore 现状 | `docs/DEPENDENCIES.md:71`；`docs/M1.md:106`；`test/event-store.test.ts:45`；`demos/world/src/world/world.ts:96-100` | 文档明确“共享同一数组、写入隔离未强制”；测试仍断言 `world.events.all() === world.state.eventLog`；代码 `this.state.eventLog = events; this.events = new EventStore(events)` |
| E15 | 断链 | 全仓 Markdown 链接正则 `\]\([^)]*world-(b3-)?validation` | 无命中；相关路径已改为“运行 `pnpm report:world` 本地生成（gitignored）”的说明文字 |
| E16 | 产品侧残留文字 | `reports/world-validation.md:3`；`demos/world/src/run.ts:141,347`；`demos/world/src/b3-run.ts:315` | 生成报告头仍写裸 `node demos/world/src/cli.ts report`；WB-2 gate detail 仍写“字节级一致”；R0 §8 与 `a6acc91` 已登记为产品代码文字残留 |
| E17 | 32 位哈希 | `reports/baseline.expected.json`；`docs/verification/R0.md:545-546` | `projectionHash`/`fullHash`/`replayHash` 均为 8 hex；文档已降级；U6/U7 明确未验证字节级/抗碰撞 |
| E18 | 规格表门数 | `docs/DEMO_PLAN.md:244-253`；`reports/baseline.expected.json:21-34`；`docs/tasks/R0.md:102` | 规格表登记 WB-1..WB-10；expected 为 12（多 `A→B→A`、`PROV`）；R0 §8:102 已登记：12 = WB-1..WB-10 + `A→B→A` + `PROV`，DEMO_PLAN 10 门表是旧登记、不作门数权威（条件 1 关闭） |
| E19 | R0 角色矩阵/准入记录 | `docs/tasks/R0.md:33-40,106-119`；`f4d39c7` | 初始审查时三者均 `pending`；`f4d39c7` 已更新为 completed，并记录 Implementer 交接替代；§9 仍写 `auditor verdict: conditional` / `coordinator admission: pending auditor recheck`，是本审计复核前的状态 |
| E20 | R0 提交是否越界（产品代码） | `git diff --name-only 0c97f21 HEAD`；`git diff --name-only a6acc91 HEAD` | 无 `src/`、`engine/`、`harness/`、`llm/`、`test/`、`demos/*/src` 改动；`a6acc91..HEAD` 只有 `docs/README.md`、`docs/audits/R0-AUDIT.md`、`docs/tasks/R0.md`、`docs/tasks/DOC-R0.md` |
| E21 | Document Manager 改动路径 | `git show --stat affb779`；`git show 787261d:docs/tasks/R0.md` §4；`git show e69c17c`、`f4d39c7`、`964e89c` -- docs/tasks | `affb779` 改 11 文件，其中 `demos/embodied/README.md`、`demos/world/README.md`、`demos/world/DESIGN.md`、`reports/README.md` 超出 R0 §4 当时范围；`f4d39c7` 在 R0 §8:104 补全全部四个文件与 DESIGN 模块表；`964e89c` 在 R0 §11 记录设计所有者追认 |
| E22 | 密钥/跟踪 | `git ls-files --error-unmatch .env`；`git check-ignore -v`；`git ls-files` 计数 | `.env` 未被跟踪（exit 1）；`reports/*.jsonl`、`reports/world-*` 命中 `.gitignore`；tracked 文件 166 |
| E23 | 无硬编码字面量（补充） | `grep -n '\\b(100\|167\|194\|67\|27)\\b' scripts/**` | 无命中；expected 的 194 是锚，不属于脚本硬编码 |
| E24 | 文档索引 | `docs/README.md:19`；`f4d39c7` | R0 审计已入索引；索引文字仍写“流程 PASS（附条件）、准入 conditional”，需随本次 admitted 结论同步（记录动作） |
| E25 | 条件 1/3/4/5/6 关闭记录 | `git show --stat f4d39c7`；`docs/tasks/R0.md:102-104,135-144`；`docs/tasks/DOC-R0.md:53-78` | `f4d39c7` 4 文件、373 insertions：更新 R0 角色状态、§8 登记 B2 可追溯/CI 残留/DM 范围、§9 handoff 替代、DOC-R0 完成、docs/README 索引；条件 1/3/4/5/6 关闭 |
| E26 | 条件 2 追认记录 | `git show --stat 964e89c`；`docs/tasks/R0.md:104,135-144`；`docs/tasks/DOC-R0.md:61,78` | `964e89c` 2 文件：§11 条件 2 标 closed，记录设计所有者 2026-11-16 追认 `reports/README.md` 与 DESIGN 模块表为事实同步；DOC-R0 同步；“待 Auditor 复核”由本报告关闭 |
| E27 | 条件 2 两处文档事实核对 | `reports/README.md:15,26`；`demos/world/DESIGN.md:73-76`；`src/kernel/*`；`demos/world/src/world/world.ts:341-342` | `reports/README.md` 194 测试/期望锚与实测一致；DESIGN 模块表“`src/kernel/` 共享 / `world/` 事件追加与投影”与代码一致（`src/kernel` 无 eventLog；`emit` 为 `events.append` + `apply`）；不改变设计结论 |

---

## 3. 技术审计

### 3.1 B-1 是否真正关闭（逐项对 `docs/tasks/R0.md` §5）

| R0 §5 | 项 | 审计判定 | 依据 |
|---|---|---|---|
| 1 | 期望基线是只读锚；普通 `verify`/`check` 不改写；只有显式接受才更新 | **关闭** | `scripts/baseline.mjs:537` 是唯一写 `EXPECTED_PATH` 的语句，只在 `--accept` 分支；`main()` 的 check 路径（`:470-601`）只写 `OUT_JSON`/`OUT_MD`；`freshnessErrors()` 在读写前先跑（`:488`）；实测 expected blob 未变（E4/E5）；历史只在 `7b42868` 创建（E5） |
| 2 | 测试数来自实际输出，不是字面量 | **关闭** | `actualFromReports()` 调 `runSuites()` 并解析 `ℹ tests/pass/fail/skipped/todo/cancelled`（`scripts/lib/test-suites.mjs:37-53,63-139`；`scripts/baseline.mjs:255-322`）；`grep` 无计数常量（E6）；实测 total=194（E3） |
| 3 | 门 id 集合相等；缺/多/改名/重复/失败即红；显示“通过/期望” | **关闭** | `gateErrors()` 做集合相等、重复、缺门、多门、门数、失败门（`scripts/baseline.mjs:218-252`）；expected 显式 12/13（`reports/baseline.expected.json:21-34,56-70`）；实测集合相等 true（E8）；`reports/baseline.md:19,30` 写“12 通过 / 12 期望”“13 通过 / 13 期望” |
| 4 | CI 或等价自动门覆盖核心检查 | **存在且顺序合理；runner 执行未验证** | `.github/workflows/ci.yml:31-56` 覆盖 typecheck、check:imports、test:all、check:secrets、report:world、check:baseline、两条 `git diff --exit-code`；本机未在 runner 执行，YAML 解析器未运行（U2） |
| 5 | 文档：字节一致降级、EventStore 现状、5 处漂移、断链 | **关闭（有 2 个文档 nit）** | `docs/DEVELOPMENT_PLAN.md:129` 已降级；`docs/DEPENDENCIES.md:71`/`docs/M1.md:106` 写明共享数组；D-1..D-5 主体已修（D-1 总数未单列，M-1）；Markdown 断链无命中（E13/E15）；B2 12 vs 10 已在 R0 §8:102 登记（条件 1 关闭）；`reports/README.md:26` 措辞绝对化（M-11） |

**结论：B-1 关闭，不是“把基线命令换个名字”。** 关键变化是：期望值从“命令自己写”变成“tracked 的 expected + 只读对照”；测试数从常量变成实际输出；门从 `${n}/${n}` 变成显式 expected 集合；CI 从不存在变成显式步骤。这些都能在代码/提交/实测输出中复核。

### 3.2 抽查的脚本逻辑（不只信报告）

**A. `gateErrors()`（`scripts/baseline.mjs:218-252`）**

阅读判断：

- `expectedIds` 空或非数组 → 直接报错（`:220-223`）。
- 期望自身重复 → 报错（`:224-226`）。
- 实际 `gates` 非数组 → 报错（`:227-230`）。
- 实际门 id 去重 + 重复报错（`:232-237`）。
- `missing = expectedIds 不在 actualSet`、`unexpected = actualIds 不在 expectedSet`；再比较 `actualIds.length !== expectedIds.length`（`:238-245`）。
- 任何 `gate.pass !== true` → 失败门（`:247-248`）。

这不是同义反复：缺门、多门、改名、重复、失败门分别有独立错误路径。**局限**：它信任 `pass` 布尔值，不校验门内部逻辑是否真的在检查其宣称的东西；这正是 Verifier U9 的未验证项，也是 M2 前应补的反向探针（§8）。

**B. `runSuites()` / `actualFromReports()`（`scripts/lib/test-suites.mjs:37-139`；`scripts/baseline.mjs:255-322`）**

阅读判断：

- 三个 suite 的入口与 `pnpm test:all` 相同（`SUITES` 常量，`:20-24`）。
- 用临时文件接收 stdout/stderr，避免管道限制；解析 ANSI 清除后的输出（`:26-53`）。
- `requirePass` 默认 true：进程退出码非 0、`fail != 0`、`skipped/todo/cancelled != 0`、`pass != tests` 都记 failure（`:121-130`）。
- `actualFromReports()` 在 `tests.ok` 为 false 时抛“测试未通过，不能计算基线”（`:256-259`）；`testSum` 与 `tests.total` 在 check 与 accept 两条路径都做一致性校验（`:270-273,521-525,573-575`）。
- 我实测 `pnpm test:all` 输出 100/67/27，`test:all ok` 与 expected 一致（E3）。

**C. `freshnessErrors()` / `sourceFingerprint()`（`scripts/lib/report-stamp.mjs:27-34,56-72,118-149`）**

阅读判断：

- 指纹覆盖 `src`、`engine`、`harness`、`llm`、`demos/world/src`、`demos/world/fixtures` 六个目录；相对路径统一 `/`，内容 + NUL 分隔，SHA-256。
- 校验顺序：印记存在 → `schemaVersion` → `sourceHash` → 两份报告存在且哈希一致。
- 我重算 `sourceHash=4e9bec22da4220e1…`、`sourceFiles=65`，与 stamp 一致；两份报告哈希也一致（E10）。
- **局限**：`scripts/`、`package.json`、`.github/`、Node/OS 不在指纹内；`writeStamp()` 是导出的普通函数，印记是本地 gitignored 文件，无签名/HMAC → 可被蓄意伪造。Verifier G3/§10.6 已实测并登记；本审计确认这是“防误不防蓄意”的设计边界，不是未声明漏洞。

**D. `main()` 的 check 与 accept 写路径（`scripts/baseline.mjs:470-601`）**

阅读判断：

- 两种模式都先 `freshnessErrors()`；不新鲜直接 exit 1（`:488-496`）。
- `--accept` 才写 expected（`:537`）；写前检查门失败/重复/空门、测试合计、生成文件的 schema（`:500-535`）。
- check 路径读 expected、做 schema/value/gate/cassette 对照；只有全部通过才 `writeReports()`（`:565-600`），失败不写 `baseline.json/md`（`:581-586`）。
- 实测 check 后 expected 哈希不变、baseline 两文件字节不变（E4）；与代码阅读一致。

### 3.3 关键残留：是否被正确降级/登记

| 残留 | 现状/证据 | 登记位置 | 审计判定 |
|---|---|---|---|
| stamp 可伪造（防误不防蓄意） | `writeStamp()` 导出；G3 实测可刷新 sourceHash 让陈旧报告通过 | Verifier §10.6.1、§10.11 条件 1 | **已正确登记**；接受为威胁模型边界；若要防伪造需签名或把 sourceHash 放进 tracked 锚 |
| 指纹未覆盖 `scripts/`、`package.json`、`.github/`、Node/OS | `SOURCE_DIRS` 仅 6 个源码/夹具目录 | §10.6.2、§10.8.2、§10.11 条件 2 | **已正确登记**；M2 若依赖“门自身不可被改”需补 tracked 锚 |
| CI 未在 runner 验证 | 无远端日志；YAML 仅文本阅读 | Verifier U1–U4；R0 §8:103 | **已登记并显式接受为残留**（条件 4 关闭）；M6 前远端补跑 |
| 生成报告头仍写裸 CLI | `reports/world-validation.md:3`；源头 `demos/world/src/run.ts:347`、`b3-run.ts:315` | R0 §8（`a6acc91` 追加）、Verifier D2 | **已登记**；属产品代码文字，R0 不改 |
| 32 位 hash | `fb6cb1e3`/`8b77f4ae`/`46c85469` 均 8 hex | `DEVELOPMENT_PLAN.md:129` 降级；Verifier U6/U7 | **已正确降级/登记**；仍不能声称字节级一致 |
| EventStore 与 `state.eventLog` 共享数组 | `world.ts:96-100`；`test/event-store.test.ts:45` 引用相等断言 | `DEPENDENCIES.md:71`、`M1.md:106` | **已正确登记**；M2 若依赖隔离须先改测试/实现 |
| B2 门数 12 vs 规格表 10 | `DEMO_PLAN.md:244-253` 只登记 WB-1..WB-10；expected 为 12（含 `A→B→A`、`PROV`） | R0 §8:102 已登记：12 = WB-1..WB-10 + `A→B→A` + `PROV`，10 门表是旧登记；Verifier §3.3 说明组成 | **已登记/条件 1 关闭**；不再作为准入阻断 |
| 本地 `verify` 不检查 worktree | H1：改生成器文案后 `verify` exit 0 但树脏；CI `git diff` 会红 | R0 §10.4 第 5 项、`baseline.mjs:596-598` 输出 note | **已登记**；接受为“本地绿 ≠ CI 绿”，M2 前可加 `verify:strict` |
| `--accept` 可接受当前代码结果（含源码改动后的重生成） | A4 实测：wrapper 先 `report:world` 再接受；expected 变，打印 diff | §10.4“语义”、§10.11 条件 1 | **已登记**；是显式逃生门，安全性依赖 tracked expected + 人工看 diff |
| 空白检出单跑 `check:baseline` 必红 | R2-C0；`pnpm verify` 因自带 `report:world` 可自举 | §10.6 末段、§10.11 条件 4 | **已登记**；不影响 verify/CI |
| `cancelled`/符号链接目录/缺目录分支 | 未触发；代码默认/跳过 | Verifier U11、§10.8.3/4 | **已登记为未验证**；见 §8 |
| 门内部逻辑正确性（WB-2/B3-REPLAY 反向探针） | R0 只锁门 id 集合与 `pass` | Verifier U9、§8.5 | **已登记为未验证/超出 R0**；M2 前应补 |

### 3.4 门本身是否可能“自证”

- **expected 与 report 同源**：`--accept` 用当次报告生成 expected（`expectedFromActual()`，`scripts/baseline.mjs:324-362`）。因此 expected 不是独立 oracle，而是“被人工显式接受过的历史快照”。作为回归门这是正确的；它能抓“变化”，不能证明“当前结果绝对正确”。
- **`--accept` 语义**：只有显式 `--accept` 才写 expected；wrapper `pnpm baseline:accept` 会先 `report:world` 再接受。它不阻止“源码改了 → 重生成 → 接受 → 提交”，但 expected 是 tracked 文件，diff 必须人工看；CI 另有 `git diff --exit-code -- reports/baseline.expected.json`（但该 diff 是工作区 vs 索引，提交内的 expected 变更仍需评审）。这是已登记的安全边界。
- **报告新鲜度**：`freshnessErrors()` 把“源码/夹具指纹 + 报告内容哈希”作为 `check:baseline` 的前置硬门；实测 fingerprint/report hash 均匹配（E10）。它不能防伪造，但能防“忘了重生成报告”的假绿（P12/F1 已实测）。
- **空白检出**：`pnpm verify` 顺序含 `report:world`，所以空白 clone 可自举；单跑 `check:baseline` 会明确报“缺少报告印记/报告文件”。这是 by design，已登记。
- **剩余自证向量**：如果同一次提交同时改代码、重生成报告、`--accept` 新 expected，门会绿；只有人工看 tracked diff 能发现。任何基线门都有这个上限，不是 R0 未关闭的缺陷，但必须在 M2 评审中作为“expected diff 必须看”的纪律。
- **本地 verify 可改写 generated baseline**：如果只改生成器文案（行为值不变），`check` 会通过并重写 `reports/baseline.md`，本地 `verify` exit 0 但树脏；CI 两条 `git diff` 会红。Verifier P17/H1 已实测，R0 §10.4 已接受。**结论：没有发现未登记的自证闭环；已登记的上限都是可接受的回归门边界。**

---

## 4. 对 Verifier 报告的评价

### 4.1 可信的结论（有证据支撑）

- **B-1 关闭的判定可信**：expected 只读、测试数实际解析、门集合相等、CI 步骤、5 处漂移修复，均有代码 + 命令 + 输出对应；本审计独立重跑了 194，并读取/核对 668/760、三个 hash、12/13 门、`sourceHash=4e9bec22…`/65 文件（E3/E4/E8/E9/E10）。
- **测试有效性评估不是“重跑一次”**：§4 有 skip、schema、stale report、worktree、`--accept` 五个边界；§5 有分支/边界覆盖矩阵；§6 有 N1–N4、P1–P20、S1a–c、E1–E16、A1–A6、F1–F10、G1–G3、H1/H3 的负向探针；§10 是 Round 2 独立重跑。它发现了实现者未发现/未修的缺口（`test.skip`、schema、陈旧报告），随后实现者修复、Verifier 再验证——这是实质性独立验证，不是自审换皮。
- **残留登记基本诚实**：stamp 可伪造、指纹不含门槛文件/Node/OS、CI 未在 runner、32 位 hash、EventStore 共享数组、门内部逻辑未验证，都写了“未验证/边界”，没有用“应该/理论上”掩盖。

### 4.2 证据不足或未验证（Verifier 已自认，本审计确认）

- CI 在 GitHub runner 上跑通、YAML 语法、`pnpm@10` 与 `lockfileVersion 9.0`/Node 24 兼容、registry 引导（U1–U4）。
- Windows/Linux 报告逐字节一致（U10）；32 位哈希抗碰撞（U7）；事件日志字节级一致（U6）。
- `cancelled` 分支、`sourceFingerprint` 缺目录/符号链接分支（U11）。
- 门内部逻辑（WB-2/B3-REPLAY 反向探针、WB-9 主观评审）未做（U9）。

### 4.3 漏项/应补（其中 1–3 已在后续提交补齐）

1. **B2 12 vs 规格表 10 未作为“待登记残留”处理**：Verifier §3.3 说明了 12 = WB-1..WB-10 + `A→B→A` + `PROV`，但没有指出这与 `docs/DEMO_PLAN.md:244-253` 的 10 门登记表不一致，也没有要求登记到 R0 §8/DOC-R0。本审计列为 I-1；**已在 `f4d39c7` 的 R0 §8:102 登记，条件 1 关闭**。
2. **Document Manager 偏差清单不完整**：Verifier F3 只列了 `demos/*/README.md`、`demos/world/DESIGN.md`；实际 `affb779` 还改了 `reports/README.md`，且 `demos/world/DESIGN.md` 的模块职责表被改（不只是目录树）。Verifier 把它归为“任务卡缺陷”，但没有指出登记遗漏与设计文档内容变更。**已在 `f4d39c7` §8:104 补全，`964e89c` §11 记录设计所有者追认；条件 2 关闭**。
3. **R0 记录层未核**：Verifier 合理地把“角色矩阵/准入”留给 Auditor，但它没有指出 R0 §3 仍写 `pending/待分派`、§9 `auditor verdict: pending`、没有 Implementer 交接文档；这些是流程审计的输入缺口。**`f4d39c7` 已更新 §3 状态并记录交接替代；条件 3 关闭**。
4. **D-1 未完全闭环的小项**：`docs/DEVELOPMENT_PLAN.md:8` 仍只列 100/67/27，没有单列总数 194；不影响正确性，但审计 D-1 的“应含 194”没有逐字满足。
5. **CI YAML 语法**：Verifier 自认 U2；本审计也没有 YAML 解析器可用，只能文本阅读。

### 4.4 总评

Verifier 报告是**本仓库目前最强的一份证据文档**：环境、commit、退出码、原始错误、负向探针、覆盖矩阵、未验证项齐全；其“验证通过（有条件）”对**门禁机制**成立。但它是验证报告，不是准入结论；也不能反过来证明 M0/M1 的流程有效。其最大遗漏是 B2 门数与规格表的可追溯性、以及 Document Manager 越权范围的完整性；这两项已分别由 `f4d39c7`（R0 §8:102/104）与 `964e89c`（R0 §11）补齐，条件 1/2 关闭。

---

## 5. 流程审计

### 5.1 R0 的 Implementer / Verifier / Auditor 是否不同 agent

- 任务卡角色矩阵把三者列为不同列：`r0-implementer`、`r0-verifier`、`r0-auditor`（`docs/tasks/R0.md:38-40`），规则明确“必须是三个不同 agent”（`:44`）。
- Verifier 报告声明“独立会话；未参与 R0 设计/实现，不与 Implementer 同一 agent”（`docs/verification/R0.md:5`），并记录了干净副本、负向探针、未改产品代码（§1.3、§9.4）。报告在 `e69c17c` 由后续文档提交入库，不是 Verifier 自行提交，符合“Verifier 不改产品代码/不自行准入”的分工。
- 本审计 `r0-auditor` 是独立委派的只读会话，未参与 R0 设计/实现/测试；只写了本文件。
- **证据边界**：所有 R0 提交的 git 作者都是 `Makoto-LeMalin <y0601kimo@sjtu.edu.cn>`，这是机器/用户身份，不是 agent 身份；git 历史本身**不能**证明会话分离。角色分离目前是“任务卡 + 报告声明 + 委派结构”的** attestation**，不是可密码学验证的事实。**未发现同一 agent 多角色的新证据**，但也没有独立于 agent 自述的硬证据。此点列入 §8 未验证。

**判定：角色分离在记录与行为上成立；不构成 M0/M1 式自审。** `f4d39c7` 已把 R0 §3 的三个角色从 `pending` 更新为 `completed`，并记录 Implementer 交接替代（提交 + Verifier 报告）；§9 仍写 `conditional`/`pending auditor recheck`，那是本审计复核前的状态，Coordinator 在本报告后同步。未发现同一 agent 多角色的新证据。

### 5.2 Document Manager 是否越权（复核后：条件 2 关闭）

**事实**：`affb779`（01:50:28）修改了 11 个文件，其中以下 4 个不在 R0 §4 的 Document Manager 允许范围（`docs/`、根 `README.md`、`.gitignore`）：

| 文件 | R0 §4 是否允许 | 备注 |
|---|---|---|
| `demos/embodied/README.md` | 否 | D-5 要求改，但未列入任何角色写范围 |
| `demos/world/README.md` | 否 | D-3 要求改，但未列入任何角色写范围 |
| `demos/world/DESIGN.md` | 否 | D-4 要求改；实际还改了模块职责表（`:73-76`），不只是目录树 |
| `reports/README.md` | 否 | D-2 要求改，但未列入任何角色写范围 |

**登记与追认（复核后）**：

- `e69c17c` 最初只登记了 `demos/*/README.md`、`demos/world/DESIGN.md`，遗漏 `reports/README.md`；`f4d39c7` 在 R0 §8:104 补全了四个文件与 DESIGN 模块职责表，并说明均为事实同步（删除的 kernel 目录、194 测试、测试数）。
- `964e89c` 在 R0 §11 条件 2 记录：设计所有者（用户）2026-11-16 追认 `reports/README.md` 的 194 测试/报告说明、`demos/world/DESIGN.md` 模块职责表只同步已删除的 kernel 目录与事件追加/投影归属，不改变设计结论；DOC-R0 §7–8 同步。
- **Auditor 事实核对（不是只读追认文字）**：
  - `reports/README.md:15` 的“194 测试、期望锚在 baseline.expected.json、对照通过后生成”与 `pnpm test:all` 实测 194、`reports/baseline.expected.json`、`scripts/baseline.mjs` 的 check 行为一致（E3/E4/E5）。
  - `demos/world/DESIGN.md:73-76` 的模块表：`src/kernel/` 文件清单只有 canonical-json/clock/ids/rng/snapshot，**没有 eventLog/EventStore**；`world/` 的“事件追加与投影”对应 `demos/world/src/world/world.ts:341-342` 的 `this.events.append(event)` + `this.apply(event)`。表与代码一致。
  - 两处 diff 只是文档事实同步，没有改代码、测试、验收门；`affb779` 的 11 文件里也没有产品代码（E20/E21）。
  - 另外两个 demo README（`demos/embodied/README.md`、`demos/world/README.md`）只改共享代码指向与目录树，属 R0 §5.5 D-3/D-5 的事实同步，不涉及设计结论；R0 §8:104 一并登记。
- **追认本身**是设计所有者权限内的决定；仓库能证明的是 §11 的记录与内容事实一致，原始会话消息不在仓库内（见 §8 U-18）。

**判定**：

- 这是**写入范围/角色边界偏差**，不是“同一 agent 多角色”（DM 没有做设计/实现/测试/审计），也不是自审。偏差已补登记、已由设计所有者追认、内容经 Auditor 核对为事实同步。
- **条件 2 关闭。** 该偏差不影响 R0 的角色分离与独立验证，也不再阻断准入。
- **M-11（新，nit）**：`reports/README.md:26` “裸 `node ... report` 不写新鲜度印记，`check:baseline` 会拒绝”是绝对化表述；在已有有效 stamp 且报告内容未变时，裸 CLI 重生成同字节报告后 `check:baseline` 仍可能通过。建议改为“在没有有效印记/新检出时会拒绝”。这是措辞 nit，不影响条件 2 的事实同步，也不阻断准入。

### 5.3 M0/M1 的流程 FAIL 是否仍然成立

**成立。** `AGENTS.md:63-68`、`docs/PROCESS.md:170-178`、`docs/DECISIONS.md:62-66` 仍记录 M0/M1 流程 FAIL（同一 agent 自审）；M0-M1 审计 §3.1 B-2、§4 第 9 项的结论没有被撤销。R0 的独立验证是**当前状态**的独立复核，不是对 M0/M1 历史提交的重新评审；它不能追溯地把 M0/M1 改成 PASS。

**R0 是否真的补上独立验证，而不是自审换皮**：是实质性的。证据：

1. Verifier 在干净副本重跑（`docs/verification/R0.md` §1.3；clone 失败时用逐字节复制 + `.git` + `core.autocrlf=false`，记录失败路径），不是“实现者说跑过”。
2. 它发现了实现者未关闭的 5 个缺口（skip/schema/accept 陈旧/新鲜度/worktree），并把 1–3 交回实现者修复；Round 2 再独立复跑（§10.4）。一个自审换皮不会主动制造并公开这些不利探针。
3. 本审计独立重跑了测试数，并核对报告数值/哈希/门集合/指纹（E3–E10），与 Verifier 一致；未发现伪造或口径漂移。
4. Verifier 报告明确区分“实测”与“阅读判断”，并列出 U1–U11 未验证项。

**边界**：R0 的独立验证覆盖当前 HEAD，不覆盖 M0 提交时点的 167 测试运行（M0-M1 审计 U-2 仍成立）；因此 M0/M1 历史流程 FAIL 保留，R0 只提供“当前基线可独立复核”的前向证据。

### 5.4 M2 是否仍冻结；是否有未准入前开始 M2 的证据

- 文档仍写 M2 冻结：`docs/PROCESS.md:177`、`AGENTS.md:68`、`docs/DECISIONS.md:57`。
- `git diff --name-only 0c97f21 HEAD` 无 `src/`、`engine/`、`harness/`、`llm/`、`test/`、`demos/*/src` 改动（E20）；R0 提交只动 `scripts/`、`package.json`、`.github/`、`reports/`、docs/README/DESIGN。
- `docs/tasks/DESIGN-WC-01.md` 是设计任务（只写设计文档，明确“不写实现/代码/测试”），由 D-006 允许在 R0 并行；仓库中没有 M2 实现任务卡或 M2 代码。
- **结论：未发现 R0 未准入前开始 M2 的证据。** 设计工作与 R0 并行是已登记决策，不等于 M2 开工。

### 5.5 决策/任务卡是否把会话写成永久角色；是否有“同一 agent 多角色”新证据

- `D-002` 明确“会话不是仓库角色，分工由阶段任务卡记录”，并作废了原“本会话范围”写法（`docs/DECISIONS.md:17-23`）；任务卡用阶段角色名（`r0-implementer`/`r0-verifier`/`r0-auditor`），没有写永久所有权。
- `PROCESS.md:30-35` 允许 Coordinator 与 Document Manager 同会话（文档管理不属于设计/开发/测试/审计），这是规则允许的合并，不是多角色违规。
- 本审计未发现 R0 阶段“同一 agent 出现在两个角色列”的新证据。R0 §3 已由 `f4d39c7` 更新为 completed，并记录 Implementer 交接替代；§9 的 `conditional`/`pending auditor recheck` 是本审计复核前的状态，Coordinator 在本报告后可登记 `admitted`。这是**记录同步**，不是角色冲突。

### 5.6 流程结论

**PASS**：

- 角色分离与独立验证成立；Document Manager 偏差已补登记并由设计所有者追认为事实同步（条件 2 关闭）；R0 角色状态与 Implementer 交接已补（条件 3 关闭）；M0/M1 流程 FAIL 保留；M2 未启动；没有永久角色/多角色新证据。
- 剩余动作是记录同步：Coordinator 把 R0 §9 与 `docs/README.md:19` 从 conditional 更新为 admitted，并按 §8:103 在 M6 前补跑 CI。它们不改变本报告的准入结论。
- 未发现需要改判流程 FAIL 的新问题；§6.3 M-11 只是文档措辞 nit。

---

## 6. 发现汇总

### 6.1 阻断级

**无。** 未发现 B-1 仍可被普通 `verify`/`check` 自动改写、测试数硬编码、门集合恒等式、CI 缺失等阻断问题。

### 6.2 重要级（均已关闭/接受）

| # | 发现 | 状态 | 证据/处置 |
|---|---|---|---|
| I-1 | B2 门数 12 与 `DEMO_PLAN.md` 规格表 10 门不一致 | **closed** | R0 §8:102 已登记：12 = WB-1..WB-10 + `A→B→A` + `PROV`；10 门表是旧登记、不作门数权威 |
| I-2 | Document Manager 越权：4 个文件不在 R0 §4 写范围；原登记遗漏 `reports/README.md`，且 `demos/world/DESIGN.md` 模块职责表被改 | **closed** | `f4d39c7` §8:104 补全四个文件与 DESIGN 模块表；`964e89c` §11 记录设计所有者追认；本审计 E27 核对内容与代码一致；条件 2 关闭 |
| I-3 | R0 角色矩阵/准入记录/Implementer 交接滞后 | **closed（§9 verdict 待同步）** | `f4d39c7` 更新 §3 角色为 completed、§9 记录 Implementer 交接替代；§9 最终 verdict 待 Coordinator 随本报告同步 |
| I-4 | CI 未在 runner 执行；YAML/`pnpm@10`+lockfile 9.0/Node 24 兼容未验证 | **closed（接受残留）** | R0 §8:103：Coordinator 显式接受 U1–U4 为残留，M6 前远端补跑；条件 4 关闭 |

### 6.3 次要级

| # | 发现 | 证据 | 说明 |
|---|---|---|---|
| M-1 | D-1 头部未单列 194 | `docs/DEVELOPMENT_PLAN.md:8` | 不影响正确性；D-1 主体已修；可后续补 |
| M-2 | `package.json` 的 `baseline` 别名实际是 `--check`；`verify:ci` 只是 `pnpm verify`，本地不检查 worktree | `package.json:21-26`；Verifier F7 | 命名易误解；无功能错误 |
| M-3 | 本地 `pnpm verify` 在生成器文案变更时会改写 tracked `baseline.md/json` 且 exit 0 | Verifier H1/P17；`scripts/baseline.mjs:596-598` | 已登记；CI `git diff` 兜底；可加 `verify:strict` |
| M-4 | `--accept` 可接受当前代码的新结果（A4），安全性依赖人工看 expected diff | Verifier §10.4；`scripts/baseline.mjs:500-555` | 已登记；显式逃生门 |
| M-5 | stamp 可伪造、指纹不含门槛文件/Node/OS | Verifier G3/§10.6；`scripts/lib/report-stamp.mjs:27-34,85-94` | 已登记；“防误不防蓄意” |
| M-6 | 32 位 hash；事件日志无字节样本 | `reports/baseline.expected.json`；Verifier U6/U7 | 已降级为“内容哈希一致”；不得声称字节级 |
| M-7 | EventStore 与 `state.eventLog` 共享数组，测试锁定别名 | `world.ts:96-100`；`test/event-store.test.ts:45` | 已登记；M2 若依赖隔离先改 |
| M-8 | 生成报告头仍写裸 CLI；WB-2 detail 仍写“字节级一致” | `reports/world-validation.md:3`；`demos/world/src/run.ts:141,347`；`b3-run.ts:315` | 已登记为产品代码文字残留，不阻断 R0 |
| M-9 | `cancelled`、符号链接目录、缺目录指纹分支未触发 | Verifier U11；`report-stamp.mjs:58-63` | 已登记未验证；建议补测 |
| M-10 | 门内部逻辑（WB-2/B3-REPLAY 反向探针、WB-9 主观评审）未验证 | Verifier U9；M0-M1 审计 U-5 | 超出 R0 门禁范围；M2 前补 |
| M-11 | `reports/README.md:26` “裸 CLI … `check:baseline` 会拒绝”是绝对化表述；有有效 stamp 且报告同字节时裸 CLI 仍可能通过 | `reports/README.md:26`；`scripts/lib/report-stamp.mjs:118-149` | 新发现的措辞 nit；建议改为“没有有效印记/新检出时会拒绝”；不影响条件 2 与准入 |

---

## 7. 准入条件关闭复核与结论

原 §7 的 6 个条件已由后续提交关闭；本审计逐项核对：

| # | 条件 | 状态 | 证据 | 审计判定 |
|---|---|---|---|---|
| 1 | B2 12 vs 10 可追溯 | **closed** | R0 §8:102；E18 | 登记成立；10 门表标为旧登记，12 门锚显式可追溯 |
| 2 | Document Manager 越权追认 | **closed** | R0 §8:104、§11；`964e89c`；DOC-R0 §7–8；E21/E26/E27 | 设计所有者追认为事实同步；两处文档内容与代码/实测一致；条件关闭 |
| 3 | 角色状态 / 准入记录 / Implementer 交接 | **closed（§9 verdict 文字待同步）** | `f4d39c7` §3/§9；E19/E25 | 角色状态 completed；交接以提交 + Verifier 报告替代并记录理由；§9 最终 verdict 待 Coordinator 随本报告同步 |
| 4 | CI runner 证据或显式接受 | **closed（接受残留）** | R0 §8:103；E12 | Coordinator 显式接受 U1–U4；M6 前远端补跑 |
| 5 | DOC-R0 收尾 + 审计索引 | **closed（索引 verdict 文字待同步）** | DOC-R0 §7–8；`docs/README.md:19`；E24/E25 | DOC-R0 COMPLETED；R0 审计已入索引；索引 verdict 文字需随 admitted 同步 |
| 6 | M2 冻结 | **closed** | `git diff --name-only 0c97f21 HEAD`；E20 | 无 M2 代码/任务；M2 未启动 |

**准入结论：R0 admitted。**

理由：技术门禁 PASS（B-1 关闭、核心数字/哈希/门/指纹复核）；流程 PASS（角色分离、独立验证、DM 偏差追认、记录补齐）；条件 1–6 全部关闭或显式接受（其中 3/5 的最终 verdict 文字同步待 Coordinator）；M0/M1 历史流程 FAIL 保留，不影响 R0 自身准入；M2 是否启动仍由 D-006 与设计产物决定，R0 admitted 不自动解冻 M2。

**剩余记录/远期动作（不是准入条件）**：

1. Coordinator 收到本报告后，把 `docs/tasks/R0.md` §9 从 `conditional/pending auditor recheck` 更新为 `admitted`，并把 `docs/README.md:19` 的“流程 PASS（附条件）、准入 conditional”更新为 admitted。本审计只读，不能改任务卡/索引。
2. 按 R0 §8:103，M6 前在远端跑一次 CI 并记录 run URL/日志（U1–U4 目前是显式接受残留）。
3. M-11 的 `reports/README.md:26` 措辞可在下一次文档任务中修正；不影响本次准入。

---

## 8. 未验证项（明确“未验证”，不推测）

| # | 声明 | 状态 | 原因/边界 |
|---|---|---|---|
| U-1 | CI 在 GitHub runner 上跑通（含 `report:world`、`check:baseline`、两条 `git diff`） | **未验证；已接受为残留** | 本机无 runner/远端；R0 §8:103 显式接受，M6 前补跑 |
| U-2 | `ci.yml` 的 YAML 语法合法 | **未验证** | 本机无 PyYAML/`yq`/Ruby；只做了文本阅读；`ci.yml` 结构简单、步骤名与脚本存在，但未用解析器 |
| U-3 | runner 上 `pnpm@10` 与 `lockfileVersion 9.0`、Node 24 兼容；`pnpm install --frozen-lockfile` 可成功 | **未验证** | 需联网/runner；本机 pnpm 12.21.0 |
| U-4 | CI 引导阶段访问 npm registry（网络） | **未验证** | 未在隔离网络执行 `pnpm install` |
| U-5 | 真实 LLM 调用发生过（M0/M1 U-1 继承） | **未验证** | 只验证 cassette 回放（miss=0）；离线无法证明真实 API 调用 |
| U-6 | 同 seed 事件日志“字节级一致” | **未验证到字节级** | `reports/world-events.jsonl` gitignored；只有 32 位内容哈希 + 计数/来源一致 |
| U-7 | 32 位 hash 抗碰撞 | **未验证** | 8 hex=32 bit；未做碰撞实验 |
| U-8 | `.env` 是否存在/内容/有效性 | **未验证（按规则不读）** | 只确认 `.env` 未被 git 跟踪 |
| U-9 | B2/B3 各门内部逻辑是否真的检查其宣称的东西 | **未验证** | R0 门只锁 id 集合与 `pass`；WB-9 主观评审、WB-2/B3-REPLAY 反向探针未做 |
| U-10 | Windows 与 Linux 生成的报告逐字节一致（stamp 不含 OS/Node） | **未验证** | 本机 Windows 两次一致、TZ 无关（Verifier §4.3）；Linux 未跑 |
| U-11 | `cancelled` 分支、`sourceFingerprint` 缺目录/符号链接分支 | **未验证** | 未触发；仅有代码阅读 |
| U-12 | M0 提交时点的 167 测试是否由该提交代码实际跑出 | **未验证** | 无运行日志；不 checkout 历史（会改工作区） |
| U-13 | Verifier 的负向探针在临时副本中可原样复现 | **未验证（本审计未重做）** | 本审计只读，未复制工作区/篡改；依据代码阅读 + Verifier 记录 + 我的非篡改重跑 |
| U-14 | `pnpm verify` 端到端 | **未由本审计运行** | 会写 tracked baseline/报告；本审计分别跑了 `test:all`、`check:baseline`，其余步骤由代码/Verifier 证据支持 |
| U-15 | `pnpm baseline:accept` / `--accept` 的写 expected 行为 | **未由本审计运行** | 会改 tracked expected；代码阅读 + Verifier P10/P11/A1–A6 + `git log`（expected 只在 7b42868 创建） |
| U-16 | agent 会话身份（Implementer/Verifier/Auditor 确为不同会话） | **未验证（attestation）** | 所有提交同一 git 作者；任务卡/报告/委派为声明，git 无法区分会话 |
| U-17 | B2 12 门与规格表 10 的最终裁决 | **已登记（R0 §8:102）；不再阻断** | 12 门锚显式；10 门表标为旧登记；本审计不替设计会话改 DEMO_PLAN |
| U-18 | 设计所有者追认的原始会话消息 | **未验证（仓库仅有 §11 记录）** | Auditor 核对的是两处文档内容与代码事实；追认权限属于设计所有者，记录已入任务卡 |
| U-19 | R0 §9 与 `docs/README.md:19` 的 admitted 文字同步 | **待 Coordinator（本审计只读）** | 记录动作，不是准入条件；见 §7 剩余动作 1 |

---

## 9. 审计边界与收尾

- 本审计只读；唯一写入是 `docs/audits/R0-AUDIT.md`（本文件）；未修改产品代码、脚本、测试、设计文档、任务卡；未提交 git。
- 允许的 `pnpm check:baseline` 在通过时重写了 tracked `reports/baseline.json`/`baseline.md`，但前后 SHA256 完全相同、`git status` 为空；已在 §1/E4 记录，不属于未声明改动。
- 本报告不替代 Coordinator 的准入记录；本次复核结论为 **R0 admitted**，Coordinator 需按 §7 剩余动作 1 同步任务卡/索引文字。
- 本报告不追溯改变 M0/M1 的流程 FAIL；R0 的独立验证只对当前基线有效。
- 初始审查 HEAD `a6acc91`；本次复核 HEAD `964e89c`（含 `f4d39c7`）；`a6acc91..964e89c` 只有 docs 变更（E20）。

---

*审计人：`r0-auditor`；本报告为独立只读审计产出，不含设计/实现/测试结论。*
