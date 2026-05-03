# Terminal File Paste & Drop Upload — Design

Date: 2026-05-03
Status: Draft
Owner: spencer

## Problem

xterm 终端目前不支持把"文件"粘贴到输入区。用户的实际诉求是：在跟 AI agent（Claude Code、codex 等）对话时，能把截图、日志、PDF 等本地文件直接拖进或 `Cmd/Ctrl+V` 粘到终端，让 agent 拿到文件路径后自行读取。

xterm 默认拦截 `Cmd/Ctrl+V` 走 `clipboard.readText()`，所以剪贴板里的非文本（File 列表）被静默丢弃；拖拽到 xterm 容器目前也无任何处理。

## Goals

- 用户在 xterm 区域 **粘贴或拖拽**本地文件 → 文件被上传到服务端 → 服务端绝对路径以 shell 单引号包裹的形式插入到当前光标处。
- 行为对所有终端会话生效（包含 PTY shell 与 agent 会话），无需会话端配合。
- 上传文件落到 app 受管的存储目录，**不污染用户 workspace 目录**。
- 自动清理：workspace 删除时级联、超期 / 超容量自动 GC，无需用户介入。
- 开发与生产环境的存储位置严格隔离。

## Non-Goals

- 不做附件按钮 / 浮层进度 / 行内占位符替换（v1 极简）。
- 不入库（不维护上传记录的 DB 表）。
- 不做后台常驻 GC 定时器（仅启动期 + 写入期触发）。
- 不做后缀白名单 / mime 白名单（接收任意文件，仅做大小与数量限制）。
- 不为 agent 解析路径做特殊语法（不加 `@` 前缀，是否前缀由用户自己决定）。

## User Flow

1. 用户在终端区域执行 `Cmd/Ctrl+V`（剪贴板含 File）或拖拽文件到终端容器内。
2. 前端拦截事件、阻止 xterm 默认处理，**锁住该终端的输入**，并将所有文件作为一次批量请求 `POST /api/uploads`。
3. 服务端校验后写入受管存储目录，返回每个文件的**绝对路径**数组。
4. 前端解锁输入，将所有路径用单引号包裹、空格分隔，作为一次 `terminal.input` dispatch 注入到 PTY（与用户键入等价）。
5. 上传失败：解锁输入，弹 toast，不向终端注入任何字符。

## Architecture

```
┌──────────────────────── packages/web ────────────────────────┐
│  XtermHost                                                    │
│    container <div>                                            │
│      ├─ paste capture (event.clipboardData.files)             │
│      └─ drop capture  (event.dataTransfer.files)              │
│              │                                                │
│              ▼                                                │
│  uploadFiles(workspaceId, File[])                             │
│    POST /api/uploads (multipart)                              │
│              │                                                │
│              ▼                                                │
│  insertPathsIntoTerminal(terminalId, paths[])                 │
│    dispatchCommand('terminal.input', { id, data: quoted })    │
└───────────────────────────────────────────────────────────────┘

┌─────────────────────── packages/server ──────────────────────┐
│  routes/uploads.ts (NEW)                                      │
│    POST /api/uploads                                          │
│      ├─ multipart parse  (@fastify/multipart)                 │
│      ├─ resolve workspace via WorkspaceManager                │
│      ├─ validate (size, count)                                │
│      ├─ sanitize filename, generate uuid                      │
│      ├─ write to <uploadsDir>/<wsId>/<yyyy-mm-dd>/...         │
│      ├─ enforce per-workspace size cap (LRU evict if needed)  │
│      └─ return { files: [{ path, originalName, size }] }      │
│                                                               │
│  uploads/cleanup.ts (NEW)                                     │
│    runStartupGc(uploadsDir)                                   │
│      delete files older than 72 hours                         │
│    deleteWorkspaceUploads(uploadsDir, wsId)                   │
│      called from WorkspaceManager.delete                      │
│                                                               │
│  config.ts                                                    │
│    add uploadsDir resolution (mirrors dataDir pattern)        │
└───────────────────────────────────────────────────────────────┘
```

## API Contract

### POST `/api/uploads`

