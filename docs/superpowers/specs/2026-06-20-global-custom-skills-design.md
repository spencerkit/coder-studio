# Global Custom Skills Design

Date: 2026-06-20
Status: Draft
Owner: codex

## Problem

当前产品已经有一套 `Skills` 管理链路：

- 可以展示公共 skill 库
- 可以区分 `skillhub / local / builtin`
- 可以对 skill 执行挂载、卸载、修复、更新
- 可以在右侧 `Skills` 面板中查看已安装和 built-in skill

但它还缺少“产品内创建和维护自定义 skill”的完整体验。当前用户如果想做一个自定义 skill，需要在产品外手工：

- 在 `~/.agents/skills/<slug>/` 下新建目录
- 手写 `SKILL.md`
- 自己管理目录内的其他文件
- 回到产品里等待本地扫描把它显示出来

这条链路的问题不是“少一个创建按钮”这么简单，而是产品对 `local` skill 只做了“扫描并展示”的被动支持，还没有给用户提供一条主动的、闭环的创作路径：

- 缺少 `Custom Skills` 入口，用户无法区分“我自己创建的 skill”和“安装来的 skill”
- 缺少创建流程，用户不能直接在产品里生成 `SKILL.md`
- 缺少目录树，用户看不到一个 skill 目录下的全部文件
- 缺少文件级管理动作，用户不能新建、重命名、删除 skill 内文件
- 缺少和现有 editor 的联动，skill 文件不能像 workspace 文件一样直接进入编辑器
- 缺少把 skill 目录拖到 agent 的直接交互

用户要的不是“把 skill 面板做成第二个重量级文件管理器”，而是一条更轻的创作流：

- 在产品里创建全局自定义 skill
- 默认先不启用
- 能看到该 skill 对应的目录和全部文件
- 点文件后直接用现有 editor 编辑
- 必要时把整个 skill 目录路径拖给 agent，让 agent 去改

## Goals

- 在 `Skills` 面板中新增明确的 `Custom Skills` section。
- 支持在产品内创建全局自定义 skill，目标目录为 `~/.agents/skills/<slug>/`。
- 创建时只要求输入 skill 名称，自动生成 slug 和 `SKILL.md`。
- 创建后的自定义 skill 默认不启用。
- 在产品内浏览单个 skill 目录的完整树结构。
- 支持对 skill 目录执行轻量文件管理：新建文件、新建文件夹、重命名、删除。
- 点击 skill 文件后，复用现有 editor 打开和编辑，而不是在 `Skills` 面板中重造一套编辑器。
- 支持把 skill 根目录或单个文件拖到 agent，会话中只插入路径文本，不引入特殊附件语义。
- 自定义 skill 与现有挂载体系兼容，仍沿用已有启用/禁用逻辑。

## Non-Goals

- 这次不做 workspace 级自定义 skill；自定义 skill 是应用级全局资源。
- 这次不做“导入一个现有本地目录并自动变成 skill”的流程。
- 这次不做“复制 skill”“skill 模板市场”“版本历史”“撤销恢复”等进阶能力。
- 这次不在 `Skills` 面板内内嵌代码编辑器。
- 这次不把自定义 skill 伪装成某个 workspace 的文件树节点。
- 这次不支持重命名 skill slug 本身，也不支持移动 skill 根目录。
- 这次不改变现有 mounted skill、built-in skill、skills-hub 搜索安装的基础行为。

## Current Context

### Existing Local Skill Model

服务端已经会扫描本地全局 skill 根目录：

- [`packages/server/src/skills/local-skill-scanner.ts`](../../../packages/server/src/skills/local-skill-scanner.ts)

默认路径已经固定为：

- `~/.agents/skills`

扫描规则也已经与目标模型一致：

- 一个目录即一个 skill
- 目录下存在 `SKILL.md` 就会被识别
- `slug` 直接取目录名
- `source` 为 `local`

这意味着“全局自定义 skill”不需要再发明新的领域模型；它天然就是现有 `local` source 的一部分，缺的只是创建、浏览和编辑入口。

### Existing Skills Panel

