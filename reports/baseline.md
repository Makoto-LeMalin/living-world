# 回归基线（P0/M1）

生成：`pnpm check:baseline`。
期望值来源：`reports/baseline.expected.json`（受版本控制；普通 `pnpm verify` 不会改写它，只有显式 `pnpm baseline:accept` 才能更新）。

## 测试（由实际测试输出解析，不硬编码）

- 具身：100 通过 / 100 期望
- 世界：67 通过 / 67 期望
- 共享内核：27 通过 / 27 期望
- 合计：194 通过 / 194 期望

## B2

- 事件：668（期望 668）
- 来源：{"ambient":33,"actor":504,"special":3,"system":128}
- projectionHash：`fb6cb1e3`
- fullHash：`8b77f4ae`
- 门：12 通过 / 12 期望（集合相等）

## B3

- 事件：760（期望 760）
- 来源：{"ambient":31,"actor":595,"special":1,"system":133}
- replayHash：`46c85469`；identical=true
- 晋升/降级：1/2
- 群体个体化/合并：1/1
- Director：4 次 / 7 提案
- 角色对话：14 次；LLM=14；cassette miss=0
- 门：13 通过 / 13 期望（集合相等）

## Cassette

- B3 完整：17 个
- 单点探针：2 个
- 均不含 key/headers；由 `pnpm check:secrets` 复查。
