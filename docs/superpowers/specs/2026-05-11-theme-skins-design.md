# Theme Skins System — Design

Date: 2026-05-11
Status: Draft
Owner: spencer

## Problem

当前项目的外观系统只正式支持 `dark` 和 `light` 两种主题，并且这两个值已经被写入多个层面：

- Web UI 通过 [`tokens.css`](../../../packages/web/src/styles/tokens.css) 的 `[data-theme="light"]` 覆盖实现明暗切换
- 应用状态通过 [`themeAtom`](../../../packages/web/src/atoms/app-ui.ts) 持久化 `dark | light`
- 设置页通过 [`settings.update`](../../../packages/server/src/commands/settings.ts) 写入 `appearance.theme`
- 终端在 [`XtermHost`](../../../packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx) 内维护独立的 dark/light xterm palette
- Monaco 编辑器在 [`MonacoHost`](../../../packages/web/src/features/code-editor/components/monaco-host.tsx) 内根据 `dark | light` 选择 `vs-dark` 或 `vs`
- UI preview、e2e-ui 截图和相关测试基建也把主题维度写成了 `dark | light`

这使得“再加几套皮肤”并不是一个只改 CSS 的问题。如果继续把更多主题直接堆在 `theme: "dark" | "light"` 上，UI、终端、Monaco、预览和测试都会迅速退化为大量字符串分支判断，后续难以维护。

本次需要把当前的明暗主题升级为可扩展的皮肤系统，同时保持用户侧设置足够简单，避免把产品交互直接升级成复杂的主题编辑器。

## Goals

- 支持多个内置官方皮肤，而不止 `dark` / `light` 两种外观。
- 用户侧仍然只选择一个当前主题值，设置模型保持简单。
- 每个主题都能同时驱动：
  - Web UI token
  - xterm 终端配色
  - Monaco 编辑器配色
- 支持成对主题族，例如 `Mint Dark / Mint Light`。
- 服务端设置为权威来源，本地只做启动缓存和首屏加速。
- 第一阶段仅支持内置官方皮肤，但架构上预留后续扩展空间。
- 至少包含一组高对比度主题，作为可访问性的一等公民。

## Non-Goals

- 不实现用户自定义主题编辑器。
- 不在第一阶段支持从外部文件、插件或远端下载主题。
- 不让用户分别独立选择“UI 主题 / 终端主题 / 编辑器主题”。
- 不在第一阶段实现“跟随系统自动切换 light/dark”。
- 不重写整个组件样式体系；现有组件仍然通过共享语义 token 消费颜色。

## User Decisions Captured

- 外观系统目标不是简单增加几个 `dark/light` 变体，而是支持“更多皮肤”。
- 用户侧不暴露 `mode + skin` 两层设置，仍然保持单一当前主题选择。
- 主题需要覆盖 UI、终端和 Monaco 三层。
- 第一阶段只做内置官方皮肤，但架构上预留未来扩展能力。
- 主题权威来源为服务端设置，本地只做缓存。
- 首批官方主题采用“成对主题族”组织。
- 第一阶段应包含高对比度主题。

## Approaches Considered

### Option A: 继续扩展现有 `theme` 字段，直接使用复合字符串

例如：

- `dark-mint`
- `light-mint`
- `dark-nord`
- `hc-dark`

优点：

- 表面改动最少。
- 用户侧仍然只有一个当前主题值。

缺点：

- 主题名本身会承载过多语义。
- UI、终端、Monaco、测试都容易演化为直接对字符串做分支判断。
- 后续加入高对比度、系统跟随、主题族切换时，代码耦合会迅速增加。

### Option B: 用户侧单 `themeId`，内部建立中央主题注册表（推荐）

优点：

- 用户体验接近 VS Code，设置简单。
- 内部仍然可以显式声明 `kind`、`family`、可访问性标签、xterm palette、Monaco theme 等元数据。
- 所有消费方共享同一份主题解析结果，避免字符串散落。
- 与当前代码结构兼容，不需要把产品交互升级成双字段模型。

缺点：

- 需要一次性改造类型、设置、预览和测试基建。
- 需要为每个主题显式维护 UI/xterm/Monaco 三套定义。

### Option C: 用户分别选择 UI / Terminal / Editor 三套主题

优点：

- 灵活度最高。
- 可覆盖少数用户对 UI 与终端风格不一致的偏好。

缺点：

- 交互复杂度明显上升。
- 设置模型和测试矩阵膨胀。
- 超出当前“增加皮肤支持”的范围。

## Final Choice

采用 Option B。

最终模型为：

- 用户侧和持久化层只保留单一 `themeId`
- 主题的 `dark/light/high-contrast` 等语义不作为独立用户设置暴露，而是作为每个主题定义的元数据
- 所有 UI、xterm、Monaco、预览和测试都通过中央主题注册表解析主题，而不是自行判断字符串