前端现有 `Skills` 面板已经具备：

- 公共 skill 列表
- built-in 分组
- 搜索与推荐
- enable/disable
- uninstall/update
- skill 详情页

参考：

- [`packages/web/src/features/workspace/views/shared/skills-panel.tsx`](../../../packages/web/src/features/workspace/views/shared/skills-panel.tsx)
- [`packages/web/src/features/workspace/actions/use-skills-panel.ts`](../../../packages/web/src/features/workspace/actions/use-skills-panel.ts)

但当前 skill 详情页只有元信息和 target 信息，还不能展示 skill 目录内文件。

### Existing Editor Constraint

当前 editor 及文件命令几乎全部绑定在 `workspaceId + workspace relative path` 上：

- [`packages/web/src/features/workspace/actions/use-open-workspace-file.ts`](../../../packages/web/src/features/workspace/actions/use-open-workspace-file.ts)
- [`packages/web/src/features/workspace/actions/use-file-actions.ts`](../../../packages/web/src/features/workspace/actions/use-file-actions.ts)
- [`packages/server/src/commands/file.ts`](../../../packages/server/src/commands/file.ts)

这意味着不能把全局 skill 目录简单塞进 workspace 文件模型里，否则会混淆：

- 文件来源
- 路径拖拽含义
- terminal 路径插入
- 外部变更同步
- editor tab 的身份

因此复用 editor UI 是对的，但要通过“新增 skill 文件来源”来复用，而不是通过“伪装成 workspace 文件”来复用。

### Existing Drag-and-Drop Semantics

当前路径拖拽语义已经存在：

- [`packages/web/src/lib/workspace-path-drag.ts`](../../../packages/web/src/lib/workspace-path-drag.ts)

并且 agent / terminal 已经能消费“拖入路径字符串”的行为。这证明产品已经接受“路径即操作对象”的交互模型。自定义 skill 只需要扩展一套与之平行的 `skill path drag` 语义，不需要引入新的附件领域。

## User Decisions Captured

- 自定义 skill 是全局共享资源，而不是某个 workspace 私有资源。
- 创建自定义 skill 后默认不启用。
- 把 skill 目录拖到 agent 时，只插入目录路径，让 agent 自己读取和修改文件。
- skill 目录中的文件需要可编辑，但不希望在 `Skills` 面板内再做一套重型编辑器。
- 目录树需要支持基础文件管理：查看、打开、创建、重命名、删除。
- 产品应优先复用现有 editor 体验，而不是重复建设编辑能力。

## Approaches Considered

### Option A: 把全局 skill 目录伪装成 workspace 文件

核心思路：

- 把 `~/.agents/skills/<slug>` 作为某个 workspace 下的“特殊目录”
- 所有读写和打开动作仍走 `file.*` 命令

优点：

- 短期内复用现有文件树与 editor 命令最多

缺点：

- 语义错误；全局资源被绑定到单个 workspace
- 拖拽和 terminal 路径插入会带上错误的 workspace 身份
- 多 workspace 打开同一 skill 时状态会变得难以解释
- 后续外部变更、持久化 tab、冲突检测都会被污染

### Option B: 在 Skills 面板里内嵌一套轻编辑器

核心思路：

- `Skills` 面板自己展示目录树和文本编辑区
- 不触达现有 editor 主链路

优点：

- 不需要扩展 editor 的文件来源模型

缺点：

- 会产生第二套编辑体验
- dirty 状态、保存、冲突、快捷键、预览行为都会重复建设
- 很快会变成一个半成品 editor

### Option C: 复用现有 editor UI，但增加 `skill` 文件来源（推荐）

核心思路：

- `Skills` 面板负责列表、详情、目录树和管理动作
- 技术上为 editor 增加一种新的文件来源：`skill`
- skill 文件读写走 `skills.files.*` 命令
- 打开 skill 文件时进入现有 editor tab

优点：

- 交互最干净
- skill 仍是全局资源，不会污染 workspace 文件模型
- editor 能力可以复用到位
- 后续如果还有别的全局资源，也有统一扩展方向

缺点：

