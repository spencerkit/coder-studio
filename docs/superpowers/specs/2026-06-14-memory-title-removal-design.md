# Memory Title Removal Design

> Date: 2026-06-14
> Status: Draft for user review
> Owner: Codex

## Problem

当前 workspace memory 系统把 `title` 当成一等字段，贯穿 shared contract、server command、storage、automation capability 和 web side panel。

这带来两类问题：

- UI 上同一条记忆同时显示标题和内容摘要，信息层次割裂，创建表单也多出一个低价值输入。
- 数据层要求 title 存在，导致 agents、skills、CLI 和 UI 都必须人为生成一个名字，即使真正有价值的信息已经在 `content` 内。

用户要求把 memory title 完整移除，不只是隐藏 UI，而是让 memory entry 只保留内容本身和现有结构化元数据。

## Goal

彻底移除 workspace memory 的 `title` 字段，并保证：

- memory entry 数据模型不再包含 `title`
- `memory.create`、`memory.update`、automation capability、builtin memory skill 不再要求或提及 `title`
- web memory panel 和新建 modal 不再显示标题输入或标题展示
- memory list、删除按钮和删除确认统一改用截断后的 `content` 预览作为可读标识
- 已经持久化到磁盘的旧 memory 文件在读取后会被规范化为无 `title` 结构，并在后续写回时完成迁移

## Non-Goals

- 不改变 memory entry 的 `type`、`content`、`tags`、`source`、归档语义或 workspace 作用域
- 不引入新的“摘要”“名称”或自动生成标题字段
- 不扩大为 memory 体验的全面重设计
- 不保留长期的双格式兼容 API

## Existing Context

当前相关实现分散在三层：

- `packages/core/src/domain/memory.ts`
  - `WorkspaceMemoryEntry`、`WorkspaceMemoryInput`、`validateWorkspaceMemoryInput()` 仍要求 `title`
- `packages/server/src/commands/memory.ts`
  - `memory.create` 必填 `title`
  - `memory.update` 允许更新 `title`
- `packages/server/src/storage/repositories/memory-repo.ts`
  - 文件持久化包含 `title`
  - 搜索范围包含 `title`
- `packages/core/src/domain/automation.ts`
  - capability 描述和输入 schema 仍暴露 `title`
- `packages/server/src/skills/builtin/definitions/coder-studio-memory.ts`
  - 内置 skill 文案仍要求“concise titles”
- `packages/web/src/features/workspace/actions/use-memory-panel.ts`
  - create/update 输入类型仍包含 `title`
- `packages/web/src/features/workspace/views/shared/memory-panel.tsx`
  - 新建 modal 仍渲染标题输入
  - 列表、删除按钮和确认文案仍用 `entry.title`

## Decision

采用彻底删除方案：`title` 从 memory 公开契约、内部验证、存储格式、搜索逻辑、UI 表单和可访问文案中全部移除。

不采用以下替代方案：

1. 只在 UI 隐藏 title
原因：这会保留低价值数据模型，并继续迫使 commands、skills、tests 维护一个不再有产品意义的字段。

2. 保留 title 但改为可选
原因：这会让同一份 memory 同时存在两种主标识规则，搜索、列表展示、删除确认和旧数据迁移都会持续分叉。

3. 用自动摘要重新生成 title
原因：这只是把旧字段换成另一个隐式字段，复杂度更高，也不符合“只保留内容”的目标。

## Core Model Changes

`WorkspaceMemoryEntry` 变更为：

- 保留：`id`、`workspaceId`、`type`、`content`、`tags`、`source`、`createdAt`、`updatedAt`、`archivedAt`
- 删除：`title`

输入校验变更为：

- `WorkspaceMemoryInput` 和 `WorkspaceMemoryValidatedInput` 删除 `title`
- `validateWorkspaceMemoryInput()` 只校验 `type`、`content`、`tags`
- `content` 继续要求 trim 后非空，长度上限保持 `20_000`
- `tags` 继续沿用现有标准化规则

这让 core contract 成为唯一真实来源，避免 server 和 web 继续携带已废弃字段。

## Server API Changes

memory commands 改为：

- `memory.create`
  - 输入：`workspaceId`、`type`、`content`、`tags`、可选 `sourceHint`
  - 删除 `title`
- `memory.update`
  - 输入：`workspaceId`、`id`、可选 `type`、`content`、`tags`
  - 删除可选 `title`
