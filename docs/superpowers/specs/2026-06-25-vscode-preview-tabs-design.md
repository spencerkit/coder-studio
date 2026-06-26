# VSCode Preview Tabs - Design

Date: 2026-06-25
Status: Draft
Owner: Codex

## Problem

当前编辑器的文件打开行为更接近“每次打开都追加一条记录”的模式，和 VSCode 的 tab 交互不一致。

用户希望的是：

- 单击文件时，先以 preview 方式打开，复用当前 preview tab
- 再单击别的文件时，当前 preview tab 的内容被替换
- 双击文件时，把该文件固定成独立 tab
- 右键 tab 时，提供和 VSCode 接近的关闭动作

现在的实现里，文件打开会直接落到持久化 open 列表中，`openEditorPaths` 和 `openEditorTabs` 的语义也混在一起，导致无法区分 preview tab 和 pinned tab。

## Goals

- 文件树单击行为改成 VSCode 风格 preview 打开
- 文件树双击行为改成固定 tab
- preview tab 在首次编辑时自动固定
- tab 右键提供：
  - Close
  - Close Others
  - Close to the Right
  - Close Saved
  - Close All
  - Keep Open
- 兼容现有 browser tab 和 canvas tab 行为，不破坏它们的独立语义

## Non-Goals

- 不改 browser tab 的打开模型
- 不改 canvas tab 的打开模型
- 不做全局 IDE 命令中心
- 不新增用户设置项来关闭 preview 模式
- 不做 inline rename 或拖拽分组

## VSCode Baseline

VSCode 的公开文档说明：

- Explorer 单击文件会进入 preview mode，并复用 preview tab
- 双击或开始编辑会把文件变成 dedicated tab
- preview tab 会以斜体标识

官方 tab 右键菜单还包含：

- Close
- Close Others
- Close to the Right
- Close Saved
- Close All
- Keep Open / Pin / Unpin

## Proposed Model

给文件 tab 增加固定态字段：

```ts
interface WorkspaceFileEditorTab {
  kind: "file";
  path: string;
  pinned?: boolean;
}
```

约定：

- `pinned: true` 表示固定 tab
- `pinned` 缺省或 `false` 表示 preview tab
- 旧数据默认按 pinned 处理，避免历史 workspace 丢状态

## Interaction Rules

### Single Click

文件树单击时：

- 如果当前存在未固定 preview tab，则用新文件替换它
- 如果目标文件已经以 pinned tab 打开，则只激活该 tab
- 如果没有 preview tab，也没有 pinned 命中，则创建一个 preview tab

### Double Click

文件树双击时：

- 如果目标文件当前是 preview tab，则直接 pin 它
- 如果目标文件已经打开，则确保它是 pinned
- 如果没打开，则新建 pinned tab

### Start Editing

如果用户在 preview tab 中直接修改内容，系统应自动把该 tab 标记为 pinned。

这和 VSCode 的“开始编辑即固定”一致。

### Close

- Close 只关闭当前 tab
- Close Others 关闭除当前 tab 外的其他 tab
- Close to the Right 关闭当前 tab 右侧的 tab
- Close Saved 关闭所有未 dirty 的文件 tab
- Close All 关闭全部 tab
- Keep Open 只对 preview tab 显示，点击后把当前 tab 固定

### Dirty Handling

保持现有未保存确认逻辑：

- dirty 文件关闭时仍然弹确认
- Close Saved 不会关 dirty 文件
- Close All 会走现有批量关闭确认

## Implementation Shape

### 1. State and Normalization

修改 `packages/web/src/features/workspace/atoms/files.ts` 和
`packages/web/src/features/workspace/actions/open-editor-state.ts`：

- 为 file tab 增加 `pinned`
- hydrate / normalize 时兼容旧状态
- 让 preview tab 和 pinned tab 在持久化里能被区分

### 2. Open Entry Point

修改 `packages/web/src/features/workspace/actions/use-open-workspace-file.ts`：

- 增加打开意图参数，例如 `openDisposition: "preview" | "pinned"`
- 文件树单击传 preview
- 文件树双击传 pinned
- 现有代码里显式调用打开文件的地方，按语义选 preview 或 pinned

### 3. Editor Actions

修改 `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`：

- 实现 preview tab 替换
- 实现 pin / unpin
- 实现点击 tab 的激活逻辑
- 实现右键菜单所需的批量关闭逻辑
- 在内容变更时自动 pin preview tab

### 4. UI Surface

修改 `packages/web/src/features/code-editor/views/shared/code-editor-tabs-header.tsx`：

- preview tab 用斜体或等价视觉样式标识
- tab 上增加右键菜单入口
- 右键菜单复用文件树已有的菜单交互能力，但命令集合换成 editor tab 语义

修改 `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`：

- 文件行支持双击
- 单击保持 preview open
- 双击执行 pin open

### 5. Menu Layer

建议把当前 `file-context-menu` 的定位和键盘导航能力抽成可复用层，然后 editor tab 菜单和 file tree 菜单共用。

原因是：

- 右键菜单都是坐标锚定
- 需要一致的键盘/escape/focus 行为
- 以后如果再扩 editor 级动作，不想再做一套菜单壳

## Approaches Considered

### Option A: 只改文件打开逻辑，tab 右键先不做

优点：

- 改动最小
- 风险最低

缺点：

- 只解决一半问题
- 和 VSCode 差异仍然明显

### Option B: Preview / pinned + editor tab 右键菜单同步落地

优点：

- 最接近 VSCode
- 行为闭环完整
- 一次把用户感知最强的两个点一起修正

缺点：

- 需要同时动 state、open flow、tab UI、menu

### Option C: 再加设置项和更复杂的 tab 分组策略

优点：

- 可配置性最好

缺点：

- 明显超出当前需求
- 容易把问题拖成一个更大的 editor 系统改造

## Final Choice

采用 Option B。

原因很直接：这次需求本质上是把编辑器行为对齐到 VSCode，单做 preview 不够，单做右键菜单也不够。两个部分一起做，用户感知才是完整的。

## Testing

重点测试：

- 单击 A 再单击 B，只保留一个 preview tab
- 双击 B 后，B 变成 pinned
- preview tab 编辑后自动 pin
- Close Saved 不关闭 dirty 文件
- Close to the Right 按顺序关闭右侧 tab
- 旧 workspace state hydrate 后仍然能正确识别 pinned 文件 tab
- browser / canvas tab 的行为不被这次改动影响

## Risks

- `openEditorPaths` 和 `openEditorTabs` 当前有一定重叠，改造时要避免两套状态继续互相覆盖
- 单击和双击的点击序列要处理好，避免双击时先闪出 preview 再被错误持久化
- 右键菜单如果只做文件 tab 版本，后续可能还会有人想把 browser / canvas tab 一并统一

## References

- VSCode docs preview mode: https://code.visualstudio.com/docs/getstarted/userinterface#_preview-mode
- VSCode editor title context menu source: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editor.contribution.ts
