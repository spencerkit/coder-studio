Date: 2026-06-20
Status: Draft
Owner: codex

## Problem

当前 skill library 的主分类字段是 `source`，取值为：

- `builtin`
- `skillhub`
- `local`

这个模型已经不足以表达产品当前的实际需求。

现状里有三类用户可见 skill：

1. Coder Studio 内置 skill
2. 通过 Skill Hub 或第三方方式安装的 skill
3. 由 Coder Studio 在产品内创建并管理的自定义 skill

但当前模型把第 2 类和第 3 类都可能落到“本地目录 + `local`”这一类里，导致：

- 第三方安装或手工放入 `~/.agents/skills` 的 skill 会被误认为 `Custom Skills`
- custom 专属能力，例如文件树、文件编辑、删除确认，也会错误暴露给第三方本地 skill
- custom skill 启用后会被 mount 到 agent skill 目录中，如果扫描器再次扫描该目录，会把 mirror 再次统计成一条已安装 skill
- builtin skill 也有同样的问题：builtin canonical 本体在 Coder Studio 自己的目录里，但 mount 后的 mirror 如果出现在扫描目录中，也可能被重新扫成一条本地 skill

当前代码已经暴露出这个问题：

- 本地扫描把 `~/.agents/skills` 下所有 skill 都标成 `source: "local"`
- 前端把 `source === "local"` 直接归入 `Custom Skills`
- builtin stale cleanup 已经包含一段“识别 local symlink 实际指向 builtin canonical”的补救逻辑，说明 mirror 被误扫的问题已经真实存在

问题的根源不是某一个判断条件写错，而是 skill 分类语义本身不清晰，并且 canonical skill 与 mounted mirror 缺少统一边界。

## Goals

- 用一个统一的主字段表达 skill 的产品分类，避免“来源”和“管理方式”混用。
- 给 custom skill 一个独立 canonical 根目录，不与第三方本地 skill 混放。
- 明确 builtin 和 custom 的 canonical 本体与 mounted mirror 的区别。
- 确保 mounted mirror 不会被再次扫描成新的 library entry。
- 让 custom 专属能力只对 custom 生效。
- 保持 builtin、installed、custom 在 UI 中的分组和行为一致、可预测。

## Non-Goals

- 这次不重做整个 Skills 面板视觉结构。
- 这次不引入 workspace 级 custom skill。
- 这次不做旧 custom skill 自动迁移；用户已确认当前没有需要迁移的数据。
- 这次不改变 provider 的挂载目录策略；只改变 library 分类和扫描逻辑。
- 这次不把 external local skill 变成可编辑资源。

## Current Context

### Current Library Classification

当前核心类型定义：

- `packages/core/src/domain/skill-management.ts`

其中 `SkillLibraryEntry.source` 只有三种：

- `builtin`
- `skillhub`
- `local`

当前 `local` 被同时用于：

- 扫描 `~/.agents/skills` 得到的第三方或手工 skill
- 由 `skills.custom.create` 创建的 custom skill

因此前端和服务端一旦使用 `source === "local"` 作为“custom”的代理条件，就必然产生误判。

### Current Canonical Roots

当前 builtin canonical 目录已经独立存在：

- `join(stateRoot, "state", "skills", "builtin", <slug>)`

当前 Skill Hub 安装目录也独立存在：

- `join(stateRoot, "state", "skills", "library", <slug>)`

当前 custom skill 没有自己的 canonical 根目录，仍然创建在：

- `~/.agents/skills/<slug>`

这使得 custom 与 external local skill 在物理上混放。

### Current Mount Behavior

skill mount 逻辑统一通过 `SkillMountManager` 执行：

- canonical library entry 提供 `libraryPath`
- mount 目标使用 provider 的 `skillMountDirectories[0]`
- 默认优先创建 symlink
- symlink 失败时回退到 copy

这意味着：

- builtin/custom canonical 本体和 mounted mirror 是两个不同概念
- mirror 可能是 symlink，也可能是 copy
- 不能只通过“是否为 symlink”判断一个条目是不是 mirror

### Current Builtin Cleanup

builtin stale cleanup 已包含识别“扫描出来的 local entry 实际是指向 builtin canonical 的 symlink artifact”的逻辑。

这说明：