这能同时满足以下目标：

- 对用户简单
- 对实现可扩展
- 对未来增加主题族、高对比度主题、系统跟随和外部扩展都留有空间

## Final Design

### 1. Settings Model

新增权威设置键：

- `appearance.themeId: string`

本地缓存键：

- `ui.themeId: string`

兼容旧值：

- `appearance.theme: "dark" | "light"`
- `ui.theme: "dark" | "light"`

兼容映射规则：

- `dark -> mint-dark`
- `light -> mint-light`

说明：

- 服务端 `appearance.themeId` 是长期权威来源
- 浏览器本地 `ui.themeId` 只用于应用启动时的快速恢复和减少首屏闪烁
- 一旦新设置链路完成保存，前端与服务端都应优先写入和读取 `themeId`
- 旧字段在迁移期继续容忍读取，但不再作为新的主写入路径

### 2. Theme Registry

新增中央主题注册表模块，负责声明和导出所有内置主题定义。

每个主题定义至少包含：

- `id`
- `family`
- `kind`
- `labelKey`
- `pairedThemeId`
- `isHighContrast`
- `documentThemeAttr`
- `terminalTheme`
- `monaco`

建议类型形状：

```ts
type ThemeKind = "dark" | "light" | "hc-dark" | "hc-light";

interface MonacoThemeDefinition {
  id: string;
  base: "vs" | "vs-dark";
  inherit: boolean;
  colors: Record<string, string>;
  rules: monaco.editor.ITokenThemeRule[];
}

interface AppThemeDefinition {
  id: string;
  family: "mint" | "graphite" | "nord" | "hc";
  kind: ThemeKind;
  labelKey: string;
  pairedThemeId?: string;
  isHighContrast: boolean;
  documentThemeAttr: string;
  terminalTheme: ITheme;
  monaco: MonacoThemeDefinition;
}
```

关键原则：

- 用户设置只保存 `id`
- 所有 `dark/light/high-contrast` 语义都从 registry 元数据推导
- 不允许 UI、终端、Monaco 自己重新发明主题判定逻辑

### 3. Theme Families

第一阶段内置 4 个 family：

- `Mint`
- `Graphite`
- `Nord`
- `High Contrast`

第一阶段主题列表：

- `mint-dark`
- `mint-light`
- `graphite-dark`
- `graphite-light`
- `nord-dark`
- `nord-light`
- `hc-dark`
- `hc-light`

主题族要求：

- 常规 family 默认成对提供 dark/light 两个主题
- 高对比度 family 也提供 dark/light 两个主题
- registry 中为每个主题声明 `pairedThemeId`
- 设置页通过 `family + variant` 交互帮助用户切换，但最终持久化仍写单一 `themeId`

### 4. Web UI Token Strategy

现有 [`tokens.css`](../../../packages/web/src/styles/tokens.css) 架构保留，但从“仅 light 覆盖 dark 默认”升级为“按 `data-theme` 定义主题”。

组织方式：

- `:root`
  - 只保留不随皮肤变化的基础 token
  - 例如 spacing、radius、font、z-index、touch、尺寸
- `:root, [data-theme="mint-dark"]`
  - 作为默认主题的完整颜色 token
- 其他主题分别使用独立 block 覆盖：
  - `[data-theme="mint-light"]`
  - `[data-theme="graphite-dark"]`
  - `[data-theme="graphite-light"]`
  - `[data-theme="nord-dark"]`
  - `[data-theme="nord-light"]`
  - `[data-theme="hc-dark"]`
  - `[data-theme="hc-light"]`

组件层继续只使用语义 token，例如：

- `--bg-surface`
- `--text-primary`
- `--border-focus`
- `--color-success`

组件层不感知具体主题 ID。

### 5. Terminal Theme Strategy

终端配色不能依赖 CSS token 自动推导。

原因：

- xterm 需要独立定义 ANSI palette
- 可读性约束比普通 UI 更严格
- 高对比度主题往往需要单独人工校准

因此每个主题定义必须显式提供一套 `terminalTheme`，由 registry 统一管理。

[`XtermHost`](../../../packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx) 只消费解析后的结果：

- 不再直接维护 `dark` / `light` 两套主题常量
- 不再以 `uiTheme === "light"` 之类的条件决定终端颜色
- 统一改为 `resolveAppTheme(themeId).terminalTheme`

### 6. Monaco Theme Strategy

Monaco 也不应只做 `vs` / `vs-dark` 二选一。

推荐策略：

- 每个主题定义提供：
  - `base: "vs" | "vs-dark"`
  - `colors`
  - `rules`
