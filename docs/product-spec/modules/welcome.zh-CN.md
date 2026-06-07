# Welcome

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- 欢迎页。
- 打开工作区入口。
- 设置入口。

不覆盖：
- 工作区目录浏览和打开后的状态更新，写入 Workspace 模块。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| `/` | Both | 默认欢迎入口或无 workspace 时的回退页面。 |
| 欢迎页打开工作区按钮 | Both | 打开 workspace launch modal。 |
| 欢迎页设置按钮 | Both | 进入设置页。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| WELCOME-001 | 欢迎页渲染 | Implemented | `packages/web/src/features/welcome/index.tsx` | `packages/web/src/features/welcome/index.test.tsx` |
| WELCOME-002 | 从欢迎页打开工作区启动器 | Implemented | `packages/web/src/features/welcome/index.tsx`、`packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx` | `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx` |
| WELCOME-003 | 从欢迎页进入设置页 | Implemented | `packages/web/src/features/welcome/index.tsx` | `packages/web/src/features/welcome/index.test.tsx` |

## 4. 模块级验收线索

- 无 workspace 时访问首页能看到欢迎页。
- 点击打开工作区应显示目录浏览入口。
- 点击设置应进入设置页。

## 5. 未确认项

- 欢迎页文案和视觉信息不在第一轮索引中验收，后续可在 UI/文案规格中细化。