- builtin mirror 被扫描为本地 skill 的情况已经出现
- 当前方案主要靠事后清理解决，而不是从扫描阶段排除 mirror

## User Decisions Captured

- custom skill 使用独立目录，不与其他 skill 混放。
- custom skill 根目录使用 Coder Studio 的 state root 派生目录。
- 当前没有历史 custom skill 需要迁移，可以不处理自动搬迁。
- 主分类应统一成一个字段，不希望用多个交叉字段决定主行为。
- custom skill 启用后同步到 agent skill 目录，但不能因此在 installed 列表里再显示一遍。
- builtin 也必须避免同类 mirror 重复统计问题。

## Approaches Considered

### Option A: 保持现有 `source`，只增加 `isCustom`

优点：

- 改动面看似较小

缺点：

- 主分类仍然分裂为多个字段
- `source` 继续承担不完整语义
- 后续代码仍容易继续把 `source === "local"` 当作 custom 代理
- builtin/custom mirror 去重语义仍不统一

### Option B: 保持目录不变，只重命名 `source`

优点：

- 可减少部分 UI 误判

缺点：

- custom 仍与 external local skill 混放
- mirror 问题依旧存在
- 物理模型和逻辑模型不一致

### Option C: 统一主字段 + custom 独立 canonical 目录 + mirror 扫描排除

优点：

- 主分类语义清晰
- custom、installed、builtin 三类边界明确
- builtin 和 custom 的 mirror 问题能用同一套机制解决
- UI、命令、文件权限都可以收口到统一判断

缺点：

- 需要修改 core 类型、扫描逻辑、repo merge、部分前端分组和命令判定

## Final Choice

采用 Option C。

## Final Model

### Unified Classification Field

`SkillLibraryEntry.source` 改为以下统一主分类：

- `builtin`
- `installed`
- `custom`

含义定义如下：

- `builtin`
  - 由 Coder Studio 内置并 materialize 的 canonical skill
- `installed`
  - 非 builtin、非 custom 的所有已安装 skill
  - 包含 Skill Hub 安装项
  - 包含扫描到的 external local skill
- `custom`
  - 由 Coder Studio 在产品内创建和管理的 custom skill

这个字段是产品主分类字段，以下行为只依赖它：

- Skills 面板分组
- 是否显示 custom 文件树和文件管理动作
- 删除/卸载语义
- 自定义 skill API 与命令访问权限

### Optional Origin Metadata

如果需要保留 installed skill 的细分来源，可增加可选元数据：

- `origin?: "builtin" | "skillhub" | "filesystem"`

使用规则：

- `source` 决定主分组和主行为
- `origin` 只用于辅助展示或能力判断

例如：

- `source === "installed" && origin === "skillhub"` 才允许版本检查与更新
- `source === "installed" && origin === "filesystem"` 只显示为本地已安装 skill，不显示更新

`origin` 不是主分类字段，不参与 `Custom Skills / Installed / Built-in` 分组。

## Canonical Directories

### Builtin Canonical Root

保持现有路径：

- `join(stateRoot, "state", "skills", "builtin")`

每个 builtin skill 的 canonical 路径为：

- `join(builtinRoot, slug)`

### Installed Canonical Root

Skill Hub 安装项保持现有 managed library 根目录：

- `join(stateRoot, "state", "skills", "library")`

这类条目写入：

- `source: "installed"`
- `origin: "skillhub"`

### Custom Canonical Root

新增 custom canonical 根目录：

- `join(stateRoot, "state", "skills", "custom")`

每个 custom skill 的 canonical 路径为：

- `join(customRoot, slug)`

`skills.custom.create` 只能在这里创建 custom skill，不再写入 `~/.agents/skills`。

### External Local Scan Roots

外部本地 skill 继续扫描 agent 生态目录，例如：

- `~/.agents/skills`

扫描得到的条目写入：

- `source: "installed"`
- `origin: "filesystem"`

## Mounted Mirror Model

### Canonical vs Mirror

对 builtin 和 custom，必须明确区分：

- canonical skill
  - library 中唯一真实条目
  - 拥有自己的 canonical 根目录
- mounted mirror
  - 为了让 provider/agent 读取 skill 而同步到 provider skill 目录中的镜像
  - 可能是 symlink，也可能是 copy
  - 不是新的 library entry

