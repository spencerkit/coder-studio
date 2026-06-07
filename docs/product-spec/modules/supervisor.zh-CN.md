# Supervisor

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- Supervisor 创建、列表、详情、更新、暂停、恢复、触发、删除、restore。
- 桌面组件和移动端 Supervisor Sheet。

不覆盖：
- Provider 内部执行策略。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Supervisor panel/card | Desktop | 查看和管理 supervisor。 |
| Mobile Supervisor Sheet | Mobile | 移动端查看 supervisor 状态和详情。 |
| Objective dialog | Both | 创建或编辑目标。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| SUP-001 | 创建 supervisor | Implemented | `supervisor.create`、`packages/web/src/features/supervisor/actions/use-supervisor-actions.ts` | `packages/server/src/__tests__/supervisor-commands.test.ts` |
| SUP-002 | 获取/列表 supervisor | Implemented | `supervisor.get`、`packages/web/src/features/supervisor/actions/use-supervisor.ts` | `packages/server/src/__tests__/supervisor-commands.test.ts` |
| SUP-003 | 更新 supervisor objective | Implemented | `supervisor.update`、`objective-dialog-content.tsx` | `packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx` |
| SUP-004 | 暂停/恢复/触发 supervisor | Implemented | `supervisor.pause`、`resume`、`trigger` | `packages/server/src/__tests__/supervisor-commands.test.ts` |
| SUP-005 | 删除 supervisor | Implemented | `supervisor.delete` | `packages/server/src/__tests__/supervisor-commands.test.ts` |
| SUP-006 | restore supervisor | Implemented | `supervisor.restore`、`supervisor.listRecoverableTargets` | `packages/server/src/__tests__/supervisor-hydrate-restart.test.ts` |
| SUP-007 | 桌面 supervisor card/details | Implemented | `packages/web/src/features/supervisor/views/shared` | `packages/web/src/features/supervisor/views/shared/supervisor-details-content.test.tsx` |
| SUP-008 | 移动端 supervisor sheet | Implemented | `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx` | `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx` |

## 4. 模块级验收线索

- 创建 supervisor 后应出现在列表。
- 暂停、恢复和触发应更新状态。
- 移动端 sheet 能进入详情层。

## 5. 功能点规格

### SUP-001 创建 supervisor

状态：`Implemented`

用户行为：
- 用户在某个 agent session 上启用 Supervisor，填写 objective、评估 provider、可选 model、最大监督次数和计划时间。

系统响应：
- 前端打开 enable dialog，并维护 draft 表单。
- 确认时调用 `supervisor.create`，传入 sessionId、workspaceId、objective、evaluatorProviderId、可选 evaluatorModel、maxSupervisionCount、scheduledAt。
- 服务端创建 supervisor，并返回 supervisor 对象。
- 创建成功后关闭弹窗。

状态与边界：
- Validation：objective trim 后必须 1-4000 字符。
- Evaluator model：trim 后为空则不传。
- Max count：必须是非负整数；`0` 表示无上限。
- Scheduled：为空则不传；有值时传毫秒时间戳。

验收标准：
- Given 当前 session 尚未启用 Supervisor
- When 用户填写 objective 并确认启用
- Then 前端调用 `supervisor.create`
- And 创建成功后弹窗关闭
- And 该 session 显示 Supervisor 状态

代码索引：
- `packages/server/src/commands/supervisor.ts`
- `packages/web/src/features/supervisor/actions/use-objective-dialog-state.ts`
- `packages/web/src/features/supervisor/actions/use-supervisor-actions.ts`

### SUP-002 获取/列表 supervisor

状态：`Implemented`

用户行为：
- 用户查看 session 的 Supervisor 卡片或详情。

系统响应：
- 前端通过 `supervisor.get` 查询 session 对应 supervisor。
- 服务端按 sessionId 返回 supervisor 或 null。
- 前端根据 supervisor state 渲染 inactive、idle、evaluating、injecting、paused、error、stopped 等状态。

状态与边界：
- Null：没有 supervisor 时显示未启用入口。
- Busy：`evaluating` 或 `injecting` 被视为 busy。
- Error：action error 在前端保留 6 秒后清理。

验收标准：
- Given session 已有 state 为 `paused` 的 supervisor
- When UI 加载该 session 的 Supervisor 卡片
- Then 卡片显示 paused 状态
- And 提供 resume 操作

代码索引：
- `packages/server/src/commands/supervisor.ts`
- `packages/web/src/features/supervisor/actions/use-supervisor.ts`
- `packages/web/src/features/supervisor/actions/use-supervisor-actions.ts`

### SUP-003 更新 supervisor objective

状态：`Implemented`

用户行为：
- 用户编辑已有 supervisor 的 objective、评估 provider、model、最大监督次数或计划时间。

系统响应：
- 前端 edit dialog 以当前 supervisor 字段作为初始值。
- 确认时调用 `supervisor.update`，传入 supervisor id 和变更字段。
- 服务端要求至少一个可更新字段存在。
- 更新成功后关闭弹窗，可返回详情层。

状态与边界：
- Validation：objective 仍需 1-4000 字符。
- Model clearing：model 清空时传 `null`。
- Scheduled clearing：计划时间清空时传 `null`。
- No-op：无变更时确认按钮应不可用或命令因缺少字段失败。

