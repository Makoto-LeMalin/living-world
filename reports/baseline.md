# P0 基线

生成：`pnpm verify`。这是合并开发的回归基线；任何 M1+ 改动都必须先证明这里的数字没有非预期变化。

## 测试

- 具身：100
- 世界：67
- 共享内核：12
- 合计：179（由 `pnpm test:all` 验证）

## B2

- 事件：668 {"ambient":33,"actor":504,"special":3,"system":128}
- projectionHash：`fb6cb1e3`
- fullHash：`8b77f4ae`
- 门：12/12（全部通过）

## B3

- 事件：760 {"ambient":31,"actor":595,"special":1,"system":133}
- replayHash：`46c85469`；identical=true
- 晋升/降级：1/2
- 群体个体化/合并：1/1
- Director：4 次 / 7 提案
- 角色对话：14 次；LLM=14；cassette miss=0
- 门：13/13（全部通过）

## Cassette

- B3 完整：17 个
- 单点探针：2 个
- 均不含 key/headers；由 `pnpm check:secrets` 复查。
