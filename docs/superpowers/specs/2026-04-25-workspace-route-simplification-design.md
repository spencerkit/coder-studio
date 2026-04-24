# Workspace 路由简化与 Active State 收敛 · 设计文档

> **版本：** 1.0
> **日期：** 2026-04-25
> **状态：** Draft（等待评审）
> **关联文档：**
> `docs/PRD.zh-CN.md` §5 / §7
> `docs/PRD.md` §5 / §7
> **作者：** 技术共同设计 — Spencer + Codex

---

## 0. 文档说明

### 0.1 目的

把工作区页面从“URL + 本地持久化双状态源”收敛为“单一路由 `/workspace` + 前端内存 active state”模型，删除 `/workspace/:id` 路由，不再把当前激活 workspace 的 id 暴露到 URL。

### 0.2 背景

当前实现同时存在两份“当前工作区”状态：

- 路由参数：`/workspace/:id`
- 前端持久化状态：`ui.activeWorkspaceId`

这导致：

- 页面需要持续做 URL → atom 的同步。
- 多个入口（顶栏切换、通知点击、命令面板、刷新恢复）都要同时改 URL 和本地状态。
- 当 URL 上的 workspace id 已不存在时，页面会进入额外的“解析/兜底”分支。
- 浏览器历史会混入“切换 workspace”这种纯应用内状态，增加行为复杂度。

最近暴露出来的“正在进入工作区...”卡住问题，本质上就是这个双状态源模型下的一类失配。

### 0.3 设计目标

- 路由层只保留 `/workspace`，不再表达 active workspace id。
- 当前激活 workspace 只由前端管理，不写 URL，不写浏览器历史。
- 页面刷新后，当前工作区由后端 `workspace.list` 返回顺序的第一个决定。
- 当当前 workspace 失效时，所有入口都走同一套 fallback 逻辑。
- `/workspace` 页面只出现有限、可解释的状态：`loading`、`error`、`empty`、`ready`。

### 0.4 非目标

- **不**删除 workspace 实体自身的 `id`。它仍然是后端数据主键，也是会话、终端、git、pane layout 的归属键。
- **不**让后端保存“当前激活 workspace”这种 UI 态。
- **不**引入 query 参数形式的 workspace 路由（如 `/workspace?ws=...`）。
- **不**实现“刷新后恢复上次看的 workspace”；本设计明确采用“刷新后取后端列表第一个”。
- **不**让 workspace 切换进入浏览器前进/后退历史栈。

---

## 1. 决策摘要

### 1.1 最终方案

采用以下模型：

- 工作区主路由固定为 `/workspace`
- 当前激活 workspace 只存在前端内存
- workspace 切换不修改 URL
- workspace 切换不写浏览器历史
- 页面刷新后重新请求 `workspace.list`
- 若列表非空，自动激活后端返回顺序中的第一个 workspace
- 若列表为空，显示 `/workspace` 空状态

### 1.2 为什么不保留 `/workspace/:id`

保留 `/workspace/:id` 当然可行，但它会把“当前工作区”定义成 URL 语义，从而要求：

- 每个 workspace 切换都变成一次路由跳转
- 通知点击、命令面板、workspace tab 都要同步改 URL
- 浏览器历史天然参与 workspace 切换
- 页面刷新时要优先尊重 URL，再做缺失处理

这与本次明确的产品选择相反：

- active workspace 属于前端 UI 态，不属于地址栏语义
- workspace 切换不应污染浏览器历史
- 无需支持“把某个具体 workspace 复制成链接发给自己/别人”

### 1.3 为什么不做前端持久化恢复

候选方案里也讨论过把 active workspace 存在 `sessionStorage` 或 `localStorage`，但都不符合本次选择：

- `localStorage` 会跨 tab 共享，容易让不同 tab 之间互相覆盖 active workspace。
- `sessionStorage` 虽然是 per-tab，但仍然会让刷新后的 active workspace 依赖本地历史，而不是后端当前返回的列表。

本设计明确把“刷新后打开谁”定义为：

> 以后端 `workspace.list` 返回的第一个 workspace 为准，不做前端恢复。

---

## 2. 用户可见行为

### 2.1 路由行为

