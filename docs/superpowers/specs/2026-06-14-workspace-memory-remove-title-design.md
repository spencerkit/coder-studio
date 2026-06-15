# Workspace Memory Remove Title Design

> Date: 2026-06-14
> Status: Draft for user review
> Owner: Codex

## Problem

当前 workspace memory 系统把 `title` 当成核心字段贯穿 `core`、`server`、`web`
和持久化 JSON：

- 新建 memory 必填 `title`
- memory 列表把 `title` 作为主要可见标签
- 删除确认和可访问名称依赖 `title`
- 搜索会匹配 `title`
- 旧存储文件会长期保留 `title`

这和当前产品方向不一致。用户要求把 memory 简化成“仅保留内容本身”，不再让
title 成为一个独立字段，也不保留兼容层让它继续活着。

## Goal

彻底移除 workspace memory 的 `title`，保证：

- `WorkspaceMemoryEntry`、创建输入、更新输入都不再包含 `title`
- `memory.create`、`memory.update`、automation capability schema 不再接受
  `title`
- memory 列表、删除入口、删除确认统一改用截断后的内容摘要标识一条记忆
- 新建 modal 只保留 `type`、`content`、`tags`
- 旧持久化数据中的 `title` 不再作为运行时字段存在，并会在后续写回时被清除

## Non-Goals

- 不新增单独的“显示名称”字段来替代 `title`
- 不改变 memory `type`、`content`、`tags`、`source` 的含义
- 不为旧存储数据提供长期双 schema 兼容 API
- 不改变 memory 的软删除模型
- 不扩展 memory 编辑 UI；本次重点是移除 title，而不是新增别的编辑能力

## Existing Context

当前相关实现集中在以下位置：

- `packages/core/src/domain/memory.ts`
  - `WorkspaceMemoryEntry`、输入类型和验证函数仍要求 `title`
- `packages/server/src/commands/memory.ts`
  - Zod schema 仍要求创建时传入 `title`，更新时允许修改 `title`
- `packages/server/src/storage/repositories/memory-repo.ts`
  - 存储结构、创建、更新、搜索都依赖 `title`
- `packages/core/src/domain/automation.ts`
  - capability 描述和输入 schema 仍公开 `title`
- `packages/web/src/features/workspace/actions/use-memory-panel.ts`
  - create/update 输入类型仍含 `title`
- `packages/web/src/features/workspace/views/shared/memory-panel.tsx`
  - 新建 modal 仍渲染 title 输入框，列表和删除文案仍显示 `title`

## Decision

采用“硬移除字段 + 存储归一化迁移”方案：

1. 从 shared domain、server command schema、repo 输入类型和 web 输入类型中删掉
   `title`
2. 运行时所有 memory 文本标识统一改为内容摘要
3. `MemoryRepo` 读取旧 JSON 时归一化旧条目：
   - 忽略旧 `title`
   - 只保留 title-less 的运行时结构
4. 任何后续写入都会把该 workspace 文件写回成不含 `title` 的新结构

不采用以下替代方案：

1. 只删 UI，底层继续保留 `title`
原因：会让 API、存储和真实模型继续背着无用字段，后续维护成本更高。

2. 保留 `title` 但自动由 `content` 派生
原因：这只是换一种方式继续保留同一个字段，不符合“都删掉”的要求。

3. 直接删除旧文件或强制 bump 到新版本后拒绝旧数据
原因：会让已有工作区 memory 丢失或不可读。这里需要无损迁移，而不是破坏式重置。

## Data Model Changes

### Core Domain

`packages/core/src/domain/memory.ts` 改为：

- `WorkspaceMemoryEntry` 删除 `title`
- `WorkspaceMemoryInput` 删除 `title`
- `WorkspaceMemoryValidatedInput` 删除 `title`
- `validateWorkspaceMemoryInput()` 只校验：
  - `type`
  - `content`
  - `tags`

Validation 规则调整为：

- `content`: trim 后 1-20,000 字符
- `tags`: 维持现有标准化和去重规则
- 不再有 title 长度校验和 title required 错误

### Search Semantics

memory 搜索与面板内本地过滤都只匹配：

- `content`
- `type`
- `tags`

`title` 不再是搜索范围的一部分。

## Storage Migration

### File Shape

memory 文件仍保持：

