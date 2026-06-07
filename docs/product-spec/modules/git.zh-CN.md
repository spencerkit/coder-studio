# Git

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- Git 状态、diff、stage/unstage/discard、commit、push/pull/fetch。
- branch 列表、checkout、quick pick。
- commit log、commit detail、commit file diff。

不覆盖：
- Worktree 管理。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Git panel | Desktop | 查看状态、stage、commit、sync。 |
| Git status bar | Desktop | 分支和状态入口。 |
| Branch quick pick | Desktop | 快速切换分支。 |
| Diff viewer | Both | 查看文件 diff。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| GIT-001 | Git 状态读取 | Implemented | `git.status`、`git-panel.tsx` | `packages/web/src/features/workspace/views/shared/git-panel.test.tsx` |
| GIT-002 | 文件 diff | Implemented | `git.diff`、`git-diff-viewer.tsx` | `git-diff-viewer.test.tsx` |
| GIT-003 | stage / unstage | Implemented | `git.stage`、`git.unstage`、`use-git-actions.ts` | `use-git-actions.test.tsx` |
| GIT-004 | discard | Implemented | `git.discard` | `packages/server/src/__tests__/git-commands.test.ts` |
| GIT-005 | commit | Implemented | `git.commit` | `packages/server/src/__tests__/git/commit.test.ts` |
| GIT-006 | push / pull / fetch | Implemented | `git.push`、`git.pull`、`git.fetch` | `packages/server/src/__tests__/git/fetch.test.ts` |
| GIT-007 | branch 当前状态 | Implemented | `git.branch`、`git-status-bar.tsx` | `git-status-bar.test.tsx` |
| GIT-008 | branch 列表和 checkout | Implemented | `git.branches`、`git.checkout`、`branch-quick-pick.tsx` | `branch-quick-pick.test.tsx` |
| GIT-009 | commit log/detail/show | Implemented | `git.log`、`git.commitDetail`、`git.show` | `packages/server/src/__tests__/git-commands.test.ts` |
| GIT-010 | commit file diff | Implemented | `git.commitFileDiff` | `packages/server/src/__tests__/git/diff.test.ts` |
| GIT-011 | Git 事件广播 | Internal | `packages/server/src/commands/git-events.ts`、`packages/server/src/git` | `packages/server/src/__tests__/git/auto-fetch.test.ts` |

## 4. 模块级验收线索

- 修改文件后 Git panel 应显示状态。
- stage/unstage/discard 后状态应更新。
- commit 成功后状态应清理对应 staged changes。
- Branch quick pick 能切换分支或反馈失败。

## 5. 功能点规格

### GIT-001 Git 状态读取

状态：`Implemented`

用户行为：
- 用户打开 Git panel 或 Git status bar。

系统响应：
- 前端调用 `git.status`。
- 服务端校验 workspace 存在，并读取 Git status。
- UI 根据返回值展示分支、变更文件和同步状态。

状态与边界：
- Success：展示当前仓库状态。
- Error：workspace 不存在返回 `workspace_not_found`；非 Git 仓库错误由 git cli 层返回。

验收标准：
- Given workspace 是 Git 仓库且存在一个修改文件
- When 用户打开 Git panel
- Then Git panel 显示该修改文件