- 需要扩展 editor 的 tab 身份、打开逻辑和读写命令

## Final Choice

采用 Option C。

产品新增一条“全局自定义 skill 创作流”，但不新增第二套编辑器：

- `Skills` 面板新增 `Custom Skills` section
- 自定义 skill 仍然作为 `source=local` 的 skill 进入公共 skill 库
- 点击 skill 文件后复用现有 editor UI 打开
- editor 底层新增 `skill` 文件来源，而不是复用 workspace 文件来源
- 拖到 agent 时仍保持“插入路径”的轻语义

## Scope

### Included In This Design

- `Custom Skills` section
- 创建全局自定义 skill
- skill 详情页中的目录树
- skill 文件与目录的基础管理
- 与现有 editor 的联动
- skill 根目录与单文件拖到 agent
- 必要的服务端命令与前端状态扩展

### Excluded From This Design

- 现有 `Installed / Built-in / Discover` 主流程重做
- skill slug 重命名
- 批量文件操作
- 拖到 terminal 的专门优化
- 移动端完整编辑体验优化

## Final UX

### 1. Skills Panel Structure

`Skills` 面板从上到下分为四个 section：

1. `Custom Skills`
2. `Installed`
3. `Built-in`
4. `Discover`

`Custom Skills` 放在最上面，因为它是用户主动创作的入口，而不是被动扫描结果。

section header 结构：

- 标题：`Custom Skills`
- 计数
- `Create` 按钮
- 折叠/展开按钮

可选辅助文案：

- `Global skills stored in ~/.agents/skills`

### 2. Custom Skills List

每个 custom skill 使用与现有 skill 卡片一致的紧凑 row/card 风格，但只展示自定义 skill 关心的信息：

- display name
- slug
- description 摘要
- 启用状态摘要

每项操作：

- 点击主体：进入详情页
- `Enable/Disable` switch
- `Delete` button

不在列表态直接显示目录树或文件操作，避免首层过重。

### 3. Create Skill Flow

点击 `Create` 后打开轻量 dialog。

字段：

- `Skill name` 输入框
- `Slug` 只读预览

说明文案：

- 创建目录：`~/.agents/skills/<slug>/`
- 自动生成文件：`SKILL.md`
- 创建后默认不启用

交互规则：

- 名称变化时实时生成 slug
- 如果 slug 冲突，显示错误并禁止提交
- 点击 `Create` 后：
  - 创建目录
  - 写入默认 `SKILL.md`
  - 刷新 skill 库
  - 自动进入新 skill 详情页
  - 自动打开 `SKILL.md`

默认模板：

```md
---
name: my-skill
description: Custom skill
---

# My Skill
```

### 4. Skill Detail View

详情页继续沿用当前 “从列表进入 detail view” 的结构，但增加文件层能力。

顶部展示：

- 返回按钮
- skill 名称
- slug
- source
- 全局路径
- 启用状态摘要

顶部动作：

- `Enable/Disable`
- `New File`
- `New Folder`
- `Delete`

主体区域分两部分：

- `Overview`
  - 描述
  - library path
  - target summaries
- `Files`
  - 展示该 skill 根目录的目录树

### 5. Files Tree

文件树的目标不是做成完整的资源管理器，而是提供“skill 内文件的最小闭环管理”。

树结构规则：

- 根节点固定为 skill 根目录
- 默认加载根目录一级内容
- `SKILL.md` 排在最前
- 目录可展开/收起
- 文件点击后直接用现有 editor 打开

每个节点支持：

- 文件
  - `Open`
  - `Rename`
  - `Delete`
  - `Drag path to agent`
- 目录
  - `Expand/Collapse`
  - `New File`
  - `New Folder`
  - `Rename`
  - `Delete`
  - 根目录额外支持 `Drag skill path to agent`

不做：

- 多选
- 复制/粘贴
- 拖拽重排文件

### 6. Editing Flow

skill 文件编辑完全复用现有 editor：

- 从 `Files` 树点击文件
- 文件进入现有 editor tab
- 保存、dirty、冲突检测都沿用 editor 现有行为

