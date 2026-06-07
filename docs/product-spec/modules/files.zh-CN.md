# Files

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- 文件树读取、刷新、创建、删除、重命名、创建目录。
- 文件搜索、内容搜索、搜索替换 session。
- 文件上下文菜单和打开文件动作。

不覆盖：
- 文件内容编辑器和预览渲染。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Files panel | Desktop | 文件树、上下文菜单、打开文件。 |
| Mobile Files Sheet | Mobile | 移动端文件树和文件打开。 |
| Search panel | Both | 文件搜索和内容搜索入口。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| FILE-001 | 读取文件树 | Implemented | `file.readTree`、`file-tree-panel.tsx` | `packages/server/src/__tests__/file-commands.test.ts`、`file-tree-panel.test.tsx` |
| FILE-002 | 打开/读取文件 | Implemented | `file.read`、`use-open-workspace-file.ts` | `packages/web/src/features/workspace/actions/use-open-workspace-file.test.tsx` |
| FILE-003 | 写入文件 | Implemented | `file.write`、`use-file-actions.ts` | `packages/web/src/features/workspace/actions/use-file-actions.test.tsx` |
| FILE-004 | 创建文件 | Implemented | `file.create`、`use-file-context-actions.ts` | `packages/server/src/__tests__/file-commands.test.ts` |
| FILE-005 | 创建目录 | Implemented | `file.mkdir`、`use-file-context-actions.ts` | `packages/server/src/__tests__/file-commands.test.ts` |
| FILE-006 | 删除文件或目录 | Implemented | `file.delete`、`file-context-menu.tsx` | `packages/web/src/features/workspace/views/shared/file-context-menu.test.tsx` |
| FILE-007 | 重命名文件或目录 | Implemented | `file.rename` | `packages/server/src/__tests__/file-commands.test.ts` |
| FILE-008 | 刷新文件树 | Implemented | `file-tree-refresh.ts` | `packages/web/src/features/workspace/actions/file-tree-refresh.test.ts` |
| FILE-009 | 文件名搜索 | Implemented | `file.search`、`quick-open` | `packages/web/src/features/quick-open/components/quick-open.test.tsx` |
| FILE-010 | 内容搜索 | Implemented | `file.searchContent`、`search-panel.tsx` | `packages/server/src/__tests__/fs/content-search.test.ts` |
| FILE-011 | 搜索替换 session | Implemented | `file.searchSession.start/previewFile/apply` | `packages/server/src/__tests__/fs/search-replace.test.ts` |
| FILE-012 | Gitignore 和 watcher 支持 | Internal | `packages/server/src/fs` | `packages/server/src/__tests__/fs/gitignore.test.ts`、`watcher.test.ts` |

## 4. 模块级验收线索

- 文件树能加载当前 workspace 根目录。
- 打开文本文件后进入 editor。
- 创建、重命名、删除后文件树应刷新。
- 搜索结果能定位到文件或预览替换。

## 5. 功能点规格

### FILE-001 读取文件树

状态：`Implemented`

用户行为：
- 用户打开 Files panel 或展开目录。

系统响应：
- 前端调用 `file.readTree`，传入 workspace id 和可选 subPath。
- 服务端校验 workspace 存在，并从 workspace root 读取文件树。

状态与边界：
- Success：返回文件树节点，前端渲染目录和文件。
- Error：workspace 不存在返回 `workspace_not_found`。
- Refresh：文件系统 dirty 或用户刷新时重新读取。

验收标准：
- Given workspace root 下有目录和文件
- When 用户打开 Files panel
- Then 文件树显示 root 下的目录和文件

代码索引：
- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- `packages/server/src/commands/file.ts`

### FILE-002 打开/读取文件

状态：`Implemented`

用户行为：
- 用户点击文件树、搜索结果或 Git diff 中的文件。

系统响应：
- 前端调用 `file.read`。
- 服务端校验 workspace 存在，并读取 workspace-relative path。
- 前端根据文件类型进入 editor 或 preview。

状态与边界：
- Success：返回文件内容和相关 metadata。
- Error：workspace 不存在或文件读取失败时，打开动作应展示错误或保持当前视图。