mirror 绝不能被再次统计为 installed skill。

### Managed Mirror Marker

为所有 Coder Studio 管理的 canonical skill 写一个隐藏 marker 文件：

- `.coder-studio-skill.json`

marker 最少包含：

- `version: 1`
- `managedBy: "coder-studio"`
- `source: "builtin" | "custom"`
- `slug: string`

要求：

- builtin canonical 写入 marker
- custom canonical 写入 marker
- mount 为 symlink 时，marker 会自然透出
- mount 为 copy 时，marker 也必须被复制过去

### Mirror Exclusion Rule

扫描 external local roots 时，如果发现 skill 目录包含 marker 且：

- `managedBy === "coder-studio"`

则该目录被视为 mounted mirror，必须直接跳过，不生成 library entry。

这个排除规则统一适用于：

- builtin mirror
- custom mirror

不能只对 custom 生效。

### Slug Fallback Guard

除 marker 外，再增加 slug 级兜底：

- 如果某个 slug 已在 builtin canonical 或 custom canonical 中存在
- 扫描 external local roots 时发现同 slug 目录
- 且该目录是从 Coder Studio canonical mount 出来的 mirror

则必须跳过

marker 是主判定方式，slug 兜底是为兼容 copy/symlink 异常或历史状态。

## Server Behavior Changes

### Local Scanner

本地扫描器需要拆分语义：

- 扫描 custom canonical root
- 扫描 external installed roots

不再使用单一“所有本地目录统一映射为 `local`”的模型。

扫描输出：

- custom canonical -> `source: "custom"`, `origin: "filesystem"`
- external local -> `source: "installed"`, `origin: "filesystem"`

扫描 external local roots 时必须先执行 mirror exclusion。

### Custom Skill Creation

`skills.custom.create`：

- 根目录改为 custom canonical root
- 写入 `SKILL.md`
- 写入 `.coder-studio-skill.json`
- 返回 library entry：
  - `source: "custom"`
  - `origin: "filesystem"`

创建前必须做 slug 全局冲突检查。

### Skill Hub Install

Skill Hub 安装完成后写入 library entry：

- `source: "installed"`
- `origin: "skillhub"`

### Builtin Materialization

builtin materialize 输出 entry：

- `source: "builtin"`
- `origin: "builtin"`

同时 builtin canonical 目录也应写入 marker。

### Skill Library Repo Merge

repo merge 规则需要显式化，不能再依赖“`source === local` 就覆盖”的旧逻辑。

推荐优先级：

1. builtin canonical
2. custom canonical
3. managed installed entries
4. external local scanned installed entries

规则：

- builtin 不被 external scan 覆盖
- custom 不被 external scan 覆盖
- managed installed 不被 external filesystem scan 覆盖
- external local scanned item 只在 slug 不冲突时补充进入库
- 已存在的 persisted entry 若拥有更高优先级，扫描结果只能刷新有限的派生字段，不能整体降级覆盖

### File Management Commands

以下命令只允许 `source === "custom"`：

- `skills.files.readTree`
- `skills.files.read`
- `skills.files.write`
- `skills.files.create`
- `skills.files.mkdir`
- `skills.files.rename`
- `skills.files.delete`
- `/api/skill-file`

如果是 `installed` 或 `builtin`，应返回明确错误。

### Delete / Uninstall Semantics

- `builtin`
  - 不可卸载
- `installed`
  - 执行 uninstall 语义
- `custom`
  - 执行 delete 语义

`custom` delete 流程：

1. 找到所有 mount relations
2. unmount 所有 enabled mirror
3. 删除 mount repo relations
4. 删除 custom canonical 目录
5. 删除 library entry
6. 广播 library changed

对于 `installed + origin: "filesystem"` 的 external local skill：

- 不应从 Coder Studio 内直接删除第三方目录
- 推荐只支持 unmount，不支持删除底层目录

如果保留 “uninstall” 按钮，应明确它只解除 Coder Studio 管理关系，不删除源目录。更保守的做法是不展示删除/卸载目录动作。

## Frontend Behavior Changes

### Section Grouping

Skills panel 分组统一改为：

1. `Custom Skills`
   - `source === "custom"`
2. `Installed`
   - `source === "installed"`
