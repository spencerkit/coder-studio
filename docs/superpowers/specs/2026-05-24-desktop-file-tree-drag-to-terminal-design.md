# Desktop File Tree Drag To Terminal — Design

Date: 2026-05-24
Status: Draft
Owner: codex

## Problem

桌面端左侧资源树目前只支持点击、展开、右键等操作，不支持把文件或文件夹直接拖到终端。用户在终端里经常需要输入某个 workspace 内文件的路径；逐字输入路径慢，右键菜单再找“复制路径”也比直接拖放多一步。

项目已经支持“外部文件拖入终端后上传并把路径写入终端”，但这条链路面向本地文件，不适合处理 workspace 内已存在的树节点。对内部树节点来说，正确行为应该是：不上传、不改文件系统，只把相对 workspace 根目录的路径直接注入到当前活动终端。

## Goals

- 桌面端左侧文件树中的 `file` 和 `dir` 节点可以拖入当前活动终端。
- drop 成功后，终端输入区写入相对 workspace 根目录的路径。
- 路径使用现有 shell 单引号转义逻辑，末尾追加一个空格，和现有上传文件后的行为一致。
- 复用现有终端输入通路，不新增后端接口、不改 PTY 协议。
- 不影响现有“外部文件拖入终端上传”的能力。

## Non-Goals

- 不覆盖移动端。
- 不覆盖搜索结果列表。
- 不覆盖 `Open Editors` 区域。
- 不做“相对当前终端 cwd”的路径计算；v1 只基于 workspace 根目录。
- 不做多选拖拽。
- 不做新的拖拽浮层、插入预览或复杂视觉反馈。

## User Flow

1. 用户在桌面端左侧文件树中按住一个文件或文件夹节点开始拖拽。
2. 文件树节点在 `dragstart` 时向 `dataTransfer` 写入一个 app 内部自定义 payload，并同步写入纯文本路径作为兜底。
3. 用户把节点拖到当前活动终端区域。
4. 终端在 `dragover` 检测到这是文件树路径拖拽后允许 drop。
5. 终端在 `drop` 时读取该 payload，校验它属于当前 workspace。
6. 终端将路径交给现有 `sendTextToTerminal()`，写入 `'relative/path' ` 这样的文本。
7. 如果 payload 无效或 workspace 不匹配，则忽略此次 drop，并给出轻量错误提示；终端不插入任何文本。

## Architecture

```
┌──────────────────── packages/web / workspace ────────────────────┐
│ FileTreePanel                                                     │
│   FileTreeNode (desktop only, draggable)                          │
│     dragstart                                                     │
│       ├─ setData("application/x-coder-studio-workspace-path", …)  │
│       └─ setData("text/plain", relativePath)                      │
└───────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────── packages/web / terminal ─────────────────────┐
│ usePasteDropUpload                                                │
│   dragover                                                        │
│     ├─ Files => existing upload path                              │
│     └─ workspace-path mime => allow drop                          │
│   drop                                                            │
│     ├─ Files => existing upload path                              │
│     └─ workspace-path mime => quote + sendTextToTerminal()        │
└───────────────────────────────────────────────────────────────────┘
```

这次改动只在 web 侧完成。服务端、WebSocket 协议、终端 session 管理逻辑都不需要变更。

## Drag Payload Contract

新增一个前端共享的 drag/drop helper，集中定义 MIME type 与序列化逻辑，避免文件树和终端两边硬编码字符串。

### MIME Type

`application/x-coder-studio-workspace-path`

### Payload Shape

```json
{
  "workspaceId": "ws_123",
  "path": "packages/web/src/main.tsx",
  "kind": "file"
}
```

字段约束：

- `workspaceId`: 当前资源树所属 workspace id。
- `path`: 相对 workspace 根目录的路径，直接复用文件树节点现有 `node.path`。
- `kind`: `"file"` 或 `"dir"`，当前版本主要用于调试和后续扩展；drop 行为暂时一致。

### Plain Text Fallback

同时写入 `text/plain = path`。这不是 v1 的主要解析通道，但保留它有两个价值：

- 便于浏览器拖拽调试和开发者工具排查。
- 为后续把同一拖拽源接到别的消费方预留一个低门槛文本格式。

