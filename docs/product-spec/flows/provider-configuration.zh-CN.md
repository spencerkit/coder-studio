# Provider Configuration Flow

> 第一轮流程索引。本文只记录跨模块路径、关联功能 ID 和验收入口。

## 1. 流程目标

描述用户在设置页查看 provider、编辑配置、检查 runtime status，并在 Agent pane 中使用 provider 的流程。

## 2. 参与模块

- Providers：`PROVIDER-001`、`PROVIDER-002`、`PROVIDER-003`、`PROVIDER-009`、`PROVIDER-010`
- Settings：`SETTINGS-004`、`SETTINGS-006`
- Diagnostics：`DIAG-003`、`DIAG-004`
- Agent Panes：`PANE-008`
- Agent Sessions：`SESSION-001`

## 3. 前置条件

- 应用已连接 server。
- 至少存在一个内置 provider 定义。

## 4. 主路径

| 步骤 | 用户行为 | 系统响应 | 关联功能 ID |
| --- | --- | --- | --- |
| 1 | 打开 Provider Settings | 展示 provider 列表和配置状态 | `PROVIDER-001`、`PROVIDER-010` |
| 2 | 查看 runtime status | 返回 provider 可用性 | `PROVIDER-002` |
| 3 | 编辑配置文件 | 读取或写入配置 | `SETTINGS-004` |
| 4 | 返回 workspace 启动 agent | 使用 provider 创建 session | `PANE-008`、`SESSION-001` |

## 5. 分支与错误路径

- Provider 未安装：关联 `PROVIDER-003` 或 `DIAG-004`。
- 使用自定义 provider：关联 `PROVIDER-009`。
- 配置文件写入失败：关联 `SETTINGS-004`。

## 6. 验收标准

- Given provider 配置有效
- When 用户从 draft launcher 创建 session
- Then 创建请求应使用该 provider
- And session 出现在工作区中

## 7. 自动化测试建议

- 覆盖 `packages/web/src/features/settings/components/provider-settings.test.tsx`。
- 覆盖 `packages/server/src/__tests__/provider-runtime/runtime-status.test.ts`。
