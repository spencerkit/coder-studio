# Worktrees

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- Git worktree 列表、创建、移除、状态、diff、tree。
- Worktree 管理 surface、详情面板、摘要卡。

不覆盖：
- 普通 Git branch 操作。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Worktree manager surface | Desktop | 查看和管理 worktree。 |
| Worktree detail panel | Desktop | 查看详情、状态和 diff。 |
| Worktree modal | Desktop | 创建或管理 worktree。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| WT-001 | worktree 列表 | Implemented | `worktree.list`、`worktree-manager-surface.tsx` | `packages/server/src/__tests__/worktree-commands.test.ts` |
| WT-002 | 创建 worktree | Implemented | `worktree.create`、`use-worktree-management-actions.ts` | `packages/server/src/__tests__/worktree-commands.test.ts` |
| WT-003 | 移除 worktree | Implemented | `worktree.remove` | `packages/server/src/__tests__/worktree-commands.test.ts` |
| WT-004 | worktree status | Implemented | `worktree.status`、`worktree-detail-panel.tsx` | `worktree-detail-panel.test.tsx` |
| WT-005 | worktree diff | Implemented | `worktree.diff` | `packages/server/src/__tests__/worktree-commands.test.ts` |
| WT-006 | worktree tree | Implemented | `worktree.tree` | `packages/server/src/__tests__/worktree-commands.test.ts` |
| WT-007 | worktree summary card | Implemented | `worktrees-summary-card.tsx` | `worktrees-summary-card.test.tsx` |
| WT-008 | worktree modal | Implemented | `worktree-modal.tsx` | `worktree-modal.test.tsx` |

## 4. 模块级验收线索

- Worktree 列表应显示当前仓库 worktree。
- 创建成功后列表刷新并展示新 worktree。
- 移除时应处理未清理状态和错误反馈。

## 5. 未确认项

- 移动端是否暴露 worktree 管理入口需在第二轮确认。
