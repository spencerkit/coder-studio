# Server Commands Acceptance

> 第一轮验收索引。本文按 command 域记录 server 层验收入口。

## 1. 目标

验证 WebSocket command 分发、schema 校验、handler 行为和错误格式。

## 2. Command 域清单

| ID | Command 域 | 关联模块 | 主要测试入口 |
| --- | --- | --- | --- |
| SERVER-001 | activation / connection / fencing | App Shell | `activation-commands.test.ts`、`fencing-commands.test.ts`、`dispatch.test.ts` |
| SERVER-002 | workspace / workspace activity | Workspace | `workspace-commands.test.ts`、`workspace-close-state-cleanup.test.ts` |
| SERVER-003 | file / fs | Files | `file-commands.test.ts`、`fs/*.test.ts` |
| SERVER-004 | git | Git | `git-commands.test.ts`、`git/*.test.ts` |
| SERVER-005 | session / terminal | Agent Sessions / Terminal | `session-commands.test.ts`、`terminal-commands.test.ts` |
| SERVER-006 | agent instructions / agent context | Agent Instructions | `agent-instructions-command.test.ts`、`agent-context-command.test.ts` |
| SERVER-007 | provider / custom provider | Providers | `provider-list.test.ts`、`custom-provider-command.test.ts` |
| SERVER-008 | supervisor | Supervisor | `supervisor-commands.test.ts` |
| SERVER-009 | worktree | Worktrees | `worktree-commands.test.ts` |
| SERVER-010 | settings / diagnostics / system deps | Settings / Diagnostics | `settings.test.ts`、`diagnostics-commands.test.ts`、`system-deps/commands.test.ts` |
| SERVER-011 | monitoring / work analysis | Monitoring / Work Analysis | `monitoring/commands.test.ts`、`work-analysis-commands.test.ts` |
| SERVER-012 | skills / updates / lsp | Skills / Updates / Editor Preview | `skills-command.test.ts`、`updates.test.ts`、`lsp-commands.test.ts` |

## 3. 通用验收标准

- 未知 command 返回 `unknown_op`。
- schema 校验失败返回 `validation_error`。
- 非活动标签页调用受保护 command 返回 `activation_required`。
- handler 抛出的业务错误应保留 code、message 和 details。

## 4. 未确认项

- 每个 command 的完整参数矩阵需在第二轮模块规格中补充。