3. `Built-in`
   - `source === "builtin"`
4. `Discover`

### Detail View

detail view 行为：

- `custom`
  - 显示文件树
  - 显示新建文件/文件夹
  - 支持重命名、删除、拖拽路径
- `installed`
  - 不显示 custom 文件管理动作
- `builtin`
  - 不显示 custom 文件管理动作

### Labels

若存在 `origin`：

- `installed + skillhub` 可显示 `Skill Hub`
- `installed + filesystem` 可显示 `Local`

这只是说明性标签，不改变主分组。

### Update Button

只有以下条件才显示更新：

- `source === "installed"`
- `origin === "skillhub"`

## Conflict Rules

skill slug 在 library 视角必须唯一。

创建 custom 时必须检查：

- builtin canonical 中是否已有该 slug
- persisted installed entries 中是否已有该 slug
- custom canonical 中是否已有该 slug
- external local 扫描结果中是否已有该 slug

冲突时返回明确错误，例如：

- `skill_slug_conflict`

这样可以避免 custom 与 installed/builtin 之间的展示和 mount 歧义。

## Testing Plan

### Core and Domain

- `SkillLibrarySource` 新枚举值测试
- `SkillLibraryEntry` 新可选 `origin` 测试

### Scanner

- custom canonical 扫描返回 `source: "custom"`
- external local 扫描返回 `source: "installed"`
- external local 中带 managed mirror marker 的 custom 目录被跳过
- external local 中带 managed mirror marker 的 builtin 目录被跳过

### Builtin

- builtin canonical materialize 输出 `source: "builtin"`
- builtin mount 到 provider skill 目录后不会再以 installed 形式进入 library
- 历史 stale cleanup 测试继续保留，作为遗留垃圾回收保障

### Custom

- `skills.custom.create` 在 custom canonical root 下创建目录
- 创建时写 marker
- custom mount 到 `.agents/skills` 后不会新增 installed entry

### Installed

- Skill Hub 安装写入 `source: "installed", origin: "skillhub"`
- external filesystem skill 写入 `source: "installed", origin: "filesystem"`
- external filesystem installed 不显示 update

### Repo Merge

- external scanned entry 不覆盖 builtin/custom/managed installed
- 同 slug custom 存在时，external scanned item 被跳过

### Commands and Routes

- `skills.files.*` 仅 custom 可用
- `/api/skill-file` 仅 custom 可用
- custom delete 会先 unmount 再删 canonical
- builtin uninstall 被拒绝

### Frontend

- `custom` 只在 `Custom Skills` section 中显示
- `installed` 只在 `Installed` section 中显示
- `builtin` 只在 `Built-in` section 中显示
- enabled custom 不会在 Installed 再出现
- enabled builtin 不会在 Installed 再出现
- 只有 custom 有文件树与文件操作
- 只有 skillhub installed 有 update

## Risks

- `source` 枚举变更会影响 server/web tests 和任何持久化快照，需要一次性修全。
- 若历史 `library-index.json` 中保留旧枚举值，需要在读取时做兼容映射。
- copy fallback 挂载场景下，如果 marker 没有被完整复制，会导致 mirror exclusion 失效，因此 marker 必须作为 mount copy 的一部分受测试保护。

## Compatibility

历史数据兼容策略：

- 读取旧 entry 时：
  - `builtin` -> `builtin`
  - `skillhub` -> `installed` + `origin: "skillhub"`
  - `local`
    - 若路径位于 custom canonical root -> `custom` + `origin: "filesystem"`
    - 否则 -> `installed` + `origin: "filesystem"`

用户已确认当前没有需要迁移的老 custom skill，因此不需要自动文件迁移流程。

## Implementation Outline

1. 更新 core domain 类型与兼容映射
2. 为 builtin/custom canonical 写 marker
3. 重构本地扫描器，拆分 custom root 与 external local roots
4. 在 external 扫描中加入 managed mirror exclusion
5. 更新 SkillLibraryRepo merge 优先级
6. 更新 `skills.custom.create`
7. 更新 Skill Hub install entry 写入模型
8. 更新 `skills.files.*` 与 `/api/skill-file` 的访问判定
9. 更新 Skills panel 分组、detail view、按钮显示
10. 补齐 server/web 回归测试
