# Git Change Review Flow

> 第一轮流程索引。本文只记录跨模块路径、关联功能 ID 和验收入口。

## 1. 流程目标

描述用户查看 Git 变更、查看 diff、stage、commit 和同步的流程。

## 2. 参与模块

- Git：`GIT-001` 到 `GIT-010`
- Editor Preview：`EDITOR-003`、`EDITOR-008`
- Files：`FILE-002`

## 3. 前置条件

- workspace 是 Git 仓库。
- 存在至少一个文件变更。

## 4. 主路径

| 步骤 | 用户行为 | 系统响应 | 关联功能 ID |
| --- | --- | --- | --- |
| 1 | 打开 Git panel | 展示 Git 状态 | `GIT-001` |
| 2 | 点击 changed file | 展示 diff | `GIT-002` |
| 3 | Stage 文件 | staged 状态更新 | `GIT-003` |
| 4 | 输入 commit message 并提交 | 创建 commit | `GIT-005` |
| 5 | Push 或 Pull | 同步远端 | `GIT-006` |

## 5. 分支与错误路径

- Discard 文件：关联 `GIT-004`。
- 切换分支：关联 `GIT-008`。
- 查看历史 commit：关联 `GIT-009`、`GIT-010`。
- 图片 diff：关联 `EDITOR-008`。

## 6. 验收标准

- Given Git 仓库中有一个修改文件
- When 用户 stage 并提交该文件
- Then Git 状态中该文件不再显示为未提交变更
- And Git log 中出现新 commit

## 7. 自动化测试建议

- 覆盖 `packages/server/src/__tests__/git-commands.test.ts`。
- 覆盖 `packages/web/src/features/workspace/actions/use-git-actions.test.tsx`。