- Auth：复用现有全局 `onRequest` cookie guard。
- Content-Type：`multipart/form-data`。
- Form fields：
  - `workspaceId` (string, required)
  - `files` (one or more file parts, required, ≤20 个)

**成功响应** `200`

```json
{
  "ok": true,
  "files": [
    {
      "path": "/Users/foo/.coder-studio/uploads/ws_xxx/2026-05-03/3f9b-screenshot.png",
      "originalName": "screenshot.png",
      "size": 245760
    }
  ]
}
```

**失败响应**

| 状态码 | error 字段 | 触发条件 |
|---|---|---|
| 400 | `workspace_required` | 缺 workspaceId |
| 400 | `no_files` | files 字段为空 |
| 400 | `too_many_files` | files > 20 |
| 404 | `workspace_not_found` | workspaceId 不存在 |
| 413 | `file_too_large` | 任一 file > 50 MB |
| 500 | `write_failed` | 落盘失败（含 errorDetail） |

> 设计选择：单个文件失败 = **整个请求失败**（不返回部分成功）。理由：批量插入失败/部分插入会让用户搞不清"我粘了 5 个文件结果终端只出现 3 个路径"。失败重试比半成功好。

## Storage Layout

```
<uploadsDir>/
  <workspaceId>/
    <yyyy-mm-dd>/
      <uuid8>-<sanitizedOriginalName>
```

- `uuid8`：UUID v4 截前 8 字符做前缀，单 workspace 单日内冲突概率可忽略。
- `sanitizedOriginalName`：保留 `[a-zA-Z0-9._一-鿿 \-]`、其它替换为 `_`，超过 64 字符截断，空字符串退化为 `file`。
- 剪贴板截图无原始名时，按 mime 推扩展名后命名为 `screenshot-<HHmmss>.<ext>`。

### `uploadsDir` 解析

`packages/server/src/config.ts` 增加：

```ts
function resolveUploadsDir(override?: string): string {
  if (override) return override;
  if (process.env.NODE_ENV === 'test') {
    // 进程级 lazy 缓存：同一测试进程内 loadConfig 多次得到同一 temp 目录，
    // 不同进程互不干扰；afterAll 清理由测试自身负责。
    return getOrCreateTestUploadsDir();
  }
  if (process.env.NODE_ENV === 'development') {
    return path.join(os.tmpdir(), 'coder-studio-dev', 'uploads');
  }
  return path.join(os.homedir(), '.coder-studio', 'uploads');
}
```

- 受 `UPLOADS_DIR` 环境变量与 CLI `--uploads-dir` 参数覆盖（与 `dataDir` 同模式）。
- 测试模式每个进程一个 temp 目录，afterAll 清理由测试自身负责。
- 开发模式落到 `os.tmpdir()`，OS 重启即清，避免污染家目录。

## Cleanup Strategy

三层兜底，均同步实现，无后台调度：

| 层 | 触发 | 行为 |
|---|---|---|
| L1 级联删除 | `WorkspaceManager.delete(wsId)` 成功后 | `fs.rm(<uploadsDir>/<wsId>, { recursive: true, force: true })`；失败仅 log，不阻塞主流程 |
| L2 启动期 GC | server 启动后 5s 异步 | 遍历 `<uploadsDir>`，删 `mtime` 早于 `UPLOAD_TTL_HOURS=72` 的文件；空目录顺带回收 |
| L3 容量保护 | 每次批量写入完成后 + 启动期 | 单 workspace 桶超过 `UPLOAD_BUCKET_MAX_BYTES=200MB` 时，按 `mtime` 升序（最旧优先）删除文件直至合规；当前批刚写入的文件因 `mtime` 最新天然被保护 |

不入库的取舍：
- 上传文件是临时引用，不是一等公民数据。
- `mtime` 充当 last-touch 时间足以驱动 GC。
- 避免 schema migration、孤儿记录修复等额外复杂度。

阈值常量集中在 `packages/server/src/uploads/constants.ts`，v1 不开放给用户配置。

## Validation & Security

