# Startup and Auth Flow

> 第一轮流程索引。本文只记录跨模块路径、关联功能 ID 和验收入口。

## 1. 流程目标

描述应用启动后从认证检查、WebSocket 连接、workspace 恢复到默认页面选择的主路径。

## 2. 参与模块

- App Shell：`APP-001`、`APP-002`、`APP-005`、`APP-006`
- Auth：`AUTH-001`、`AUTH-002`、`AUTH-003`
- Workspace：`WS-001`、`WS-007`
- Welcome：`WELCOME-001`

## 3. 前置条件

- 服务端已启动。
- 浏览器可访问 web 前端。
- 认证可能开启或关闭。

## 4. 主路径

| 步骤 | 用户行为 | 系统响应 | 关联功能 ID |
| --- | --- | --- | --- |
| 1 | 打开应用 | 初始化 providers 和 session gate | `APP-001`、`AUTH-001` |
| 2 | 认证已通过或未开启认证 | 建立 WebSocket 连接 | `AUTH-003`、`APP-002` |
| 3 | 连接成功 | 拉取 workspace 列表 | `WS-001` |
| 4 | 有 workspace | 进入或停留在工作区 | `WS-007` |
| 5 | 无 workspace | 展示欢迎页 | `WELCOME-001` |

## 5. 分支与错误路径

- 未认证：进入登录页，关联 `AUTH-002`。
- WebSocket 断开：展示连接状态横幅，关联 `APP-005`。
- 非活动标签页：server dispatch 返回 `activation_required`，关联 `APP-006`。
- workspace 拉取失败：工作区页展示错误态，关联 `WS-007`。

## 6. 验收标准

- Given 服务端未开启认证
- When 用户打开应用
- Then 应用应建立连接并进入欢迎页或工作区

- Given 服务端开启认证且用户未登录
- When 用户打开应用
- Then 应用应展示登录页

## 7. 自动化测试建议

- 覆盖 `packages/web/src/features/auth/session-gate.test.tsx`。
- 覆盖 `packages/web/src/app/providers.test.tsx`。
- 增加 e2e 冒烟：未认证、已认证、有 workspace、无 workspace 四种入口。
