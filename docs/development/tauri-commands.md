# Tauri 命令清单

[English](tauri-commands.en.md)

本文档整理当前 Tauri 命令、调用路径，以及它们在现有产品中的使用范围。

## 1. 调用路径

当前前端并不是只依赖 Tauri `invoke`。

实际顺序是：

1. 优先通过 HTTP RPC 调用 `/api/rpc/:command`
2. 如果 HTTP 不可用，再回退到 `@tauri-apps/api/core.invoke`

相关代码：

- 前端 RPC 客户端：`apps/web/src/services/http/client.ts`
- 后端命令分发：`apps/server/src/command/http.rs`
- Tauri 注册列表：`apps/server/src/main.rs`

流式事件不走 RPC 返回值，而走 WebSocket：

- `agent://event`
- `agent://lifecycle`
- `terminal://event`

## 2. 命令分组总览

当前注册的命令可以分成 6 组：

- 工作区与 session
- Git 与 worktree
- 文件与文件系统
- 系统与运行时探测
- 终端
- Agent

## 3. 工作区与 Session

| 命令 | 作用 | 当前 UI 使用情况 |
| --- | --- | --- |
| `init_workspace` | 初始化工作区，clone 远程仓库或解析本地 Git 根目录 | 已使用 |
| `tab_snapshot` | 获取某个 tab 的后端快照 | 已使用 |
| `create_session` | 创建正式 session | 已使用 |
| `session_update` | 更新 session 状态、mode、auto_feed、活跃时间、Claude session ID | 已使用 |
| `switch_session` | 切换当前活跃 session | 已使用 |
| `archive_session` | 归档 session 并结束其 Agent runtime | 已使用 |
| `update_idle_policy` | 更新 tab 的 idle policy | 已使用 |
| `queue_add` | 添加队列任务 | 后端有，当前主 UI 未完整开放 |
| `queue_run` | 运行指定队列任务 | 后端有，当前主 UI 未完整开放 |
| `queue_complete` | 完成指定队列任务 | 后端有，当前主 UI 未完整开放 |
| `worktree_inspect` | 获取某个 worktree 的详情、diff、tree | 已使用，主要用于 modal |

说明：

- `queue_*` 命令说明后端仍保留任务队列能力，但当前主界面没有完整队列面板。
- `archive_session` 已接入实际关闭 Pane 时的后端归档逻辑。

## 4. Git 与 Worktree

| 命令 | 作用 | 当前 UI 使用情况 |
| --- | --- | --- |
| `git_status` | 获取分支、改动数量、最近提交 | 已使用 |
| `git_diff` | 获取全局 diff | 已使用 |
| `git_changes` | 获取 Git 状态分组列表 | 已使用 |
| `git_diff_file` | 获取单文件 diff 文本 | 已使用，作为回退路径 |
| `git_file_diff_payload` | 获取结构化单文件 diff 载荷 | 已使用 |
| `git_stage_all` | 全量 stage | 已使用 |
| `git_stage_file` | 单文件 stage | 已使用 |
| `git_unstage_all` | 全量 unstage | 已使用 |
| `git_unstage_file` | 单文件 unstage | 已使用 |
| `git_discard_all` | 丢弃所有改动 | 已使用 |
| `git_discard_file` | 丢弃单文件改动 | 已使用 |
| `git_commit` | 提交 commit | 已使用 |
| `worktree_list` | 列出 worktree | 已使用于刷新数据，但主 UI 入口不完整 |

说明：

- `worktree_list` 的数据会被前端刷新进状态，但当前界面里缺少明确的 worktree 列表入口。
- `git_file_diff_payload` 是当前单文件结构化 Diff 体验的关键命令。

## 5. 文件与文件系统

| 命令 | 作用 | 当前 UI 使用情况 |
| --- | --- | --- |
| `workspace_tree` | 生成仓库文件树和改动树 | 已使用 |
| `file_preview` | 读取文件内容用于预览 | 已使用 |
| `file_save` | 保存文件 | 已使用 |
| `filesystem_roots` | 获取可浏览根目录 | 间接使用 |
| `filesystem_list` | 浏览服务端目录 | 已使用 |
| `dialog_pick_folder` | 打开系统目录选择对话框 | 当前主流程未明显使用 |

说明：

- 当前本地目录选择主流程依赖 `filesystem_list` 驱动的服务端目录浏览器。
- `dialog_pick_folder` 虽然存在，但不是当前 onboarding 主路径。

## 6. 系统与运行时探测

| 命令 | 作用 | 当前 UI 使用情况 |
| --- | --- | --- |
| `command_exists` | 校验 Launch Command 是否可执行 | 已使用 |
| `claude_slash_skills` | 扫描 Claude skills / commands | 已使用于数据加载，但菜单 UI 当前不完整可见 |

说明：

- `command_exists` 对设置页很重要，用来告诉用户当前 runtime 里命令是否可用。
- `claude_slash_skills` 会扫描 personal/project 级 `.claude` 目录。

## 7. 终端命令

| 命令 | 作用 | 当前 UI 使用情况 |
| --- | --- | --- |
| `terminal_create` | 创建一个新的 shell PTY | 已使用 |
| `terminal_write` | 写入终端输入 | 已使用 |
| `terminal_resize` | 同步终端尺寸 | 已使用 |
| `terminal_close` | 关闭终端并清理 runtime | 已使用 |

输出事件：

- `terminal://event`

## 8. Agent 命令

| 命令 | 作用 | 当前 UI 使用情况 |
| --- | --- | --- |
| `agent_start` | 启动 Agent PTY，并在 Claude 模式下注入 hook 配置 | 已使用 |
| `agent_send` | 向 Agent 写入输入 | 已使用 |
| `agent_stop` | 停止 Agent runtime | 已使用 |
| `agent_resize` | 同步 Agent PTY 尺寸 | 已使用 |

相关事件：

- `agent://event`
- `agent://lifecycle`

## 9. 事件通道

| 事件名 | 含义 |
| --- | --- |
| `agent://event` | Agent 输出流、系统提示、退出事件 |
| `agent://lifecycle` | Claude hook 归一化后的生命周期事件 |
| `terminal://event` | 内置终端输出流 |

其中 `agent://lifecycle` 当前会承载这些 kind：

- `session_started`
- `turn_waiting`
- `tool_started`
- `tool_finished`
- `approval_required`
- `turn_completed`
- `session_ended`

## 10. 文档使用原则

在写功能说明时，应该这样理解命令层能力：

- 命令存在，不代表 UI 已完整开放
- 命令被前端调用，也不代表用户有明确入口能持续使用
- 真正的“已交付能力”必须同时满足：后端命令存在、前端状态接住、主界面有稳定入口