- 运行时通过 registry 注册和切换 Monaco 主题

[`MonacoHost`](../../../packages/web/src/features/code-editor/components/monaco-host.tsx) 改为：

- 不再通过 `uiTheme === "light" ? "vs" : "vs-dark"` 决定主题
- 启动时确保对应主题已通过 `monaco.editor.defineTheme()` 注册
- 切换时调用 `monaco.editor.setTheme(resolvedTheme.monaco.id)`

说明：

- `kind` 仍然有价值，因为它决定 Monaco 主题应继承 `vs` 还是 `vs-dark`
- 但最终是否高可读、是否与 UI 一致，仍需每个主题独立人工校准

### 7. Runtime Resolution Flow

新增统一主题解析模块，职责只做“加载、解析、应用”，不与设置页具体 UI 耦合。

启动阶段：

1. 读取本地 `ui.themeId`
2. 若不存在，则读取旧 `ui.theme`
3. 映射得到当前主题
4. 立即写入 `document.documentElement.dataset.theme`

连接后同步阶段：

1. 调用 `settings.get`
2. 优先读取 `appearance.themeId`
3. 若不存在，则读取旧 `appearance.theme`
4. 映射得到当前主题
5. 更新运行态 atom
6. 回写本地 `ui.themeId`

设置变更阶段：

1. 设置页本地立即切换当前主题
2. 更新 `document.documentElement.dataset.theme`
3. 调用 `settings.update({ appearance: { themeId } })`
4. 保存成功后维持现状
5. 保存失败时保留即时切换行为，后续如有需要可补充 toast 或回滚策略

### 8. Settings Page Interaction

用户侧仍然只持久化单一 `themeId`，但设置页交互采用“两段式选择”以适配成对主题族。

分组 1：

- Theme Family
  - Mint
  - Graphite
  - Nord
  - High Contrast

分组 2：

- Variant
  - Dark
  - Light

交互规则：

- 当前 `themeId` 先解析出 `family` 与 `kind`
- 切换 family 时：
  - 若目标 family 存在当前 kind 对应主题，则切到该主题
  - 例如 `mint-dark -> nord-dark`
- 切换 variant 时：
  - 在当前 family 内切到对应主题
  - 例如 `graphite-dark -> graphite-light`
- 若未来某个 family 只提供一个 variant，则设置页需要对不可用 variant 做禁用或隐藏处理

持久化规则保持不变：

- 最终写入的始终是 `appearance.themeId`

### 9. Backward Compatibility

本次不要求数据库迁移脚本强制清洗旧数据。

采用“读兼容、写新值”的渐进式迁移：

- `settings.get`
  - 返回新旧字段时，前端优先消费 `appearance.themeId`
- `settings.update`
  - 接受新字段 `appearance.themeId`
  - 迁移期内可继续接受旧 `appearance.theme`
- 前端 atom 和本地缓存
  - 优先使用 `ui.themeId`
  - 缺省时回退到旧 `ui.theme`

迁移结果：

- 老用户升级后自动落到默认主题族对应值
- 无需一次性变更 `user_settings` 中所有历史记录
- 系统可以在后续版本再决定是否完全移除旧字段读取逻辑

### 10. Preview and Screenshot Model

当前 UI preview 与 e2e-ui 基建都把主题维度定义为 `dark | light`，需要同步升级。

涉及模块包括：

- [`packages/web/src/ui-preview/scene-metadata.ts`](../../../packages/web/src/ui-preview/scene-metadata.ts)
- [`e2e-ui/scenes/index.ts`](../../../e2e-ui/scenes/index.ts)
- [`e2e-ui/fixtures/prefs.ts`](../../../e2e-ui/fixtures/prefs.ts)
- [`e2e-ui/fixtures/scene-runner.ts`](../../../e2e-ui/fixtures/scene-runner.ts)

升级策略：

- 把 scene 维度从 `theme: "dark" | "light"` 升级为 `themeId`
- 但不要求每个 scene 跑所有主题
- 每个 scene 可以显式声明需要覆盖的主题集

默认建议：

- 常规场景只跑少量代表主题：
  - `mint-dark`
  - `mint-light`
  - `hc-dark`
- 外观设置页、welcome、workspace 主界面等重点视觉场景可额外覆盖 `graphite-*` 与 `nord-*`

目标：

- 保持截图基建可扩展
- 避免主题增多后测试矩阵出现全量笛卡尔积爆炸

### 11. Testing Strategy

测试分三层控制。

#### 11.1 Registry and Token Tests

增加单元测试验证：

- 所有主题 ID 唯一
- 每个主题都声明了 `kind`
- 每个主题都具备 `terminalTheme`
- 每个主题都具备 `monaco` 定义
- 每个主题的 `pairedThemeId` 指向有效主题
- `tokens.css` 中存在对应的 `[data-theme="..."]` block

