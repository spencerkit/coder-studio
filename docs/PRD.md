# Agent Workbench PRD (完整版)

版本：2026-03-12  
状态：已整合所有当前原型功能

## Overview
Agent Workbench 是一个桌面端工作台，融合 AI Agent（Claude Code / Codex CLI）、Git 管理与文件管理，支持多项目、多会话、多终端以及任务编排。目标是把“项目初始化 → Agent 执行 → Git 变化 → 文件预览 → 终端操作 → 会话并行”统一在一个桌面体验中。

## Goals
1. 提供一个可并行运行多 Agent 会话的工作台。
2. 提供可控的任务队列与自动投喂能力。
3. 提供 Git 与 worktree 的会话级切换与可视化。
4. 在高并发会话下保持稳定资源与性能（空闲卸载与进程池）。
5. 提供可追溯的归档与审计能力。

## Non-Goals
1. 不做云端协作（当前版本仅本地）。
2. 不做完整 IDE（仅文件预览与终端）。
3. 不实现复杂权限体系。

## Personas
1. 独立开发者：希望在一个工具内同时调度多 Agent 任务。
2. 技术负责人：需要追踪会话状态与变更，控制资源消耗。

## User Journey
1. 用户首次打开 App → 初始化工作台。
2. 选择远程或本地项目。
3. 进入主界面 → 默认 Session 启动。
4. 新建 Session → 新会话变为焦点，旧会话继续后台执行。
5. 任务完成 → Auto-feed 投喂或等待用户输入。
6. 发生空闲 → Session 自动卸载（策略驱动）。
7. Session 归档 → 进入归档日志与只读回放。

## Functional Requirements

### Project & Tabs
1. 支持多 Tab，每个 Tab 独立一个工作区与会话集合。
2. 远程项目可粘贴 Git 地址，拉取到临时工作区（可配置）。
3. 本地项目可选择目录作为工作区。

### Sessions
1. 支持新建 Session。
2. Session 切换时：Agent 输出、队列、Git 信息随 Session 切换。
3. Session 状态：`running` / `background` / `waiting` / `suspended` / `queued`。
4. Session 工作方式：`Branch` 或 `Git Tree`。

### Task Queue (Per Session)
1. 每个 Session 维护独立队列。
2. 队列支持添加、排序、立即执行、删除。
3. Auto-feed：任务完成后自动投喂下一条。

### Git & Worktree (Per Session)
1. Branch 模式显示主分支信息。
2. Git Tree 模式显示 session worktree 信息。
3. Worktree 列表可点击查看 `Status / Diff / Tree`。

### File Preview & Diff
1. Preview 模式显示文件内容。
2. Diff 模式显示 session diff。
3. Diff 模式支持文件 chips 快速切换。
4. Diff 统计显示 files / + / -。

### Terminal
1. 支持多终端实例。
2. 可新增、关闭、切换。

### Notifications
1. Session 后台完成 → toast 提示。
2. toast 可点击跳转到 session。
3. Session 列表显示 unread badge。

### Archive
1. Session 可归档（`ARCH` 按钮）。
2. 归档后从 UI 与进程移除。
3. 写入 Archive Log。
4. Archive Log 可进入只读回放模式。
5. 只读回放中禁用所有操作，显示 archive banner。

### Performance & Resource Policy
1. Idle Policy 配置：
- `Auto-suspend idle`
- `Idle after`
- `Max active`
- `Memory pressure`
2. 空闲超时自动挂起。
3. 超过进程池上限时新 session 进入 `queued`。
4. 资源释放后 `queued` 自动激活。

## State Model

### Session State
1. `running`: 正在执行任务。
2. `background`: 后台执行，当前非焦点。
3. `waiting`: 任务完成，等待用户输入。
4. `suspended`: 空闲卸载，释放资源。
5. `queued`: 资源不足，等待激活。

## Data Model (概念级)

### Tab
- `project`
- `gitBase`
- `sessions[]`
- `activeSessionId`
- `autoSuspendIdle`
- `idlePolicy`
- `archiveLog[]`
- `archivedView`
- `worktreeView`

### Session
- `id`
- `status`
- `mode`
- `git`
- `queue[]`
- `agentMessages[]`
- `changes[]`
- `diffs{}`
- `worktrees[]`
- `events[]`
- `lastActiveAt`

## Non-Functional Requirements
1. Tab 切换 < 200ms。
2. Session 切换 < 200ms。
3. 多会话仍保证 UI 流畅。
4. 本地执行，代码不外传。

## Telemetry & Analytics (MVP)
1. Session 创建数
2. 任务完成率
3. Auto-suspend 触发次数
4. Archive 使用次数

## Risks
1. 多 Session 并行导致进程管理复杂。
2. Worktree 模式可能引入路径/权限问题。
3. Idle Policy 易造成用户误感知（需合理默认值）。

## Acceptance Criteria (关键验收)
1. 新建 Session → 旧 Session 不中断。
2. Session 切换 → Queue/Git/Agent 同步切换。
3. Auto-feed 在 Session 结束后自动触发下一任务。
4. 超过 Max active 时 Session 进入 `queued`。
5. Idle after 超时 → `suspended`。
6. Archive 后 session 彻底消失且进入 Archive Log。
7. Archive View 只读不可操作。
8. Worktree 详情页可查看 Status/Diff/Tree。

## Milestones
1. MVP（多 Tab + Session + Queue + Git）
2. Performance Policy（idle suspend + pool limit）
3. Archive & Replay（只读回放）
4. Worktree 详情页与 Diff 增强
