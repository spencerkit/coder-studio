# Open Workspace Flow

> 第一轮流程索引。本文只记录跨模块路径、关联功能 ID 和验收入口。

## 1. 流程目标

描述用户从欢迎页或工作区入口浏览目录、创建目录、打开 workspace 并进入工作区的流程。

## 2. 参与模块

- Welcome：`WELCOME-002`
- Workspace：`WS-002`、`WS-003`、`WS-004`、`WS-008`
- Workspace Tabs / Layout：`WSL-006`
- Files：`FILE-001`

## 3. 前置条件

- 应用已连接 server。
- 用户已通过认证或认证未开启。

## 4. 主路径

| 步骤 | 用户行为 | 系统响应 | 关联功能 ID |
| --- | --- | --- | --- |
| 1 | 点击打开工作区 | 打开 workspace launch modal | `WELCOME-002` |
| 2 | 浏览目录 | 返回当前路径、父路径、目录列表和根路径 | `WS-002` |
| 3 | 选择目录并确认 | server 打开 workspace | `WS-004` |
| 4 | 打开成功 | workspace 成为 active，并进入 `/workspace` | `WS-004`、`WSL-006` |
| 5 | 工作区加载 | 文件树和相关状态开始加载 | `FILE-001` |

## 5. 分支与错误路径

- 用户在启动器中创建目录：关联 `WS-003`。
- 打开最近 workspace：关联 `WS-008`。
- 路径不可访问：启动器展示错误。
- 已打开同一路径：应切换或复用已有 workspace，具体行为在第二轮确认。

## 6. 验收标准

- Given 当前没有打开 workspace
- When 用户选择一个有效目录并确认
- Then 应用进入工作区
- And active workspace 指向该目录

## 7. 自动化测试建议

- 覆盖 `packages/web/src/features/workspace/actions/use-workspace-launch-actions.test.tsx`。
- 增加 e2e：从欢迎页打开 workspace。
