# DOC-R0：R0 文档残留修正

| 项 | 内容 |
|---|---|
| 阶段 | DOC-R0（文档管理；不改变设计、代码、验收标准） |
| 状态 | COMPLETED（2026-11-16；残留产品代码文字另记） |
| 依据 | [R0 验证报告](../verification/R0.md) §3.5、§9.3；[M0/M1 审计](../audits/M0-M1-AUDIT.md) I-4 |
| 关系 | 与 [R0](R0.md) 并行；R0 的实现门禁另由 Implementer/Verifier/Auditor 负责 |

## 1. 目标

关闭 R0 验证报告指出的文档残留，不改设计、不改产品代码：

1. 去掉指向 gitignored 报告的所有断链；
2. 修正 R0 后仍写“167 全测”“verify + baseline”的 P0 历史句，标注时点；
3. 保持 M1 后的目录树/共享入口描述一致；
4. 明确门级报告的生成方式（本地 `report`，不入库）。

## 2. 非目标

- 不决定报告是否入库；
- 不修改 `scripts/`、`src/`、`demos/*/src/`；
- 不重写设计内容；
- 不替代 Auditor 的流程判定。

## 3. 角色矩阵

| 角色 | Agent / 会话 | 状态 |
|---|---|---|
| Coordinator | `coordinator`（可与 Document Manager 同会话） | assigned |
| Document Manager | `document-manager` | assigned |
| Designer / Implementer / Verifier / Auditor | 不参与 | N/A |

## 4. 允许写入

- `docs/**`
- `demos/*/README.md`
- `demos/world/DESIGN.md`
- `reports/README.md`

## 5. 验收标准

1. `Select-String` 不再命中指向 `reports/world-validation.*` / `world-b3-validation.*` 的 Markdown 链接；
2. P0 的 167 表述带“P0 时点”，或已改为 194；
3. `demos/world/{README,DESIGN}.md` 不再出现已删除的 `src/kernel/` 目录；
4. `demos/embodied/README.md` 的共享代码说明指向 `src/kernel/`；
5. 不改变任何设计结论或验收门。

## 6. 已知流程偏差（交 Auditor）

Document Manager 在 R0 的 §4 尚未列出 `demos/*/README.md`、`demos/world/DESIGN.md` 时，已修改过这些文件以修 I-4。该范围偏差不由本任务自动追认；请在 R0 审计中判定其是否影响阶段合规。本任务只处理**剩余**文档残留，并明确写入范围。

## 7. 准入记录

```
stage: DOC-R0
task: docs/tasks/DOC-R0.md
role matrix checked: yes
write scopes: docs/** demos/*/README.md demos/world/DESIGN.md reports/README.md
auditor verdict: covered by docs/audits/R0-AUDIT.md（文档项）
coordinator admission: completed（文档项）；设计文档所有者已于 2026-11-16 追认 §6 偏差为事实同步，待 Auditor 复核
date: 2026-11-16
```

## 8. 完成记录

已完成：

- `demos/world/DESIGN.md`、`demos/world/README.md`、`demos/embodied/README.md` 的 kernel/共享代码漂移已修；
- `docs/VALIDATION.md`、`docs/DEMO_PLAN.md` 的 gitignored 报告断链已改为“运行 `pnpm report:world` 本地生成”；
- `docs/DEVELOPMENT_PLAN.md` 的 P0 167 表述已标注时点，当前命令改为 `pnpm report:world`；
- `reports/README.md` 的 194 基线与报告生成说明已修；
- 全仓已无指向 `reports/world-validation.*` / `reports/world-b3-validation.*` 的 Markdown 链接。

残留（不在文档范围）：

- 生成报告头仍由 `demos/world/src/run.ts` / `b3-run.ts` 写裸 CLI；属产品代码文字，另任务。
- 设计文档所有者已于 2026-11-16 追认 `demos/world/DESIGN.md` 模块职责表与 `reports/README.md` 的修改为事实同步；待 R0 Auditor 复核。
