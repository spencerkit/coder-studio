# Shortcuts

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- 工作区导航快捷键。
- 命令面板快捷键入口。
- 设置页快捷键展示。
- Kbd UI primitive。

不覆盖：
- Monaco 编辑器内建快捷键。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| 全局快捷键 | Desktop | 打开命令面板或切换工作区视图。 |
| Settings Shortcuts | Desktop | 查看当前快捷键说明。 |
| Kbd 组件 | Internal | 展示快捷键标签。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| SHORTCUT-001 | 工作区导航快捷键 | Implemented | `use-workspace-navigation-shortcuts.ts` | `use-workspace-navigation-shortcuts.test.tsx` |
| SHORTCUT-002 | 设置页快捷键展示 | Implemented | `shortcuts-settings.tsx` | `shortcuts-settings.test.tsx` |
| SHORTCUT-003 | Kbd UI primitive | Implemented | `packages/web/src/components/ui/kbd` | `components/ui/kbd/index.test.tsx` |
| SHORTCUT-004 | 命令面板键盘交互 | Implemented | `command-palette.tsx` | `command-palette.test.tsx` |

## 4. 模块级验收线索

- 快捷键应在输入框聚焦时避免误触全局动作。
- 设置页展示的快捷键应与实际监听一致。
- 命令面板键盘交互应支持选择和确认。

## 5. 未确认项

- 是否支持用户自定义快捷键需在第二轮确认。