- **Workspace 绑定**：每次上传必须带 `workspaceId`，由 `WorkspaceManager.get` 校验存在；写入路径用 `path.join(uploadsDir, workspaceId, ...)`，进入前对 workspaceId 做 `^[a-zA-Z0-9_-]+$` 正则校验，杜绝 `..` / 路径分隔符注入。
- **文件名清洗**：见 Storage Layout，写入前做最终的 `path.normalize` + `startsWith(uploadsDir)` 断言（防御性二次校验）。
- **大小限制**：`@fastify/multipart` 注册时设 `limits: { fileSize: 50 * 1024 * 1024, files: 20 }`，超限直接报 413/400。
- **mime 不做白名单**：用户既然能本地访问该文件，agent 就有权读；服务端只是搬运。
- **CORS / CSRF**：复用现有同源 + cookie 认证模型，与 `/api/file` 一致。
- **路径回显安全**：返回的绝对路径仅服务端拼接产物，未经回路用户输入污染（原始文件名仅作为 sanitized 后的尾段）。

## Frontend Implementation Notes

- 在 `XtermHost` 容器 `<div>` 上绑定 capture-phase `paste` 与 `drop` 监听器：
  - `paste` 事件：检查 `event.clipboardData.files.length > 0` → `event.preventDefault()` 并接管；否则放行（xterm 处理纯文本粘贴）。
  - `drop` 事件：始终 `preventDefault`（避免浏览器默认下载/导航行为），文件非空时接管。
  - `dragover` 事件：`preventDefault` 启用 drop。
- 上传期间 `setBusy(true)`，禁用 xterm `onData` 透传 + 显示一个低饱和度 overlay（与现有 placeholder 风格统一）；完成或失败时 `setBusy(false)`。
- 路径注入：拼接 `paths.map(quoteShellSingle).join(' ')` + 末尾保留一个空格，调一次 `dispatchCommand('terminal.input', { id, data })`。
- 单引号转义：`/'/g` 替换为 `'\''`（POSIX 标准做法）。bash/zsh/fish/sh 均兼容；PowerShell 同样支持单引号但语义略不同——产品当前定位 Unix-like 终端（Windows 用户走 WSL），不为 PowerShell 做特殊处理。
- 失败提示：使用现有 toast / notification 系统（参考 `features/notifications`）。

## Server Implementation Notes

- 新增 `packages/server/src/routes/uploads.ts`，由 `app.ts` 在 `registerFileAssetRoutes` 之后注册。
- 新增 `packages/server/src/uploads/`：
  - `constants.ts`：阈值常量。
  - `paths.ts`：filename 清洗、bucket 路径生成。
  - `cleanup.ts`：`runStartupGc`、`deleteWorkspaceUploads`、`enforceBucketCap`。
- 注册 `@fastify/multipart` 插件（新增依赖；和 `@fastify/compress`、`@fastify/cors` 同级）。
- `WorkspaceManager` 增加 onDelete 钩子注入 `deleteWorkspaceUploads`（避免 manager 直接 import uploads 模块、保持依赖方向）。

## Testing

- **单元**：
  - `paths.ts` 文件名清洗（中文、空格、路径分隔符、超长、空名、控制字符）。
  - `cleanup.ts` GC 行为（mtime 边界、空目录回收、容量超限 LRU 顺序）。
  - shell 单引号转义函数。
- **集成**（`packages/server/src/__tests__/`）：
  - `POST /api/uploads` 单文件成功 → 文件落到正确桶、返回路径可读。
  - 多文件成功 / 超 20 个 / 单文件超 50MB / workspace 不存在 / 缺字段。
  - workspace 删除后 `<wsId>` 桶被清空。
  - 启动期 GC：预置过期 mtime 文件，启动后被删除。
  - 容量超限 LRU：预置满桶后再写一文件，触发淘汰。
- **前端**：
  - `xterm-host.test.tsx` 增加 `paste` / `drop` 接管路径的快照测试（mock fetch + dispatch，验证 dispatch payload）。

## Rollout

- 一次合入，无功能开关。
- 升级路径：用户首次使用前不需要做任何动作；目录在首次写入时按需创建。
- 风险点：multipart 体积上限错配（需在 fastify 与反向代理两处一致）。当前部署模式是 CLI 直接监听本地端口，无反向代理；后续若引入需同步调整。

## Open Questions

无（所有澄清问题已解决）。
