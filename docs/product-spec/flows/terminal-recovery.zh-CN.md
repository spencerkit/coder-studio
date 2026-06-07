# Terminal Recovery Flow

> 第一轮流程索引。本文只记录跨模块路径、关联功能 ID 和验收入口。

## 1. 流程目标

描述终端创建、输出、快照、replay 和页面恢复流程。

## 2. 参与模块

- Terminal：`TERM-001` 到 `TERM-008`
- App Shell：`APP-002`
- Workspace：`WS-004`

## 3. 前置条件

- 已打开 workspace。
- WebSocket 连接可用。

## 4. 主路径

| 步骤 | 用户行为 | 系统响应 | 关联功能 ID |
| --- | --- | --- | --- |
| 1 | 打开 terminal panel | 拉取 terminal 列表 | `TERM-001` |
| 2 | 创建 shell terminal | server 创建 PTY 并广播 created | `TERM-002` |
| 3 | 输入命令 | terminal 输出更新 | `TERM-003` |
| 4 | 刷新页面或重连 | 通过 snapshot/replay 恢复输出 | `TERM-006`、`APP-002` |

## 5. 分支与错误路径

- terminal resize：关联 `TERM-004`。
- terminal close：关联 `TERM-005`。
- theme sync：关联 `TERM-008`。
- recovery coordinator：关联 `TERM-007`。

## 6. 验收标准

- Given 已创建 shell terminal 并有输出
- When 用户刷新页面
- Then terminal panel 应恢复 terminal 列表
- And 可看到 replay 后的历史输出

## 7. 自动化测试建议

- 覆盖 `packages/web/src/features/terminal-panel/__tests__/recovery-coordinator.test.ts`。
- 覆盖 `packages/server/src/__tests__/terminal-ring-buffer-tail.test.ts`。
