# Work Analysis Remove Budget Module Design

Date: 2026-06-06
Status: Draft
Owner: Codex

## Problem

当前 `工作分析` 的预算能力已经形成一条完整链路：

- 前端存在独立的 `budgets` 页签和预算展示区
- 前端类型包含预算专用结构
- 后端协议同时在 `basicResult.budgets` 和 `snapshotV2.delivery.budgets` 暴露预算数据
- 后端 analyzer 和 metrics 层持续计算预算预测、阈值和目录预算
- server/web 测试持续维护预算 fixture 和断言

这和当前目标冲突。用户要求把 `工作分析总览额度预算模块功能整个去掉`，因此不能只隐藏页面，也不能保留后端空壳字段。

## Goal

把 `工作分析` 里的预算模块从前后端一起彻底移除，保证：

- UI 不再出现预算页签和预算区块
- 协议不再输出预算字段
- 后端不再进行预算计算
- 测试不再维护预算相关断言
- 仓库中不再保留工作分析预算模块的活跃实现链路

## Non-Goals

- 不重构 `yield`、`overview`、`compare` 等非预算分析能力
- 不调整深度分析产品形态
- 不保留“兼容旧字段但恒为空”的过渡层
- 不处理与工作分析无关的其他 `budget` 文案或系统预算概念

## Decision

采用硬删除方案，前后端同步收口。

不采用以下替代方案：

1. 只删前端展示
原因：后端仍会保留无用字段、计算和测试，功能没有真正移除。

2. 保留字段但返回空值
原因：协议语义变差，后续维护者仍要处理预算分支。

## Scope

本次删除范围包括以下层级。

### Frontend

- 删除 `packages/web/src/features/work-analysis/navigation.ts` 中的 `budgets` tab
- 删除 `packages/web/src/features/work-analysis/page.tsx` 中预算读取和预算 `TabPanel`
- 删除 `packages/web/src/features/work-analysis/types.ts` 中预算相关类型
- 删除中英文 locale 中工作分析预算文案

### Backend

- 删除 `packages/server/src/work-analysis/types.ts` 中预算相关类型和结果字段
- 删除 `packages/server/src/work-analysis/basic-schema.ts` 中预算 schema
- 删除 `packages/server/src/work-analysis/basic-analyzer.ts` 中预算汇总、预算投射和 `delivery.budgets` / `basicResult.budgets` 赋值
- 删除不再使用的 `packages/server/src/work-analysis/metrics/token-budgets.ts` 及其引用

### Tests

- 删除 server analyzer/service tests 中预算 fixture 和预算断言
- 删除 web page tests 中预算 fixture、tab 断言和预算渲染断言

## Post-Removal Shape

删除后，工作分析页面和协议继续保留这些主域：

- `overview`
- `tasks`
- `models`
- `optimize`
- `compare`
- `yield`
- `capabilities`
- `dataSources`

以下内容会彻底消失：

- `WORK_ANALYTICS_TABS` 中的 `budgets`
- 页面里的 `30 天预算预测`、`目标阈值`、`目录预算`
- `snapshotV2.delivery.budgets`
- `basicResult.budgets`
- `WorkAnalysisBudgetSummary`
- `WorkAnalysisBudgetTarget`
- `WorkAnalysisBudgetThreshold`
- 预算计算和预算专用测试数据

## Implementation Order

按以下顺序执行，优先删契约，再删消费方，避免留下半兼容状态。

1. 删除后端类型与 schema 中的预算结构和预算字段
2. 删除后端 analyzer 中预算计算与装配逻辑
3. 删除预算 metrics 文件及所有引用
4. 删除前端导航、页面和类型中的预算消费逻辑
5. 删除 locale 中预算文案
6. 更新 server/web tests，去除所有预算相关断言和 fixture

## Validation

完成后需要满足以下结果：

- `/settings?section=analysis` 正常加载
- 剩余 tab 可以正常切换和渲染
- 不再存在预算 tab
- server work-analysis tests 通过
- web work-analysis page tests 通过
- 搜索仓库后，不再有工作分析预算模块的实现引用

## Risks

主要风险只有一个：

- 预算字段同时存在于 legacy `basicResult` 与 `snapshotV2.delivery` 两套结构中，如果只删一侧，会造成类型、schema、fixture 与页面消费不同步

应对方式：

- 这次按前后端同步硬删除执行，不保留兼容层
- 修改后通过类型检查和定向测试验证剩余域仍能正常工作