验收标准：
- Given workspace 中存在 `README.md`
- When 用户点击该文件
- Then 前端读取文件内容
- And editor/preview 显示该文件

代码索引：
- `packages/web/src/features/workspace/actions/use-open-workspace-file.ts`
- `packages/server/src/commands/file.ts`

### FILE-003 写入文件

状态：`Implemented`

用户行为：
- 用户在 editor 修改文件并保存。

系统响应：
- 前端调用 `file.write`，传入 workspace id、path、content 和可选 baseHash。
- 服务端写入文件，并发出 `fs.dirty` event，reason 为 `file_content`。
- 返回写入结果，用于前端更新保存状态。

状态与边界：
- Success：文件内容写入 workspace。
- Conflict：当 baseHash 不匹配时，底层写入逻辑可返回冲突结果。
- Error：workspace 不存在返回 `workspace_not_found`。

验收标准：
- Given 一个已打开文本文件
- When 用户修改内容并保存
- Then server 写入新内容
- And 发出 `fs.dirty` 事件

代码索引：
- `packages/web/src/features/workspace/actions/use-file-actions.ts`
- `packages/server/src/commands/file.ts`

### FILE-004 / FILE-005 创建文件或目录

状态：`Implemented`

用户行为：
- 用户通过文件树上下文菜单创建文件或目录。

系统响应：
- 前端调用 `file.create` 或 `file.mkdir`。
- 服务端校验 workspace 存在，在 workspace root 下创建目标，并发出 `fs.dirty` event，reason 为 `fs_change`。

状态与边界：
- Success：创建完成后文件树刷新。
- Error：路径非法、已存在或 workspace 不存在时返回错误。

验收标准：
- Given Files panel 已打开
- When 用户创建一个新文件
- Then 文件树刷新后显示新文件

- Given Files panel 已打开
- When 用户创建一个新目录
- Then 文件树刷新后显示新目录

代码索引：
- `packages/web/src/features/workspace/actions/use-file-context-actions.ts`
- `packages/server/src/commands/file.ts`

### FILE-006 / FILE-007 删除或重命名文件

状态：`Implemented`

用户行为：
- 用户通过上下文菜单删除或重命名文件/目录。

系统响应：
- 删除调用 `file.delete`。
- 重命名调用 `file.rename`。
- 服务端执行文件系统操作后发出 `fs.dirty` event，reason 为 `fs_change`。

状态与边界：
- Success：文件树刷新，目标路径消失或变更。
- Error：workspace 不存在、目标不存在、权限不足或路径冲突时返回错误。

验收标准：
- Given 文件树中存在 `old.txt`
- When 用户把它重命名为 `new.txt`
- Then 文件树不再显示 `old.txt`
- And 显示 `new.txt`

代码索引：
- `packages/web/src/features/workspace/views/shared/file-context-menu.tsx`
- `packages/server/src/commands/file.ts`

### FILE-010 / FILE-011 内容搜索与搜索替换

状态：`Implemented`

用户行为：
- 用户在搜索面板输入内容搜索条件，或启动搜索替换。

系统响应：
- 内容搜索调用 `file.searchContent`，限制 `maxFiles` 和 `maxMatchesPerFile` 最大为 100。
- 搜索替换通过 `file.searchSession.start` 创建 session。
- 用户预览文件时调用 `file.searchSession.previewFile`。
- 用户应用替换时调用 `file.searchSession.apply`，成功或部分成功后发出 `fs.dirty` event，reason 为 `file_content`。

状态与边界：
- Success：返回匹配文件和 match 信息。
- Stale：预览或应用不存在的 search session 返回 `stale_session`。
- Partial：部分替换成功时仍发出 dirty event。

验收标准：
- Given workspace 中多个文件包含同一字符串
- When 用户执行内容搜索
- Then 搜索结果按文件返回匹配项

- Given 已创建搜索替换 session
- When 用户应用全部替换
- Then 匹配文件内容被更新
- And 发出 `fs.dirty` 事件

代码索引：
- `packages/web/src/features/workspace/views/shared/search-panel.tsx`
- `packages/server/src/commands/file.ts`

## 6. 未确认项

- 文件上传入口横跨 Terminal 和 Files，第一轮仅在 Terminal 记录上传实现线索。
