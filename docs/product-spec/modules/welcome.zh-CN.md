# Welcome

> 当前代码基线。本文只记录当前已接线、用户可达的欢迎页能力。

## 1. 模块范围

覆盖：
- 欢迎页首屏内容。
- 从欢迎页打开 workspace 启动器。
- 两步式工作流说明与支撑能力列表。

不覆盖：
- 登录与 session gate。
- workspace 启动器内部的目录浏览、创建目录和打开目录流程。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| `/` | Both | 没有可进入 workspace 时的默认首屏入口。 |
| 欢迎页“打开工作区”按钮 | Both | 打开 `WorkspaceLaunchModal`。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| WELCOME-001 | 欢迎页渲染 | Implemented | `packages/web/src/features/welcome/index.tsx` | `packages/web/src/features/welcome/index.test.tsx` |
| WELCOME-002 | 从欢迎页打开 workspace 启动器 | Implemented | `packages/web/src/features/welcome/index.tsx`、`packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx` | `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx` |
| WELCOME-003 | 两步式工作流与支撑能力说明 | Implemented | `packages/web/src/features/welcome/index.tsx` | `packages/web/src/features/welcome/index.test.tsx` |

## 4. 当前页面事实

- 欢迎页当前是两步式落地页，不是旧版“三张功能卡 + 设置次按钮”结构。
- 首屏当前只有一个主要交互入口：`打开工作区`。
- 支撑能力说明当前只有两项：
  - `Git tools`
  - `terminals`
- 当前欢迎页没有可达的设置按钮，也不会直接跳转 `/settings`。

## 5. 模块级验收线索

- 当 workspace 列表为空时访问 `/`，页面应渲染欢迎页。
- 点击“打开工作区”后应打开 workspace 启动器，而不是跳转到系统文件选择器。
- 页面下方的支撑能力列表应只显示 Git 与终端两项。
