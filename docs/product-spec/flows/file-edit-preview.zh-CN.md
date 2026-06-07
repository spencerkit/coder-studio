# File Edit Preview Flow

> 第一轮流程索引。本文只记录跨模块路径、关联功能 ID 和验收入口。

## 1. 流程目标

描述用户从文件树、搜索或 Git diff 打开文件，并进入编辑器或预览的流程。

## 2. 参与模块

- Files：`FILE-001`、`FILE-002`、`FILE-003`
- Search / Quick Open：`SEARCH-001`、`SEARCH-004`
- Editor Preview：`EDITOR-001`、`EDITOR-002`、`EDITOR-006`、`EDITOR-007`
- Git：`GIT-002`

## 3. 前置条件

- 已打开 workspace。
- workspace 中存在可读取文件。

## 4. 主路径

| 步骤 | 用户行为 | 系统响应 | 关联功能 ID |
| --- | --- | --- | --- |
| 1 | 打开 Files panel | 加载文件树 | `FILE-001` |
| 2 | 点击文本文件 | 读取文件并打开 editor | `FILE-002`、`EDITOR-001`、`EDITOR-002` |
| 3 | 修改文件内容 | editor 状态更新 | `EDITOR-002` |
| 4 | 保存文件 | 写入 server 文件系统 | `FILE-003` |

## 5. 分支与错误路径

- 从 Quick Open 打开：关联 `SEARCH-001`。
- 从搜索预览打开：关联 `SEARCH-004`。
- 打开图片：关联 `EDITOR-007`。
- 打开文档预览：关联 `EDITOR-006`。
- 从 Git diff 打开：关联 `GIT-002`、`EDITOR-003`。

## 6. 验收标准

- Given workspace 中存在文本文件
- When 用户从文件树打开并编辑保存
- Then 文件内容应被写入
- And 重新打开该文件能看到保存后的内容

## 7. 自动化测试建议

- 覆盖 `packages/web/src/features/workspace/actions/use-open-workspace-file.test.tsx`。
- 覆盖 `packages/web/src/features/code-editor/views/shared/editor-surface.test.tsx`。
- server 层覆盖 `packages/server/src/__tests__/file-commands.test.ts`。