`Skills` 面板本身不内嵌文本编辑区。这样用户获得的是一套统一编辑体验，而不是两套相似但不一致的编辑器。

### 7. Drag to Agent

自定义 skill 的拖拽继续使用“路径语义”：

- 拖 skill 根目录到 agent：插入 skill 目录路径
- 拖单个文件到 agent：插入文件路径

这不是“附加一个 skill 对象”，只是把路径给 agent。agent 后续如何读取或修改文件，仍由会话内行为决定。

推荐文案：

- 根目录：`Drag to agent as path`
- 文件：`Drag file path to agent`

### 8. Delete Flow

`Delete` 始终是删除整个 skill 文件夹，而不是只删库索引。

删除确认：

- 若未启用：
  - `Delete this custom skill and all files in its folder?`
- 若仍有 enabled mounts：
  - `This skill is enabled for some agents. Deleting it will disable it first, then remove its folder and files.`

执行顺序：

1. unmount enabled targets
2. 删除 skill 目录
3. 删除库索引项
4. 广播 `skillLibraryChanged`
5. 前端返回列表并刷新

## Interaction Details

### List Page Principles

- 列表只负责“选 skill”和“做轻管理动作”
- 不在列表页直接暴露文件树
- 自定义 skill 与其他来源 skill 视觉上保持同一系统，但分组明确

### Detail Page Principles

- 详情页负责“理解一个 skill”
- 目录树负责“浏览和组织文件”
- editor 负责“实际编辑”

### Status Language

自定义 skill 继续沿用现有挂载状态体系，不重新发明第二套状态词。

但在列表层面对用户暴露的是简化摘要：

- `Disabled`
- `Enabled`
- `Partial`
- `Error`

## Architecture

### 1. Domain Model

不新增新的 skill 类型。自定义 skill 仍然是现有：

- `SkillLibraryEntry`
- `source = "local"`

新增的是“这是产品创建的 local skill”的创作链路，而不是新的库模型。

### 2. Server Command Surface

需要新增一组 `skills.custom.*` 命令：

- `skills.custom.create`
- `skills.custom.delete`

以及一组 skill 文件命令：

- `skills.files.readTree`
- `skills.files.read`
- `skills.files.write`
- `skills.files.create`
- `skills.files.mkdir`
- `skills.files.rename`
- `skills.files.delete`

这些命令都通过 `skillSlug` 定位到 `libraryPath`，而不是通过 `workspaceId` 定位。

### 3. Path Safety

所有 skill 文件操作都必须：

- 以 `skill.libraryPath` 为根目录
- 禁止路径逃逸
- 禁止删除或写出 skill 根目录之外的内容

安全模型应与现有 `file-io` 一致，但根目录从 workspace root 换成 skill root。

### 4. Editor Source Model

需要把当前“只支持 workspace 文件”的 editor 打开模型扩展为“支持多来源文件”。

最低要求：

- editor tab 能区分 `workspace file` 与 `skill file`
- 打开、读取、保存时分发到不同命令
- tab 标题可显示文件名，副标题或 displayPath 显示 skill 路径

不要求这次把整个 editor 域做成完全通用的资源系统，但不能继续假设“所有文件都属于 workspace”。

### 5. Drag Payload Model

需要新增与 workspace 平行的 drag payload：

- `skillSlug`
- `path`
- `kind`

agent 端消费时只读取文本路径，不要求理解 skill 领域对象。

### 6. Refresh Model

skill 文件修改成功后，需要：

- 刷新当前 skill 目录树
- 保持详情页展开状态
- 如有必要刷新 `skills.library.list`

skill 创建、删除、启用、禁用继续依赖现有：

- `skills.library.changed` topic

## Data Flow

### Create

1. 用户点击 `Create`
2. 前端提交 `skills.custom.create`
3. 服务端生成 slug、校验冲突、创建目录、写入 `SKILL.md`
4. 服务端写入或刷新库索引
5. 服务端广播 `skills.library.changed`
6. 前端刷新列表并进入详情
7. 前端调用 `skills.files.readTree`
8. 前端自动打开 `SKILL.md`