- 工作区页唯一入口为 `/workspace`
- 设置页保持 `/settings`
- 欢迎页保持 `/`
- 删除 `/workspace/:id`

### 2.2 进入 `/workspace`

进入 `/workspace` 后：

1. 前端请求 `workspace.list`
2. 若请求未完成，显示 loading shell
3. 若请求失败，显示 error shell + retry
4. 若列表为空，显示 empty state
5. 若列表非空：
   - 如果当前前端内存里已有仍然有效的 active workspace，继续显示它
   - 否则自动激活列表中的第一个 workspace

这里的“第一个 workspace”严格指：

- **后端 `workspace.list` 返回数组的第一个元素**
- 前端不再自行排序

当前服务端实现中，`workspace.list` 按 `last_active_at DESC` 排序，因此这一行为等价于“默认打开后端认为最近活跃的 workspace”。

### 2.3 切换 workspace

- 点击顶栏 workspace tab 只更新前端 active state
- 不改 URL
- 不调用 `navigate('/workspace/<id>')`
- 不新增浏览器历史记录

### 2.4 新开 workspace

- 在欢迎页打开新 workspace：成功后跳转到 `/workspace`，并激活新 workspace
- 在工作区页打开新 workspace：不改路由，只激活新 workspace

### 2.5 关闭 workspace

- 关闭非 active workspace：只从列表中移除，不影响当前视图
- 关闭当前 active workspace：
  - 若仍有其他 workspace，自动切到新的列表第一个
  - 若没有剩余 workspace，停留在 `/workspace`，显示 empty state

### 2.6 通知 / Toast / 命令面板跳转

这些入口都只做两件事：

- 把目标 workspace 设为当前意图 active id
- 若当前不在工作区路由，则导航到 `/workspace`

它们**不再**：

- 把 workspace id 写入 URL
- 把 workspace id 写入 `localStorage`

如果目标 workspace 不存在：

- 若当前列表里还有其他 workspace，则回退到列表第一个
- 若列表为空，则进入 empty state

### 2.7 浏览器历史

浏览器历史只反映真正的页面级导航，例如：

- `/` ↔ `/workspace`
- `/workspace` ↔ `/settings`

它**不**反映：

- workspace A → workspace B → workspace C 这种应用内切换

因此浏览器的前进/后退不参与 workspace tab 切换。

---

## 3. 状态模型

### 3.1 状态拆分

前端工作区状态拆成三层：

1. **工作区列表投影**
   来自后端 `workspace.list` 初始化 + WS 事件增量更新
2. **用户/系统意图 active id**
   纯前端内存状态，可由 tab 点击、通知点击、命令面板等写入
3. **已解析的真实 active workspace**
   在“当前意图”和“当前存在的工作区列表”之间做合法化与 fallback

### 3.2 推荐 atom 结构

#### `workspacesAtom`

保留现有职责：

- 存放当前存在的 workspace map
- 由 WS `workspace.<id>.meta` 事件增量更新

#### `workspacesLoadStateAtom`

新增加载状态，建议枚举：

```ts
type WorkspaceLoadState = 'idle' | 'loading' | 'ready' | 'error';
```

用途：

- 区分“还没拉列表”与“列表真的为空”
- 让 `/workspace` 页面不再靠副作用推断当前 shell 应该显示什么

#### `workspacesLoadErrorAtom`

新增错误信息状态：

- `null` 表示没有错误
- `string` 或结构化 error 表示最近一次 `workspace.list` 失败

#### `activeWorkspaceIdAtom`

保留名字，但语义改为：

- **纯内存 writable atom**
- 不再使用 `atomWithStorage`
- 不再与 URL 同步
- 表示“当前用户/系统希望看到哪个 workspace”

#### `resolvedActiveWorkspaceIdAtom`

新增派生 atom，规则如下：

1. 若 `workspacesLoadState !== 'ready'`，返回 `null`
2. 若 `activeWorkspaceIdAtom` 指向的 workspace 仍存在，返回该 id
3. 否则若当前列表非空，返回列表第一个 workspace 的 id
4. 否则返回 `null`

#### `activeWorkspaceAtom`

读取 `resolvedActiveWorkspaceIdAtom` 后，再从 `workspacesAtom` 中取出对应实体。

