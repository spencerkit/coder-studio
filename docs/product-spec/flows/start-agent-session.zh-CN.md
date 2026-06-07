# Start Agent Session Flow

> 第一轮流程索引。本文只记录跨模块路径、关联功能 ID 和验收入口。

## 1. 流程目标

描述用户从 Agent pane 选择 provider、创建 session、查看输出并继续输入 prompt 的流程。

## 2. 参与模块

- Agent Panes：`PANE-001`、`PANE-004`、`PANE-008`
- Providers：`PROVIDER-001`、`PROVIDER-002`
- Agent Sessions：`SESSION-001`、`SESSION-002`、`SESSION-005`
- Terminal：`TERM-003`、`TERM-006`

## 3. 前置条件

- 已打开 workspace。
- 至少一个 provider 可用或可配置。

## 4. 主路径

| 步骤 | 用户行为 | 系统响应 | 关联功能 ID |
| --- | --- | --- | --- |
| 1 | 打开 Agent pane | 展示 draft launcher 或 session card | `PANE-001`、`PANE-004` |
| 2 | 选择 provider 并提交 prompt | 创建 session | `PANE-008`、`SESSION-001` |
| 3 | session 创建成功 | session 出现在 pane 中 | `SESSION-002` |
| 4 | provider 输出内容 | terminal 或 session card 展示输出 | `TERM-006` |
| 5 | 用户继续输入 prompt | 通过 terminal input 发送内容 | `SESSION-005`、`TERM-003` |

## 5. 分支与错误路径

- Provider 不可用：关联 `PROVIDER-002`。
- 用户停止 session：关联 `SESSION-003`。
- 用户关闭或移除 session：关联 `SESSION-004`。
- 终端 replay 失败：关联 `TERM-006`。

## 6. 验收标准

- Given 已打开 workspace 且 provider 可用
- When 用户提交一个 agent prompt
- Then 系统创建 session
- And session pane 显示该 session
- And 用户能看到运行输出或状态

## 7. 自动化测试建议

- 覆盖 `packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx`。
- 覆盖 `packages/server/src/__tests__/session-commands.test.ts`。
- e2e 使用 mock provider 或可控 provider runtime。