- `memory.search`
  - 行为保持不变，但查询范围改为 `content`、`tags`、`type`

错误处理维持现状：

- workspace 不存在时返回 `workspace_not_found`
- entry 不存在时返回 `memory_not_found`
- content 或 tags 非法时继续由现有 validation 抛出错误

## Storage Migration

旧磁盘文件可能仍包含：

```json
{
  "version": 1,
  "workspaceId": "ws-1",
  "entries": {
    "mem-1": {
      "id": "mem-1",
      "workspaceId": "ws-1",
      "type": "decision",
      "title": "Use pnpm",
      "content": "This workspace uses pnpm.",
      "tags": ["tooling"],
      "source": { "kind": "user" },
      "createdAt": 1,
      "updatedAt": 1
    }
  }
}
```

迁移策略采用“读取即规范化，写回即完成迁移”：

- `MemoryRepo` 增加文件标准化逻辑，而不是直接把 JSON 强转为 `WorkspaceMemoryFile`
- 读取时如果 entry 含有 `title`，直接忽略该字段
- 读取结果在运行时只返回无 `title` 的 entry
- 任意 create、update、delete 写回文件时，磁盘内容改写为不含 `title` 的新结构

版本策略：

- 继续使用 `version: 1`
- 不单独引入 `version: 2`

原因：

- 这次 schema 收缩不需要并存两个运行时分支
- 旧文件的歧义仅是多余字段，不是核心结构变更
- 保持 `version: 1` 可以把迁移成本限制在 repo 内部标准化逻辑

## Web UI Changes

`MemoryPanel` 和新建 modal 调整为：

- 删除标题输入框
- 新建表单只保留：
  - type
  - content
  - tags
- 列表主标题改为 `content` 预览，而不是 title
- 删除按钮 `aria-label`、tooltip 和确认弹窗描述都使用同一个内容预览

内容预览规则：

- 基于 `content.trim().replace(/\s+/g, " ")`
- 空白压缩后截断
- 继续使用现有短摘要风格，避免列表和确认文案过长

交互约束：

- 不新增新的可编辑标题或摘要字段
- 列表中仍可显示 type badge、tags、更新时间、source 等现有辅助信息
- 之前已移除的下方 detail panel 不回归

## Automation And Skill Updates

为了让 agent-facing 文档和实际 API 一致，需要同步更新：

- `packages/core/src/domain/automation.ts`
  - `memory.search` 描述去掉 “title”
  - `memory.add` / `memory.update` 输入 schema 删除 `title`
  - CLI 示例不再使用 `--title`
- `packages/server/src/skills/builtin/definitions/coder-studio-memory.ts`
  - 文案改为要求 clear content 和 searchable tags
  - 示例命令删除 `--title`

这样 agents、skills 和 CLI 帮助文本不会继续生成过时参数。

## Testing

本次改动需要覆盖三层测试：

- Core
  - `packages/core/src/domain/memory.test.ts`
  - 如 capability schema 断言受影响，也更新 `packages/core/src/domain/automation.test.ts`
- Server
  - `packages/server/src/commands/memory.test.ts`
  - `packages/server/src/storage/repositories/memory-repo.test.ts`
  - `packages/server/src/__tests__/server-memory-wiring.test.ts`
  - 增加旧磁盘 entry 含 `title` 的归一化迁移用例
- Web
  - `packages/web/src/features/workspace/views/shared/memory-panel.test.tsx`
  - 更新 create/delete 文案断言，改为 content preview

测试策略采用 TDD：

- 先改测试，验证它们因旧 title 行为而失败
- 再逐层实现最小代码让测试转绿

## Risks

- 如果只删类型不做 repo 归一化，旧本地 memory 文件会在读取时与新 contract 不一致
- 如果遗漏 automation 或 builtin skill 文案，agents 仍可能生成 `--title` 命令并触发校验失败
- 如果 web 只删可见标题、不统一删除标签与确认文案中的 title 引用，界面和无障碍文本会继续泄露旧概念
- 如果搜索逻辑没有同步去掉 `title`，测试和实际数据行为会不一致

## Validation

完成后应满足：

- 新创建的 memory entry 从 type 到持久化文件都不再含 `title`
- 旧含 `title` 的 memory 文件能被正常读取，并在下一次写回后变为无 `title` 结构
- memory search 仅匹配 `content`、`tags`、`type`
- 新建 modal 只显示 type、content、tags
- memory list 和删除确认都使用内容预览作为条目标识
