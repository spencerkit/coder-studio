# Search / Quick Open

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- Quick Open。
- Workspace search panel。
- 搜索结果预览和跳转。

不覆盖：
- 底层文件搜索实现细节，写入 Files。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Quick Open | Both | 快速搜索并打开文件。 |
| Search panel | Desktop | 搜索内容、预览搜索结果。 |
| Command palette command | Both | 可能触发搜索或打开入口。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| SEARCH-001 | Quick Open 组件 | Implemented | `packages/web/src/features/quick-open/components/quick-open.tsx` | `packages/web/src/features/quick-open/components/quick-open.test.tsx` |
| SEARCH-002 | Search panel 展示 | Implemented | `packages/web/src/features/workspace/views/shared/search-panel.tsx` | `packages/web/src/features/workspace/views/shared/search-panel.test.tsx` |
| SEARCH-003 | Search panel state | Implemented | `search-panel-state.ts` | `search-panel-state.test.ts` |
| SEARCH-004 | 搜索预览动作 | Implemented | `use-search-preview-actions.ts` | `use-search-preview-actions.test.tsx` |
| SEARCH-005 | 文件名搜索 command | Implemented | `file.search` | `packages/server/src/__tests__/file-commands.test.ts` |
| SEARCH-006 | 内容搜索 command | Implemented | `file.searchContent` | `packages/server/src/__tests__/fs/content-search.test.ts` |

## 4. 模块级验收线索

- Quick Open 输入关键字后应显示匹配文件。
- 选择搜索结果后应打开对应文件。
- 内容搜索应能展示匹配文件和预览。

## 5. 未确认项

- 搜索替换是否作为独立用户入口展示需在第二轮确认。
