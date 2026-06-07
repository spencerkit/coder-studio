# Desktop Acceptance

> 第一轮验收索引。本文只记录桌面端需要覆盖的模块级验收入口。

## 1. 目标

验证宽屏桌面工作台的多区域布局、键盘入口、文件/Git/终端/agent 工作流。

## 2. 验收清单

| ID | 验收项 | 关联功能 ID | 建议方式 |
| --- | --- | --- | --- |
| DESKTOP-001 | 桌面 shell 渲染 | `APP-003` | 组件测试 / e2e |
| DESKTOP-002 | 桌面 workspace 多区域布局 | `WSD-001`、`WSD-003` | e2e / 截图 |
| DESKTOP-003 | workspace tab 切换 | `WSL-001` | 组件测试 / e2e |
| DESKTOP-004 | session mini map 展示 | `WSL-002` | 组件测试 |
| DESKTOP-005 | activity bar 切换面板 | `WSD-002` | e2e / 手工 |
| DESKTOP-006 | agent panes 渲染和 draft launcher | `PANE-001`、`PANE-004` | 组件测试 / e2e |
| DESKTOP-007 | Git panel 操作 | `GIT-001` 到 `GIT-006` | 单测 / 手工 |
| DESKTOP-008 | Terminal panel 操作 | `TERM-001` 到 `TERM-006` | 单测 / e2e |
| DESKTOP-009 | 快捷键和命令面板 | `SHORTCUT-001`、`CMD-001` | 组件测试 / 手工 |
| DESKTOP-010 | 全屏和布局持久化 | `WSL-003`、`WSL-005` | 组件测试 / 手工 |

## 3. 未确认项

- 桌面端截图验收标准需在 UI 规格轮补充。