### 3.3 设计原则

所有读侧 UI 组件都应依赖：

- `resolvedActiveWorkspaceIdAtom`
- `activeWorkspaceAtom`

而不是直接依赖原始 writable `activeWorkspaceIdAtom`。

这样可以保证：

- fallback 逻辑只定义一次
- 某个 workspace 被删除、关闭或失效时，不需要每个组件自己补兜底
- 通知跳转、workspace 关闭、页面刷新都走同一条解析链路

---

## 4. 路由与模块边界

### 4.1 路由表

`App` 路由层改为：

- `/` → Welcome
- `/workspace` → WorkspacePage
- `/settings` → SettingsPage

删除：

- `/workspace/:id`

### 4.2 `RootRoute` 语义

当前 `RootRoute` 会根据 `activeWorkspaceIdAtom` 重定向到 `/workspace/:id`。改造后：

- `RootRoute` 不再读取 active workspace
- `/` 保持欢迎页语义
- “有 workspace 就自动离开欢迎页”不再是路由层职责

这能进一步减少“页面地址”和“当前工作区”之间的耦合。

### 4.3 `WorkspacePage` 职责

`WorkspacePage` 只负责：

- 触发/消费 `workspace.list` 初始化
- 根据 `load state` 决定显示 loading / error / empty / ready
- 读取 `activeWorkspaceAtom` 渲染当前工作区内容

`WorkspacePage` 不再负责：

- 解析 `useParams().id`
- 把 URL 上的 workspace id 回写到前端状态
- 判断“URL 上这个 id 是否存在”

### 4.4 顶栏与 workspace tab

顶栏 tab 点击从“导航 + 状态同步”简化为“只设置 active id”。

对应收益：

- 不再依赖 React Router 完成 workspace 切换
- 不再制造浏览器历史记录
- tab 组件不再关心 URL 构造

### 4.5 `focusSession` 入口

当前 `focusSession` 通过：

- 写 `localStorage['ui.activeWorkspaceId']`
- 跳转 `/workspace/${workspaceId}`

来完成 workspace 聚焦。改造后它需要变成纯前端状态入口：

- 显式接收 `setActiveWorkspaceId`
- 设置 pending focus session
- 如当前不在 `/workspace`，只导航到 `/workspace`

不再允许：

- 直接写 `localStorage`
- 构造 `/workspace/${workspaceId}`

这一步是本次设计里最关键的边界修正之一，因为系统通知点击发生在 React 组件树之外，之前正是靠“写 localStorage + 改 URL”绕过了状态注入。

---

## 5. 生命周期与数据流

### 5.1 首次进入 `/workspace`

```text
进入 /workspace
  ↓
set workspacesLoadState = loading
  ↓
dispatch workspace.list
  ↓
成功:
  - 更新 workspacesAtom
  - set workspacesLoadState = ready
  - 若 activeWorkspaceId 无效，则 resolvedActiveWorkspaceId 自动回退到列表第一个

失败:
  - set workspacesLoadState = error
  - 记录 workspacesLoadError
```

### 5.2 workspace 被删除/关闭

```text
workspacesAtom 发生变化
  ↓
resolvedActiveWorkspaceIdAtom 重新计算
  ↓
如果旧 active id 已不存在:
  - 列表非空 → 取第一个
  - 列表为空 → null
```

### 5.3 通知点击

```text
notification click
  ↓
set activeWorkspaceId = targetWorkspaceId
set pendingFocusSession = targetSessionId
  ↓
如果当前不在 /workspace:
  navigate('/workspace')
  ↓
WorkspacePage 加载列表并解析 active
  ↓
若目标存在 → 聚焦对应 workspace + session
若目标不存在 → 回退到列表第一个 workspace
```

---

## 6. 错误处理

### 6.1 页面状态约束

`/workspace` 页面只允许以下状态：

- `loading`
- `error`
- `empty`
- `ready`

不再存在“URL 正在解析某个具体 workspace id”的额外中间态。

### 6.2 `workspace.list` 失败

失败时：

- 不进入 empty state
- 不假装“当前没有 workspace”
- 保持 error shell
- 提供 retry 入口

原因：

- “后端请求失败”和“后端返回空列表”是两个完全不同的产品语义，不能混淆

