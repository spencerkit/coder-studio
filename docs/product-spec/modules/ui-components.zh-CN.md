# UI Components

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- `packages/web/src/components/ui` 下的可复用 UI 原语。
- 组件 README 和单测覆盖。

不覆盖：
- 具体业务页面的组合逻辑。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| 业务页面引用 | Internal | UI primitive 被业务模块组合使用。 |
| UI preview | Internal | 组件预览或设计验证。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| UI-001 | Button / IconButton | Implemented | `components/ui/button`、`icon-button` | `button/index.test.tsx`、`icon-button/index.test.tsx` |
| UI-002 | Input / Textarea / Select / Switch | Implemented | `components/ui/input`、`textarea`、`select`、`switch` | 对应 `index.test.tsx` |
| UI-003 | Modal / Drawer / Sheet / ConfirmDialog | Implemented | `components/ui/modal`、`drawer`、`sheet`、`confirm-dialog` | 对应 `index.test.tsx` |
| UI-004 | Popover / Tooltip / ActionMenu / LocalOverlay | Implemented | `components/ui/popover`、`tooltip`、`action-menu`、`local-overlay` | 对应 `index.test.tsx` |
| UI-005 | Badge / Tag / Pill / Notice / EmptyState | Implemented | `components/ui/badge`、`tag`、`pill`、`notice`、`empty-state` | 对应测试文件 |
| UI-006 | Tabs / SegmentedControl | Implemented | `components/ui/tabs`、`segmented-control` | 对应测试文件 |
| UI-007 | Spinner / ProgressBar / StatusDot | Implemented | `components/ui/spinner`、`progress-bar`、`status-dot` | 对应测试文件 |
| UI-008 | Toast / ThemedIcon / WorkbenchLayer | Implemented | `components/ui/toast`、`themed-icon`、`workbench-layer` | 对应测试文件 |
| UI-009 | DateTimePicker | Implemented | `components/ui/datetime-picker` | `datetime-picker/index.test.tsx` |
| UI-010 | 内部 portal、focus trap、body scroll lock | Internal | `components/ui/_internal` | `_internal/use-viewport.test.tsx` |

## 4. 模块级验收线索

- 每个 primitive 应通过对应组件单测。
- Overlay 类组件应处理焦点、关闭和滚动锁定。
- 表单类组件应支持禁用、错误和键盘交互。

## 5. 未确认项

- UI preview 覆盖范围需在第二轮结合 `packages/web/src/ui-preview` 确认。
