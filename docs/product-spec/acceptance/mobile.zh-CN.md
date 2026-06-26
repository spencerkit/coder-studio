# Mobile Acceptance

> 第一轮验收索引。本文只记录移动端需要覆盖的模块级验收入口。

## 1. 目标

验证移动端工作区主区、Sheet / Drawer、状态栏和移动端终端输入能力。

## 2. 验收清单

| ID | 验收项 | 关联功能 ID | 建议方式 |
| --- | --- | --- | --- |
| MOBILE-001 | 移动 shell 渲染 | `APP-004` | 组件测试 / e2e |
| MOBILE-002 | 移动工作区整体渲染 | `WSM-001` | 组件测试 / e2e |
| MOBILE-003 | 移动端当前会话主区与状态栏 | `WSM-003` | 组件测试 / 手工 |
| MOBILE-004 | Agent Sheet | `WSM-004` | 组件测试 |
| MOBILE-005 | Files Sheet | `WSM-005` | 组件测试 |
| MOBILE-006 | Workspace Drawer | `WSM-008` | 组件测试 |
| MOBILE-007 | Mobile Terminal soft keys | `TERM-009` | 组件测试 / 手工 |
| MOBILE-008 | Mobile long press copy line | `TERM-010` | 单测 / 手工 |
| MOBILE-009 | Mobile Supervisor Sheet | `SUP-008` | 组件测试 |
| MOBILE-010 | 移动端连接状态 | `APP-005`、`WSM-002` | 手工 |

## 3. 未确认项

- 真实移动浏览器软键盘和 visual viewport 行为需设备验收。