### 6.3 无效 active id

无效 active id 不是错误，只是正常 fallback：

- 若目标 workspace 已消失，自动取列表第一个
- 若没有任何 workspace，进入 empty state

这条规则对以下入口统一生效：

- tab 切换后的后续删除
- 通知点击
- 命令面板跳转
- 页面刷新

---

## 7. 测试与验收

### 7.1 单元测试

至少覆盖：

- `/workspace` 首次加载时显示 loading
- `workspace.list` 成功且为空时显示 empty state
- `workspace.list` 成功且非空时默认选择第一个 workspace
- 当前 active workspace 被删除时自动切换到剩余列表第一个
- 通知/命令面板写入一个不存在的 workspace id 时，解析结果回退到第一个
- `focusSession` 不再写 `localStorage`
- `focusSession` 不再构造 `/workspace/:id`

### 7.2 集成 / E2E

至少覆盖：

- 刷新 `/workspace` 后，打开 `workspace.list` 返回的第一个 workspace
- 切换 workspace 后，浏览器 back/forward 不在不同 workspace 之间切换
- 从 `/settings` 返回 `/workspace`，当前前端 active workspace 保持不变
- 关闭当前 active workspace 后，UI 稳定切换到新的第一个 workspace
- 最后一个 workspace 关闭后，`/workspace` 落入 empty state
- 不再依赖 `/workspace/:id` 路由

### 7.3 手动验收

1. 打开多个 workspace，访问 `/workspace`
2. 点击不同顶栏 tab，确认地址栏始终不变
3. 刷新页面，确认打开的是服务端返回的第一个 workspace
4. 关闭当前 workspace，确认切换到新的第一个 workspace
5. 关闭全部 workspace，确认停留在 `/workspace` 空状态
6. 从设置页返回 `/workspace`，确认仍停留在当前 active workspace
7. 触发一个指向已删除 workspace 的通知，确认页面回退到可用 workspace 而不是卡住

---

## 8. 影响范围

预期会触及以下模块：

- `packages/web/src/app.tsx`
  - 路由表移除 `/workspace/:id`
  - `RootRoute` 不再按 active workspace 重定向
- `packages/web/src/atoms/ui.ts`
  - `activeWorkspaceIdAtom` 从持久化 atom 改为内存 atom
- `packages/web/src/atoms/workspaces.ts`
  - 增加 resolved active 相关派生 atom
- `packages/web/src/features/workspace/index.tsx`
  - 删除 `useParams`
  - 改为基于 load state + active atom 渲染
- `packages/web/src/features/topbar/components/tab.tsx`
  - 点击 tab 不再导航
- `packages/web/src/features/workspace/components/workspace-launch-modal.tsx`
  - 打开成功后只导航到 `/workspace`
- `packages/web/src/features/notifications/focus-session.ts`
  - 删除 localStorage 写入
  - 删除 `/workspace/:id` 路由拼接
- `packages/web/src/features/notifications/use-session-notifications.ts`
  - 调整 `focusSession` 调用契约
- `packages/web/src/features/command-palette/components/command-palette.tsx`
  - 切换 workspace 时不再走 `/workspace/:id`
- 对应测试与 e2e 用例

---

## 9. 方案校验

### 9.1 一致性检查

本方案与已确认的产品选择完全一致：

- URL 不记录 active workspace id
- active workspace 只归前端
- 刷新后选择后端返回列表第一个
- 浏览器历史不参与 workspace 切换

### 9.2 风险

主要风险不是功能丢失，而是迁移期残留代码继续偷偷依赖旧模型：

- 某些组件继续读取原始 `activeWorkspaceIdAtom`
- 某些入口仍然拼 `/workspace/${id}`
- 某些工具函数仍然写 `localStorage['ui.activeWorkspaceId']`

因此实现阶段必须把“路由 id 模型”整体删净，不能只改主页面。

### 9.3 完成标准

满足以下条件时，本设计视为落地完成：

- 代码中不再存在 `/workspace/:id` 路由定义
- workspace 切换不再触发 URL 变化
- active workspace 不再持久化到 storage
- `/workspace` 能稳定处理 loading / error / empty / ready 四种状态
- 相关单元测试与集成测试全部通过

