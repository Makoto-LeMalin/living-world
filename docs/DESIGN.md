# Living World · 设计备忘（DESIGN）

> 本文是**实现参考，不是需求**。所有内容都可改；与 PRD 冲突时以 PRD 为准。
> 记录的是"目前打算怎么做"和"哪些是未验证的假设"，避免它污染需求层。
> 两个 demo 合并后的整体架构、契约与迁移路线见 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## 1. 分层与依赖

```
表现层   Web 面板 / 对话 UI / 通知           只读世界，不回写
心智层   Mind：目标、情绪、注意、提示词装配    只读感知，只产出 intent
语义层   LLM：意图编译 / 裁判 / 叙述 / NPC 措辞 只提案，不写状态
通信层   Channel / Notification              把世界事件变成感知与消息
模拟层   Scheduler：tick、日程、后台过程、事件队列
规则层   Resolver：合法性、判定、伤害、经济、传播
空间层   Space：区域 / 聚落 / 房间 / 可见可听
内核层   Kernel：实体、时钟、事件日志、种子 RNG
         Perception 横切：把内核状态过滤成"它能感知的"
```

依赖规则：Kernel/Space/Resolver/Scheduler 不依赖 LLM、不依赖宿主；Mind 只依赖 LLM 接口抽象；宿主适配器在最外层。

---

## 2. 四条契约

| 契约 | 方向 | 内容 |
|---|---|---|
| `Event` | 所有层 → 内核 | `{id, tick, actor, verb, target, delta, rng, source}`，不可变、可回放 |
| `Patch` | 规则层 → 内核 | 最小状态变更集，带校验与版本 |
| `Intent` | 心智层 → 规则层 | `{verb, target, instrument, manner, goal}`，**不含结果** |
| `Perception` | 内核 → 心智层 | `{self_body, location, visible[], audible[], remembered[]}`，带缺口与不确定 |

---

## 3. 世界生成

- 三层：World/Region（创建时一次）、Settlement（首次进入）、Site/Room（首次进入）。
- 静态拓扑由 `(seed, id)` 确定性生成，**生成即冻结**；动态痕迹（血迹/破损/尸体/字）独立存储，按实体 id 关联。
- 拓扑**不用 LLM 生成**；LLM 只做命名、风味、特例场景。
- 生成后校验不变量：房间可达、出口双向、食物 ≥ 人口×k、有法必有狱、势力连片、道路连通、NPC 日程覆盖 24h。
- Canon（历史/势力/禁忌/方言/技术上限）1–2 页，生成器与提示词共用。
- 细节梯度：角色所在细化到"点"，远方只保留标量与痕迹。

## 4. 时钟与预算（建议值，全部可配）

| 项 | 建议值 |
|---|---|
| 世界 tick | 10 世界分钟 |
| 真实 : 世界 | 1 分钟 ≈ 10 分钟 |
| 角色回合 | 事件驱动（不随 tick 强制） |
| 睡眠固化 | 每天 1–2 次 |
| LLM 调用 | < 30 次/天 |
| 主动消息 | ≤ 3 条/天，同类冷却 ≥ 6 世界小时 |
| 记忆注入 | ≤ 1200 字符/轮 |

---

## 5. 具身实现

**输出通道（硬性）**

```json
{ "thought": "…", "speech": "…", "action": {"verb": "", "target": "", "instrument": "", "manner": ""}, "attention": "…" }
```

`thought` → 私有记忆；`speech` → 同房间者；`action` → 裁决器。

**能力门控**

| 状态 | 限制 |
|---|---|
| fatigue > 0.7 | 禁 `pursue`，判定惩罚 |
| arm_left impaired | `attack` 惩罚、`craft` 不可用 |
| bound | 仅 `speak / observe` |
| concussion | 感知噪声、召回下降 |
| intoxicated | 温度↑、规划缩短、误判↑ |

**推理调制四档**（v0 只开前两档）：上下文降级、感知失真、采样调制（默认关）、侵入性感受。

**三个身体**：物理（代码）、现象（感知层）、社会（NPC 对伤口/衣着/名声的反应）。

---

## 6. 数据结构草案

```
Entity   { id, kind, loc, tags[], state{} }
Body     { hp, wounds[], hunger, fatigue, intoxication, status[] }
Region   { id, sites[], roads[], faction, economy{}, laws[] }
Site     { id, rooms[], entrances[], owner, schedule }
Room     { id, site, exits[], spots[], light, containers[] }
Trace    { id, tick, kind, anchor, permanence, witnesses[] }
Memory   { id, kind, tick, place, people[], text, salience, sourceEvent }
Persona  { version, anchors{}, axes{}, updatedAt, snapshotRef }
Channel  { id, kind, owner, location, durability, charge, secrecy, visibleToOthers, knownBy[] }
ChannelEvent { id, carrier, modality, percept, integrity, latency, exposure, sourceTheory, belief, tickArrived }
Message  { id, dir, tickSent, tickArrived, text, read, replyTo }   // 传输层，不进角色上下文
```

---

## 7. effect 词表草案（22）

`move, look, listen, speak, whisper, shout, take, give, use, craft, trade, attack, defend, threaten, deceive, persuade, hide, pursue, flee, rest, wait, tend`

**判定链示例：挑衅 → 斗殴 → 被捕**

1. `threaten(甲, public)`：威慑+地位 vs 甲的勇气+围观压力
2. 甲反击 `attack`：力量+技巧 vs 闪避+护甲
3. 治安过程 `law_response` 判定 `arrest`：罪行+目击者 vs 逃逸机会
4. 若逮捕：`status=bound`、`loc=拘留所`、`trace=血迹(永久, 目击3)`
5. 下一 tick 感知："手腕被麻绳勒着，左边有人吐了口唾沫。"

不可逆性分三级：可撤销 / 有代价 / 永久。

---

## 8. 宿主适配（以 DSH 为例，可替换）

- 一个 npm 包：`dsh.bundle.patch` + `engines.dsh: ">=0.2.0 <0.3.0"`；发布预构建产物（避免 git 安装的 `prepare` 授权门槛）。
- `persona.complete: true` 抹掉宿主身份；`includeRuntimeContext: false` 阻断现实泄漏。
- `ctx.tools.restrict()` 隐藏编码工具；只暴露 `act / speak / observe / remember`。
- `dsh-schedule` 驱动 tick；`agent.followup()` 做主动唤醒。
- 一个世界日 = 一个 session；世界状态与记忆放 SQLite，不进会话日志。
- 用户消息在 `agent/pre-step` 改写为 `ChannelEvent.percept`（原话逐字保留在引号内），禁止以 `user` 角色裸传。
- 禁止 append 自定义 session 事件类型（会导致会话无法打开）。
- 卸载后世界数据完整可读。

---

## 9. 未验证的实现假设

| # | 假设 | 如何验证 |
|---|---|---|
| A1 | 引擎与宿主解耦后仍能借用宿主的工具/调度 | 用两个最小适配器（DSH / 纯 Node CLI）跑同一引擎 |
| A2 | 规则驱动 90% + LLM 10% 足够维持"活着" | 24h 无人值守测试 |
| A3 | 通道分离能阻止"想的被听见" | 同房间 NPC 反应测试 |
| A4 | 身体门控比提示词更能稳定限制行为 | A/B：有门控 vs 仅提示词 |
| A5 | 误读/残缺不破坏可用性 | 用户测试（默认关，可开） |