```json
{
  "version": 1,
  "workspaceId": "ws_123",
  "entries": {
    "mem_abc": {
      "id": "mem_abc",
      "workspaceId": "ws_123",
      "type": "decision",
      "content": "Project memory is server-owned.",
      "tags": ["architecture"],
      "source": { "kind": "user" },
      "createdAt": 1779120000000,
      "updatedAt": 1779120000000
    }
  }
}
```

不 bump `version`。原因：

- 现有仓库已经广泛使用“保持 `version: 1` 并通过 normalize 兼容旧形态”的模式
- 这次变化不需要多版本并存协议，只需要把旧记录整理成新结构

### Normalization Strategy

`MemoryRepo` 增加文件归一化逻辑：

- 允许读取带 `title` 的旧 entry
- 归一化结果返回不含 `title` 的 `WorkspaceMemoryEntry`
- 如果某条旧记录 `content` 非法，则按现有 repo 的容错模式忽略该条记录
- 归一化不会用 `title` 回填 `content`

迁移行为定义为：

- 旧文件首次被读取时，运行时已看不到 `title`
- 旧文件在该 workspace 下发生任何 create/update/delete 写操作时，会被整体写回为
  不含 `title` 的新结构

这是一种“读时兼容、写时完成迁移”的单向迁移，不保留长期 title 兼容层。

## API And Server Behavior

### Commands

`packages/server/src/commands/memory.ts` 调整为：

- `memory.create`
  - 输入去掉 `title`
  - 继续要求 `workspaceId`、`type`、`content`
- `memory.update`
  - 输入去掉 `title`
  - 允许更新 `type`、`content`、`tags`

### Repository

`packages/server/src/storage/repositories/memory-repo.ts` 调整为：

- create/update 不再向验证器传入 `title`
- 搜索辅助函数不再匹配 `title`
- 写入磁盘的 entry 不再包含 `title`

### Automation Capability Metadata

`packages/core/src/domain/automation.ts` 调整为：

- `memory.search` 描述去掉 “by title”
- `memory.add` input schema 去掉 `title`
- `memory.update` input schema 去掉可选 `title`
- CLI 示例同步改为只使用 `content`

## UI Changes

### Create Modal

`packages/web/src/features/workspace/views/shared/memory-panel.tsx` 中的新建 modal
只保留：

- type select
- content textarea
- tags input

移除：

- title label
- title input
- 与 `title` 相关的 draft state

### Memory List Presentation

列表项主文案改为内容摘要：

- 基于 `content.trim().replace(/\s+/g, " ")`
- 长文本截断为单行摘要
- 空内容不会出现，因为 content 校验仍要求非空

删除入口和确认文案也使用同样的摘要文本，避免 UI 在没有 title 后失去识别能力。

### Accessibility

以下文本都改为基于内容摘要：

- 列表项可访问名称
- 删除按钮 aria-label
- 删除确认弹窗描述中的记忆标识

## Testing

需要更新并通过以下直接相关测试：

- `packages/core/src/domain/memory.test.ts`
- `packages/core/src/domain/automation.test.ts`（如果 schema 断言覆盖到 memory）
- `packages/server/src/commands/memory.test.ts`
- `packages/server/src/storage/repositories/memory-repo.test.ts`
- `packages/server/src/__tests__/server-memory-wiring.test.ts`
- `packages/web/src/features/workspace/views/shared/memory-panel.test.tsx`

测试重点：

- memory 校验不再要求 `title`
- command schema 拒绝旧的 title-dependent 假设
- repo 能读取含 `title` 的旧文件并以无 `title` 结构返回
- repo 写回后文件不再包含 `title`
- web 新建 modal 不再渲染 title 输入框
- 列表与删除文案改用内容摘要

## Risks

- 如果只删类型不补 repo normalize，旧 workspace memory 文件会在读取时与新类型不一致
- 如果 UI 和 server 搜索语义没同时更新，会出现前后端过滤结果不一致
- 如果测试仍依赖旧的 `title_label` 或 title 文案，前端测试会失败
- 如果一次性清理过度，可能误触当前工作区内与 memory 无关的未提交改动

## Validation

完成后应满足：

- 新建 memory 时没有 title 字段
- `WorkspaceMemoryEntry` 运行时结构不含 `title`
- 旧含 title 的磁盘文件仍可读取
- 后续写回的磁盘文件不再含 `title`
- 搜索、列表展示、删除确认都基于内容摘要