代码索引：
- `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- `packages/server/src/commands/git.ts`

### GIT-002 文件 diff

状态：`Implemented`

用户行为：
- 用户点击 Git panel 中的 changed file。

系统响应：
- 前端调用 `git.diff`，传入 path 和 staged 标记。
- 服务端返回目标文件 staged 或 unstaged diff。
- 前端用 Git diff viewer 或 editor diff host 展示。

状态与边界：
- Success：展示 diff 内容。
- Empty：无差异时显示空 diff 状态。
- Error：workspace 不存在返回 `workspace_not_found`。

验收标准：
- Given 文件 `a.txt` 有 unstaged 修改
- When 用户打开该文件 diff
- Then diff viewer 展示 unstaged diff

代码索引：
- `packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx`
- `packages/server/src/commands/git.ts`

### GIT-003 stage / unstage

状态：`Implemented`

用户行为：
- 用户 stage 或 unstage 一个或多个文件。

系统响应：
- Stage 调用 `git.stage`，unstage 调用 `git.unstage`。
- 服务端执行 Git 操作后调用 `emitGitStateChanged`。

状态与边界：
- Success：文件在 staged/unstaged 分组之间移动。
- Error：workspace 不存在或 Git 操作失败时返回错误。

验收标准：
- Given 文件 `a.txt` 是 unstaged
- When 用户 stage 该文件
- Then Git 状态刷新后 `a.txt` 出现在 staged 区域

代码索引：
- `packages/web/src/features/workspace/actions/use-git-actions.ts`
- `packages/server/src/commands/git.ts`

### GIT-004 discard

状态：`Implemented`

用户行为：
- 用户丢弃一个或多个未提交变更。

系统响应：
- 前端调用 `git.discard`。
- 服务端执行 discard，并发出 Git state changed，包含 `treeChanged: true`。

状态与边界：
- Success：目标变更从 Git status 中消失，文件树可能刷新。
- Destructive：该操作会丢弃本地修改，UI 应有确认或明确入口。
- Error：Git 操作失败时返回错误。

验收标准：
- Given 文件 `a.txt` 有本地修改
- When 用户确认 discard
- Then `a.txt` 恢复到 Git 版本
- And Git status 不再显示该修改

代码索引：
- `packages/web/src/features/workspace/actions/use-git-actions.ts`
- `packages/server/src/commands/git.ts`

### GIT-005 commit

状态：`Implemented`

用户行为：
- 用户输入 commit message 并提交 staged changes。

系统响应：
- 前端调用 `git.commit`。
- 服务端执行 commit，并发出 Git state changed，包含 branch 和 worktree 变化。

状态与边界：
- Success：返回 commit 结果，Git status 更新。
- Error：无 staged changes、message 无效或 Git 失败时返回错误。

验收标准：
- Given 有一个 staged 文件且 commit message 非空
- When 用户提交
- Then Git 创建新 commit
- And staged 区域清空或反映最新状态

代码索引：
- `packages/web/src/features/workspace/actions/use-git-actions.ts`
- `packages/server/src/commands/git.ts`

### GIT-006 push / pull / fetch

状态：`Implemented`

用户行为：
- 用户同步远端分支，或系统执行后台 fetch。

系统响应：
- Push 调用 `git.push`，pull 调用 `git.pull`，fetch 调用 `git.fetch`。
- 网络操作通过 autoFetch exclusive gate 串行化。
- Pull 和 fetch 成功后记录 fetch 时间。
- Background fetch 遇到 HTTP auth 错误时返回失败结果而不是抛出。

状态与边界：
- Success：返回 Git 网络操作结果并更新状态。
- Auth：需要认证时可传入 HTTP username/password。
- Background：后台 fetch timeout 使用 30 秒。

验收标准：
- Given workspace 配置了远端
- When 用户执行 fetch
- Then 返回 updated refs 或明确失败信息
- And Git branch 状态刷新

代码索引：
- `packages/server/src/commands/git.ts`
- `packages/server/src/git/auto-fetch.ts`

### GIT-008 branch 列表和 checkout

状态：`Implemented`

用户行为：
- 用户打开 branch quick pick，选择已有分支或创建新分支。

系统响应：
- 分支列表调用 `git.branches`。
- checkout 调用 `git.checkout`，可选 `createBranch`。
- 创建分支调用 `git.branch`。
- checkout 成功后发出 tree、branch、worktree changed。

状态与边界：
- Success：当前分支切换，Git 状态刷新。
- Error：workspace 不存在、分支不存在或 Git 阻止 checkout 时返回错误。

验收标准：
- Given 仓库存在分支 `feature/a`
- When 用户通过 branch quick pick 选择该分支
- Then 当前分支切换为 `feature/a`
- And Git status bar 显示新分支

代码索引：
- `packages/web/src/features/workspace/views/shared/branch-quick-pick.tsx`
- `packages/server/src/commands/git.ts`

## 6. 未确认项

- 冲突、未提交变更阻止 checkout 等边界需在第二轮补验收路径。