### Open Skill File

1. 用户在 skill 文件树点击文件
2. 前端以 `skill` 来源打开 editor tab
3. editor 调用 `skills.files.read`
4. 返回文本或图片内容
5. editor 进入正常展示与编辑状态

### Save Skill File

1. 用户在 editor 中修改并保存
2. editor 根据文件来源调用 `skills.files.write`
3. 服务端做冲突检测并写入
4. 前端更新 buffer hash
5. 需要时刷新 skill 树相关节点

### Drag Skill Path to Agent

1. 用户拖根目录或单文件
2. 前端写入 skill path drag payload 和 `text/plain`
3. agent drop zone 接收
4. 会话中插入对应路径文本

## Error Handling

### Create Errors

- 名称为空
- slug 冲突
- 无法写入 `~/.agents/skills`
- 默认模板写入失败

前端在 create dialog 中就地展示错误，不跳页。

### File Operation Errors

- 路径逃逸
- 文件不存在
- 目标已存在
- 冲突写入
- 非法重命名

错误处理原则：

- 文件树操作错误在当前上下文展示
- editor 写入冲突继续沿用现有 editor 行为
- 删除失败不做静默吞掉

### External Mutation

用户可能直接在磁盘上改 `~/.agents/skills/<slug>`。

v1 不要求做实时 watch，但要求：

- 面板 refresh 后能看到外部变化
- 如果打开中的 skill 文件保存时发现内容已变，给出冲突反馈

## Testing Strategy

### Server

- `skills.custom.create`
  - 创建成功
  - slug 冲突
  - 非法名称归一化
  - 模板文件生成
- `skills.files.*`
  - readTree/read/write/create/mkdir/rename/delete
  - 路径逃逸保护
  - 冲突写入
  - 根目录约束

### Web

- `Custom Skills` section 渲染与空状态
- create dialog 流程
- 创建后自动进入详情并打开 `SKILL.md`
- 文件树展开、打开、创建、重命名、删除
- skill 文件以 `skill` 来源进入 editor
- enable/disable 与 delete 的交互不回归
- skill path drag payload 正确生成并可被 agent drop 消费

### Integration

- 创建 custom skill 后立刻出现在 `skills.library.list`
- 打开并保存 `SKILL.md` 后文件内容落盘
- 删除 skill 后目录和索引都消失

## Risks

### Editor Assumptions Are Workspace-Centric

当前 editor、tab、open file state 和保存路径都假设文件来自 workspace。这个假设如果只改一半，会导致：

- tab 身份冲突
- 保存分发错误
- display path 混乱

因此实现时不能只加一两个 `if`；至少要把“文件来源”作为 editor 一等概念引入。

### Deleting Mounted Local Skills Must Stay Coherent

当前 `skills.uninstall` 已经会删除 `libraryPath`。新增 custom skill 创作链路后，删除动作必须继续与 mount/unmount 关系保持一致，不能出现：

- 目录删了但 mount relation 还在
- 索引删了但详情页还保留旧状态

### Drag Model Drift

如果 skill 路径拖拽和 workspace 路径拖拽最终行为不同，用户会困惑。因此两者必须都坚持“拖入即插入路径文本”的一致心智。

## Open Questions Resolved

- 自定义 skill 是否全局共享：是。
- 创建后是否默认启用：否。
- 拖到 agent 是否作为特殊 skill 附件：否，只插入路径。
- 是否在技能面板内重做编辑器：否，复用现有 editor。
- 文件树是否需要基础文件管理：是，但只做轻量操作。

## Summary

这次设计不是给 `Skills` 面板再拼一个“迷你 IDE”，也不是把全局 skill 强行塞进 workspace 文件模型，而是补上一条完整、轻量、语义正确的自定义 skill 创作流：

- 在 `Skills` 面板里创建全局 custom skill
- 在详情页里管理它的目录和文件
- 在现有 editor 里编辑文件
- 在 agent 中通过拖拽路径把它交给会话处理

这样既能满足“可编辑”的诉求，又不会让 `Skills` 面板变成第二套沉重的工作台。