#### 11.2 App Behavior Tests

关键功能测试覆盖：

- 设置页能够展示 theme family 和 variant 选择
- 切换后立即更新 `document.documentElement.dataset.theme`
- 刷新后能恢复服务端保存的 `themeId`
- 终端在主题切换后更新 palette
- Monaco 在主题切换后更新 editor theme
- 旧值 `dark` / `light` 能正确映射到默认主题

#### 11.3 E2E / Visual Coverage

不要求所有业务流程跑全量主题。

最小覆盖建议：

- 默认主题：`mint-dark`
- 非默认常规主题：例如 `graphite-light`
- 高对比度主题：`hc-dark`

这样既能验证核心能力，也不会让 e2e 成本失控。

## Architecture

```text
server settings (appearance.themeId)
          |
          v
theme state / local startup cache (ui.themeId)
          |
          v
central theme registry + resolver
      |         |         |
      |         |         |
      v         v         v
 document   xterm.js    Monaco
 data-theme  palette    theme
```

## Implementation Notes

### Server

修改：

- [`packages/server/src/commands/settings.ts`](../../../packages/server/src/commands/settings.ts)
- 如有需要，补充 `@coder-studio/core` 中 settings 类型定义

工作内容：

- 扩展 `appearance` schema，支持 `themeId?: string`
- 保留迁移期对旧 `appearance.theme` 的兼容读取能力
- 更新服务端设置相关测试，覆盖新旧值兼容场景

### Web State and Bootstrap

修改：

- [`packages/web/src/atoms/app-ui.ts`](../../../packages/web/src/atoms/app-ui.ts)
- [`packages/web/src/app/providers.tsx`](../../../packages/web/src/app/providers.tsx)

工作内容：

- 将当前 `themeAtom` 从 `dark | light` 升级为 `themeId`
- 增加旧值映射逻辑
- 在启动和 `settings.get` 回填时统一应用主题

### Theme Registry

新增建议：

- `packages/web/src/theme/index.ts`
- `packages/web/src/theme/registry.ts`
- `packages/web/src/theme/resolve.ts`

工作内容：

- 定义主题类型
- 注册首批内置主题
- 提供 `resolveAppTheme(themeId)`、`getThemeFamily(themeId)` 等辅助函数

### UI Tokens

修改：

- [`packages/web/src/styles/tokens.css`](../../../packages/web/src/styles/tokens.css)
- 相关 token 测试文件

工作内容：

- 将颜色 token 从现有 `dark + light` 覆盖升级为多主题 block
- 保持组件层 token 使用方式不变

### Settings UI

修改：

- [`packages/web/src/features/settings/components/settings-page.tsx`](../../../packages/web/src/features/settings/components/settings-page.tsx)
- [`packages/web/src/locales/zh.json`](../../../packages/web/src/locales/zh.json)
- [`packages/web/src/locales/en.json`](../../../packages/web/src/locales/en.json)

工作内容：

- 将当前“深色 / 浅色”按钮升级为 `family + variant` 两组选择
- 仍然只保存 `themeId`
- 补充高对比度相关文案

### Terminal and Monaco

修改：

- [`packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`](../../../packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx)
- [`packages/web/src/features/code-editor/components/monaco-host.tsx`](../../../packages/web/src/features/code-editor/components/monaco-host.tsx)

工作内容：

- 移除直接依赖 `dark | light` 的逻辑
- 统一改为消费解析后的主题定义
- 为 Monaco 注册并切换命名主题

### Preview and E2E UI

修改：

- [`packages/web/src/ui-preview/scene-metadata.ts`](../../../packages/web/src/ui-preview/scene-metadata.ts)
- [`e2e-ui/scenes/index.ts`](../../../e2e-ui/scenes/index.ts)
- [`e2e-ui/fixtures/prefs.ts`](../../../e2e-ui/fixtures/prefs.ts)
- [`e2e-ui/fixtures/scene-runner.ts`](../../../e2e-ui/fixtures/scene-runner.ts)

工作内容：

- 主题维度从 `dark | light` 升级为 `themeId`
- 按 scene 控制截图主题集合

## Rollout Plan

推荐按以下顺序落地：

1. 引入 `themeId` 模型和中央 registry，但先只注册 `mint-dark / mint-light`
2. 打通服务端设置、本地缓存和前端启动兼容迁移
3. 接入 xterm 和 Monaco 主题解析
4. 改造设置页交互为 `family + variant`
5. 扩充 `graphite / nord / high contrast`
6. 升级 preview、e2e-ui 和相关测试矩阵

这样可以先把主题架构站稳，再逐步增加实际皮肤数量，避免在第一步就把改动面拉到最大。