终端 v1 只在检测到自定义 MIME 时才走“内部路径插入”逻辑；不会因为任意 `text/plain` drop 就抢占文本拖拽行为。

## Frontend Changes

### File Tree

变更目标文件：

- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`

设计要求：

- 仅 `variant === "desktop"` 的树节点启用 `draggable`。
- `file` 和 `dir` 节点都可拖拽。
- `dragstart` 时写入自定义 payload 与 `text/plain`。
- 不改变现有点击、展开、右键菜单、移动端长按逻辑。

实现上建议抽一个很小的 helper，例如：

- `serializeWorkspacePathDragPayload(...)`
- `setWorkspacePathDragData(dataTransfer, payload)`

这样文件树只负责提供 `workspaceId` 和 `node` 数据，不关心终端侧解析细节。

### Terminal Drop Handling

变更目标文件：

- `packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.ts`

设计要求：

- 保留现有 `Files` drop 处理顺序与上传链路。
- 新增对自定义 MIME 的检测、解析与校验。
- 解析成功后直接调用现有 `sendTextToTerminal()`。
- 生成终端输入文本时复用现有 `quoteShellSingle()`。
- 末尾追加一个空格：`'packages/web/src/main.tsx' `

推荐处理顺序：

1. 如果 `dataTransfer.files.length > 0`，继续走现有上传流程。
2. 否则检查 `application/x-coder-studio-workspace-path`。
3. 如果 payload 可解析且 `workspaceId === current workspaceId`，则写入路径。
4. 其它情况直接返回，不拦截普通非文件文本拖拽。

`dragover` 也要同步更新：

- `types` 含 `Files` 时，维持现有 `preventDefault()`。
- `types` 含自定义 MIME 时，也执行 `preventDefault()`，让浏览器允许 drop。

## Error Handling

内部路径拖拽是同步前端操作，不涉及上传和服务端失败。主要错误面只有三类：

1. payload 缺失或 JSON 非法
2. payload 字段不完整
3. payload 的 `workspaceId` 与当前终端不一致

处理策略：

- 不向终端写入任何字符。
- 不进入“upload busy”状态。
- 使用现有 toast 机制提示用户“无法插入该路径”或“只能拖入当前 workspace 的文件”。

这是故障安全的默认行为：宁可忽略，也不要把错误文本注入到终端。

## Interaction Notes

- 文件和文件夹行为一致，都只插入路径。
- 不自动追加换行；用户仍然可以继续补命令参数。
- 不新增 drop overlay，因为这个操作不需要等待网络或后台响应。
- 首版不要求文件树行在拖拽时展示特殊样式，浏览器原生拖拽光标已足够表达交互。

## Testing

### Frontend Unit / Component

1. `file-tree-panel.test.tsx`
   - 桌面端文件节点会设置 `draggable`
   - `dragstart` 写入正确的自定义 MIME payload
   - `dragstart` 同时写入 `text/plain`
   - 移动端节点不启用拖拽

2. `use-paste-drop-upload.test.tsx`
   - 内部 workspace-path drop 会调用 `sendTextToTerminal("'path' ")`
   - 内部 drop 不会调用 `uploadFiles`
   - workspace 不匹配时不会发送终端输入，并触发错误 toast
   - 非 `Files` 且非自定义 MIME 的 drop 继续忽略，保持现有穿透行为

3. 回归
   - 现有外部文件 drop 上传测试继续通过
   - 多文件上传顺序与 quoted path 拼接行为不受影响

## Rollout

- 一次合入，无 feature flag。
- 只影响桌面端左侧资源树与终端之间的拖拽交互。
- 由于不改后端，无迁移、无数据兼容负担。

## Risks

- HTML5 Drag and Drop 在测试环境需要手工 mock `dataTransfer`，测试代码会比普通 click 稍繁琐。
- 如果未来把同一能力扩展到搜索结果或 `Open Editors`，应复用同一个 drag helper，避免 payload 格式分叉。
- 如果后续产品要支持“相对当前终端 cwd”，现有 payload 仍可复用，但终端侧解析逻辑需要增加 cwd 感知与路径换算。

## Open Questions

无。v1 范围、路径基准和入口范围都已确认。
