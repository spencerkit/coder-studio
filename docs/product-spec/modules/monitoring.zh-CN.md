# Monitoring

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- 监控页面、指标展示、sparkline。
- monitoring get/recheck。
- 服务端监控 aggregation、history、host collector、process table。

不覆盖：
- Work Analysis 统计和归因。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Monitoring page | Both | 查看运行时监控信息。 |
| Monitoring settings | Both | 配置监控选项。 |
| Recheck action | Both | 重新采集监控状态。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| MON-001 | Monitoring page 渲染 | Implemented | `packages/web/src/features/monitoring/page.tsx` | `packages/web/src/features/monitoring/page.test.tsx` |
| MON-002 | 指标格式化 | Implemented | `formatters.ts` | `packages/web/src/features/monitoring/page.test.tsx` |
| MON-003 | sparkline 展示 | Implemented | `sparkline.tsx` | `packages/web/src/features/monitoring/page.test.tsx` |
| MON-004 | monitoring get/recheck | Implemented | `monitoring.get`、`monitoring.recheck` | `packages/server/src/__tests__/monitoring/commands.test.ts` |
| MON-005 | monitoring aggregation/history | Internal | `packages/server/src/monitoring` | `aggregation.test.ts`、`history-store.test.ts` |
| MON-006 | host collector | Internal | `packages/server/src/monitoring` | `host-collector.test.ts` |
| MON-007 | managed process registry / process table | Internal | `packages/server/src/monitoring/process-table` | `managed-process-registry.test.ts`、`process-table.test.ts` |

## 4. 模块级验收线索

- 监控页能展示当前采样数据。
- Recheck 后页面数据应刷新。
- 无监控数据时应有空态或降级展示。

## 5. 未确认项

- 监控页的路由入口和设置入口需在第二轮确认。
