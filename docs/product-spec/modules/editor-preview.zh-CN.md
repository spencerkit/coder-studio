# Editor Preview

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- Monaco 编辑器、打开位置、pending editor loads。
- 文档预览、图片预览、图片 diff、commit file list preview。
- LSP 前端桥接和状态提示。

不覆盖：
- 文件树操作和 Git command 本身。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| 打开文件 | Both | 从文件树、搜索、Git diff 等进入编辑器或预览。 |
| Diff viewer | Desktop | 展示文本或图片 diff。 |
| LSP 状态提示 | Desktop | 编辑器内显示语言服务状态。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| EDITOR-001 | 编辑器主入口渲染 | Implemented | `packages/web/src/features/code-editor/index.tsx` | `packages/web/src/features/code-editor/index.test.tsx` |
| EDITOR-002 | Monaco host | Implemented | `components/monaco-host.tsx` | `components/monaco-host.test.tsx` |
| EDITOR-003 | Monaco diff host | Implemented | `components/monaco-diff-host.tsx` | `components/monaco-diff-host.test.tsx` |
| EDITOR-004 | 打开指定位置 | Implemented | `actions/use-open-location.ts` | `actions/use-open-location.test.tsx` |
| EDITOR-005 | pending editor loads | Implemented | `actions/pending-editor-loads.ts` | `actions/pending-editor-loads.test.ts` |
| EDITOR-006 | document preview | Implemented | `components/document-preview.tsx` | `components/document-preview.test.tsx` |
| EDITOR-007 | image preview | Implemented | `components/image-preview.tsx` | `components/image-preview.test.tsx` |
| EDITOR-008 | image diff preview | Implemented | `components/image-diff-preview.tsx` | `components/image-diff-preview.test.tsx` |
| EDITOR-009 | commit file list preview | Implemented | `components/commit-file-list-preview.tsx` | `components/commit-file-list-preview.test.tsx` |
| EDITOR-010 | preview session API | Implemented | `actions/use-preview-session.ts`、`preview/api.ts` | `actions/use-preview-session.test.tsx`、`preview/api.test.ts` |
| EDITOR-011 | LSP 状态提示和前端桥接 | Implemented | `lsp/bridge.ts`、`components/lsp-status-notice.tsx` | `lsp/bridge.test.tsx`、`components/lsp-status-notice.test.tsx` |
| EDITOR-012 | LSP server commands | Internal | `packages/server/src/commands/lsp.ts` | `packages/server/src/__tests__/lsp-commands.test.ts` |

## 4. 模块级验收线索

- 打开文本文件应进入 Monaco 编辑器。
- 打开图片文件应进入图片预览。
- Git diff 应能展示文本或图片 diff。
- LSP 可用时编辑器应能显示相关状态。

## 5. 功能点规格

### EDITOR-001 / EDITOR-002 编辑器主入口与 Monaco host

状态：`Implemented`

用户行为：
- 用户打开可编辑文本文件。

系统响应：
- 前端根据打开文件状态渲染 code editor。
- Monaco host 管理模型、语言、高亮和编辑器实例。
- 保存动作通过 Files 模块写入文件。

状态与边界：
- Success：文本内容进入 Monaco，并可编辑。
- Loading：文件内容尚未读取完成时应显示加载或占位状态。
- Error：文件读取失败时不应创建错误内容模型。

验收标准：
- Given workspace 中存在文本文件
- When 用户打开该文件
- Then Monaco editor 显示文件内容
- And 修改内容后可触发保存动作

代码索引：
- `packages/web/src/features/code-editor/index.tsx`
- `packages/web/src/features/code-editor/components/monaco-host.tsx`

### EDITOR-003 Monaco diff host

状态：`Implemented`

用户行为：
- 用户从 Git diff、commit diff 或搜索替换预览进入 diff 视图。

系统响应：
- 前端渲染 Monaco diff host。
- Diff host 展示原始内容和修改后内容。

状态与边界：
- Success：文本 diff 可读。
- Empty：无 diff 内容时应显示空差异或占位。
- Error：diff 输入缺失时不应导致页面崩溃。

验收标准：
- Given 一个文本文件存在 Git diff
- When 用户打开该文件 diff
- Then diff host 显示左右两侧内容差异

代码索引：
- `packages/web/src/features/code-editor/components/monaco-diff-host.tsx`
- `packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx`

### EDITOR-004 打开指定位置

状态：`Implemented`

用户行为：
- 用户从搜索结果、诊断、LSP definition/reference 或其他定位入口打开文件位置。

系统响应：
- 前端通过 open location action 设置目标文件和定位信息。
- 如果文件尚未加载，pending editor loads 记录等待定位。

状态与边界：
- Success：文件打开后光标或视图定位到指定位置。
- Pending：文件模型尚未 ready 时延迟执行定位。

验收标准：
- Given 搜索结果指向某文件第 N 行
- When 用户打开该结果
- Then editor 打开该文件
- And 视图定位到目标位置

代码索引：
- `packages/web/src/features/code-editor/actions/use-open-location.ts`
- `packages/web/src/features/code-editor/actions/pending-editor-loads.ts`

### EDITOR-006 / EDITOR-007 文档与图片预览

状态：`Implemented`

用户行为：
- 用户打开非直接编辑型文档或图片文件。

系统响应：
- document preview 渲染文档内容。
- image preview 渲染图片，并提供适合当前容器的展示。

状态与边界：
- Success：预览内容可见。
- Error：资源加载失败时展示失败状态。
- Unsupported：不支持的类型应回退到可理解状态。

验收标准：
- Given workspace 中存在图片文件
- When 用户打开该图片
- Then 图片预览组件显示图片

代码索引：
- `packages/web/src/features/code-editor/components/document-preview.tsx`
- `packages/web/src/features/code-editor/components/image-preview.tsx`

### EDITOR-011 LSP 状态提示和前端桥接

状态：`Implemented`

用户行为：
- 用户打开支持语言服务的代码文件。

系统响应：
- 前端 LSP bridge 和 server LSP commands 协作打开 document、同步变更、查询 hover/definition/references 等能力。
- LSP status notice 展示运行状态或不可用状态。

状态与边界：
- Success：语言服务可用时返回对应能力结果。
- Unavailable：runtime 或工具未安装时展示状态提示。
- Mode：LSP runtime mode 可通过 command 设置。

验收标准：
- Given LSP runtime 可用且文件类型受支持
- When 用户打开代码文件
- Then 前端打开 LSP document
- And LSP 状态提示不应显示失败

代码索引：
- `packages/web/src/features/code-editor/lsp/bridge.ts`
- `packages/server/src/commands/lsp.ts`

## 6. 未确认项

- Markdown / HTML 预览的具体入口需在第二轮结合 preview API 核实。