验收标准：
- Given supervisor objective 为 `修复测试`
- When 用户改为 `完成发布验收` 并保存
- Then 前端调用 `supervisor.update`
- And 后续详情显示新 objective

代码索引：
- `packages/server/src/commands/supervisor.ts`
- `packages/web/src/features/supervisor/actions/use-objective-dialog-state.ts`
- `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`

### SUP-004 暂停/恢复/触发 supervisor

状态：`Implemented`

用户行为：
- 用户从 Supervisor 卡片或详情执行暂停、恢复、立即触发检查。

系统响应：
- 暂停调用 `supervisor.pause`。
- 恢复调用 `supervisor.resume`。
- 手动触发调用 `supervisor.trigger`。
- 操作失败时前端展示带失败标签的 action error。

状态与边界：
- Busy：evaluating/injecting 状态下 UI 应表现为忙碌，避免重复触发。
- Error message：服务端错误 message 会拼接到失败标签后。
- Trigger result：`supervisor.trigger` 返回 cycle，不直接返回 supervisor。

验收标准：
- Given supervisor 当前 state 为 `idle`
- When 用户点击暂停
- Then 前端调用 `supervisor.pause`
- And 状态刷新后显示 `paused`
- When 用户点击恢复
- Then 前端调用 `supervisor.resume`

代码索引：
- `packages/server/src/commands/supervisor.ts`
- `packages/web/src/features/supervisor/actions/use-supervisor-actions.ts`
- `packages/web/src/features/supervisor/views/shared/supervisor-card.tsx`

### SUP-005 删除 supervisor

状态：`Implemented`

用户行为：
- 用户或内部流程删除一个 supervisor。

系统响应：
- 调用 `supervisor.delete`，传入 supervisor id。
- 服务端删除目标 supervisor 并返回空对象。

状态与边界：
- Missing：删除不存在 id 的行为由 supervisor manager 决定。
- UI entry：当前代码中删除命令存在，稳定用户入口需结合详情页继续确认。

验收标准：
- Given supervisor id 存在
- When 调用 `supervisor.delete`
- Then 后续 `supervisor.get` 对该 session 返回 null

代码索引：
- `packages/server/src/commands/supervisor.ts`

### SUP-006 restore supervisor

状态：`Implemented`

用户行为：
- 用户在创建或编辑 supervisor 时打开恢复入口，从历史 recoverable target 中恢复目标记忆。

系统响应：
- 前端进入 restore step 后调用 `supervisor.listRecoverableTargets`。
- 返回目标会过滤掉当前 supervisor 的 targetId。
- 用户选择 target 后确认，前端调用 `supervisor.restore`。
- 服务端基于 sourceTargetId 创建或恢复到当前 session，并应用 evaluator 设置。

状态与边界：
- Loading：recoverable targets 加载中显示恢复加载态。
- Empty：没有可恢复目标时显示空态。
- Selection required：restore step 没有选中 target 时不能确认。
- Restore fields：restore 不使用当前 objective 文本，而使用 source target。

验收标准：
- Given workspace 有一个可恢复 target
- When 用户打开 restore step 并选择该 target
- Then 前端调用 `supervisor.restore`
- And 不调用 `supervisor.create`
- And 成功后弹窗关闭

代码索引：
- `packages/server/src/commands/supervisor.ts`
- `packages/web/src/features/supervisor/actions/use-objective-dialog-state.ts`
- `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`

### SUP-007 桌面 supervisor card/details

状态：`Implemented`

用户行为：
- 用户在桌面工作区查看 Supervisor 卡片、打开详情、编辑 objective 或查看 target memory。

系统响应：
- 卡片展示标题、状态、完成周期数和主要操作。
- 详情展示 objective、evaluator、cycle 数、运行状态、错误原因、reasoning、进度列表和 active item。
- 编辑入口打开 objective dialog。

状态与边界：
- Error：state 为 error 时优先展示最近错误 cycle 或 supervisor errorReason。
- Runtime：evaluating/injecting 展示运行中状态。
- Target memory：没有 target memory 时对应区域应保持可渲染，不阻断详情。

验收标准：
- Given supervisor 有 currentTargetMemory 和 recentTargetCycles
- When 用户打开详情
- Then 详情显示 objective、evaluator、cycle 数和进度项

代码索引：
- `packages/web/src/features/supervisor/views/shared/supervisor-card.tsx`
- `packages/web/src/features/supervisor/views/shared/supervisor-details-content.tsx`

### SUP-008 移动端 supervisor sheet

状态：`Implemented`

用户行为：
- 移动端用户点击 Supervisor badge，打开 sheet 查看状态、详情或编辑。

系统响应：
- 移动端 sheet 复用 supervisor dialog state 和详情内容。
- enable/edit/restore 流程在 sheet 内以层级视图呈现。
- 保存或恢复成功后关闭对应层级。

状态与边界：
- Mobile form：确认按钮受 objective、变更状态、restore selection、max count 校验约束。
- Return：编辑完成后可返回详情层。
- Restore：移动端 restore 行为与桌面一致。

验收标准：
- Given 移动端 session 已有 supervisor
- When 用户打开 Supervisor sheet 并点击编辑
- Then sheet 展示编辑表单
- And 保存后调用 `supervisor.update`

代码索引：
- `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx`
- `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-badge.tsx`

## 6. 未确认项

- recoverable targets 的用户选择流程需在第二轮细化。
