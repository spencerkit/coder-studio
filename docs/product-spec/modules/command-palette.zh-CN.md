# Command Palette

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- 命令面板入口、展示、过滤和键盘交互。

不覆盖：
- 每个命令背后的业务功能。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Command Palette | Both | 展示可执行命令。 |
| 快捷键入口 | Desktop | 通过全局快捷键打开命令面板。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| CMD-001 | 命令面板主入口 | Implemented | `packages/web/src/features/command-palette/index.tsx` | `packages/web/src/features/command-palette/components/command-palette.test.tsx` |
| CMD-002 | 命令列表展示和过滤 | Implemented | `components/command-palette.tsx` | `command-palette.test.tsx` |
| CMD-003 | 命令键盘交互 | Implemented | `components/command-palette.tsx` | `command-palette.test.tsx` |

## 4. 模块级验收线索

- 打开命令面板后能搜索命令。
- 键盘上下选择和确认执行应可用。
- 空搜索结果应有可理解状态。

## 5. 未确认项

- 当前注册命令集合需在第二轮从 UI 状态和 shortcut 入口完整列出。
