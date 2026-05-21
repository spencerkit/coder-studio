# Appearance Personalization Design

Date: 2026-05-21
Status: Draft
Owner: Codex

## Problem

当前产品已经支持内建主题切换，`appearance.themeId` 也已经打通 Web UI、Monaco 和 terminal 配色，但“个性化外观”仍停留在主题级别。用户希望在不改动主题定义的前提下，继续自定义背景图、毛玻璃效果、面板透明度等视觉材质，并且这些偏好需要通过服务端同步到账号，在多端保持一致。

现有代码里，主题是一个稳定的基础语义层，而 `settings.get / settings.update` 已经承接了外观设置读写，且终端字号已经证明“共享值 + desktop/mobile 分流”这类外观偏好是可行模式。因此本次应在不破坏现有主题体系的前提下，为外观增加一层可控的个性化偏好系统。

## Goals

- 一期提供服务端同步的个性化外观设置。
- 支持背景图、背景压暗、背景模糊、毛玻璃开关、玻璃强度、面板透明度。
- 保持现有主题系统继续负责语义色板、Monaco、terminal、icon theme。
- 采用“默认共享 + 少数字段允许 desktop/mobile 覆盖”的设置模型。
- 设置修改后即时作用于当前界面，不要求刷新页面。
- 背景图通过受控上传和受控资产引用接入，不开放任意外链 URL。
- 为二期主题包功能保留清晰扩展面。

## Non-Goals

- 一期不做主题包功能。
- 一期不支持任意自定义 CSS、任意 token 注入或脚本化主题。
- 一期不做完全独立的 desktop/mobile 两整套外观配置。
- 一期不为每个 workspace、每个 session 或每个页面单独配置背景图。
- 一期不改写 Monaco 文本层和 terminal 字形层的渲染逻辑，不把毛玻璃直接施加到编辑内容上。
- 一期不引入真实多用户维度的 settings/asset ownership 模型。

## User Decisions Captured

- 外观个性化分两期做，一期先做设置能力，二期再做主题包。
- 一期的能力边界是官方支持的外观偏好，不开放任意 CSS。
- 外观偏好通过服务端全局保存并同步。
- desktop 和 mobile 允许使用两套设置，但不是所有字段都分端。
- 配置模型采用“默认共享，只有少数字段允许覆盖”的模式。

## Approaches Considered

### Option A: Theme 之外新增外观偏好层（推荐）

在 `appearance.themeId` 之外新增 `appearance.personalization`。主题继续定义颜色与编辑器配色，个性化层只负责背景和材质。

优点：

- 边界清晰，主题与个性化职责不混淆。
- 改造范围可控，主要集中在 settings、provider hydration、workbench 容器与共享 surface 样式。
- 最容易兼容后续主题包，把“主题定义”和“用户 overlay”自然叠加。

缺点：

- 需要新增一层解析与应用逻辑。
- 个别共享样式需要从纯主题变量迁移为“主题变量 + 个性化变量”组合。

### Option B: 把背景和玻璃直接并入主题 token

将背景图、毛玻璃、透明度也视为主题的一部分，所有个性化修改本质上都是 token overlay。

优点：

- 理论体系最统一。
- 后续主题包能力容易复用同一套 token 结构。

缺点：

- 一期复杂度过高。
- 会扩大对现有主题注册表和共享样式的改动面。
- 很容易把“内建主题能力”和“用户偏好能力”耦合在一起。

### Option C: 只提供视觉预设和少量开关

只提供几套官方预设，例如“壁纸”“雾面”“极简”，再搭配少量调节项。

优点：

- 产品完成度高，调性更统一。
- 测试矩阵更小。

缺点：

- 自由度不足，不满足用户对背景图和设备覆盖的明确需求。
- 后续扩展到主题包时仍需要补更底层的个性化模型。

## Final Choice

采用 Option A。

一期在现有主题体系之外新增“个性化外观偏好层”，通过 `appearance.personalization` 接管背景图和材质效果。主题继续是稳定的基础视觉语义，个性化层则以 overlay 的方式叠加在主题之上。这样可以在最小改动下支持用户想要的自由度，并为二期主题包保留干净扩展点。

## Final Design

### 1. 配置模型

一期配置继续挂在 `appearance.*` 命名空间下，并沿用现有 `settings.update` 的嵌套对象写入和扁平 key 存储模型。

建议结构：

```ts
appearance: {
  themeId: string,
  locale: "zh" | "en",

  personalization: {
    version: 1,

    common: {
      backgroundMode: "none" | "image",
      backgroundAssetId: string | null,
      backgroundFit: "cover" | "contain",
      backgroundDimness: number,
      backgroundBlur: number,
      glassEnabled: boolean,
      glassIntensity: number,
      surfaceOpacity: number
    },

    desktop: {
      backgroundAssetId?: string | null,
      backgroundDimness?: number,
      backgroundBlur?: number,
      glassEnabled?: boolean,
      glassIntensity?: number,
      surfaceOpacity?: number
    },

    mobile: {
      backgroundAssetId?: string | null,
      backgroundDimness?: number,
      backgroundBlur?: number,
      glassEnabled?: boolean,
      glassIntensity?: number,
      surfaceOpacity?: number
    }
  }
}
```

一期约束：

- 默认所有新增个性化字段使用 `common` 共享值。
- 只允许少数字段支持设备覆盖，不做全量字段分端。
- 一期允许覆盖的字段为：
  - `backgroundAssetId`
  - `backgroundDimness`
  - `backgroundBlur`
  - `glassEnabled`
  - `glassIntensity`
  - `surfaceOpacity`
- `backgroundMode` 和 `backgroundFit` 在一期保持共享值，避免配置组合爆炸。
- 所有数值型字段都必须定义范围并在前后端双侧校验。

建议范围：

- `backgroundDimness`: `0-100`
- `backgroundBlur`: `0-40`
- `glassIntensity`: `0-100`
- `surfaceOpacity`: `0-100`

### 2. 设置页结构与交互

设置入口继续放在现有 `Appearance` 页面内，不新开一级设置页。

建议分为三个分组：

- `Theme`
  - 保留当前 `themeId` 选择器。
- `Background & Material`
  - 承接一期新增能力。
- `Terminal Appearance`
  - 保留当前已有的 desktop/mobile terminal font size。

`Background & Material` 分组建议包含：

- `Background mode`
  - `Off`
  - `Image`
- `Upload image`
- `Replace image`
- `Remove image`
- `Background fit`
  - `Cover`
  - `Contain`
- `Background dimness`
- `Background blur`
- `Enable glass`
- `Glass intensity`
- `Surface opacity`

设备覆盖交互规则：

- 默认只显示共享设置。
- 对允许分端的字段，在字段旁边提供：
  - `Override desktop`
  - `Override mobile`
- 开启覆盖前，desktop/mobile 继承 `common`。
- 开启覆盖后，才展示对应设备的独立输入控件。
- 未开启覆盖时，需要在 UI 上明确说明“当前使用共享值”。
- 不使用“整页切换 desktop/mobile”的交互，以避免两整套表单带来的复杂度。

### 3. 主题层与个性化层职责边界

现有主题注册表继续负责：

- 文档 `data-theme`
- 主题色板
- Monaco theme
- terminal theme
- icon theme

个性化层只负责：

- 背景图
- 背景遮罩和模糊
- 毛玻璃开关
- 玻璃强度
- 面板透明度

这层能力不应并入主题注册表，否则会把“内建主题”和“用户偏好”耦合在一起，增加后续主题包和迁移成本。

### 4. 运行时解析与应用

建议在 Web 端新增一层轻量解析逻辑，而不是把个性化状态散落到各个组件内部。

建议新增三个职责明确的函数：

- `normalizeAppearancePersonalization`
  - 清洗服务端返回的空值、旧值、越界值。
- `resolveAppearanceForViewport`
  - 输入 `common + device override + viewport`，输出当前生效外观值。
- `applyAppearanceToDocument`
  - 把最终值写入文档根节点 CSS 变量和少量 data attribute。

解析规则：

- `desktop` 和 `mobile` 只覆盖允许分端的字段。
- 未定义的设备覆盖字段回退到 `common`。
- 如果背景图 `assetId` 无效或缺失，则 `backgroundMode` 自动按 `none` 处理。

建议映射到根节点的 CSS 变量包括：

- `--app-bg-image`
- `--app-bg-fit`
- `--app-bg-dim`
- `--app-bg-blur`
- `--app-glass-enabled`
- `--app-glass-intensity`
- `--app-surface-opacity`
- `--app-surface-backdrop-filter`

### 5. 样式落点

个性化样式应优先改“容器层”和“共享 surface 层”，而不是让每个业务组件自行处理。

建议落点：

- workbench 根容器负责背景图、背景遮罩、背景模糊。
- 共享 panel、sheet、popover、modal、settings surface 负责读取玻璃和透明度变量。
- 编辑器和 terminal 容器可响应外层 surface 材质，但不把毛玻璃直接施加到文本内容层。

原则：

- 保持正文和代码内容可读性优先。
- 避免在大量滚动和高刷新区域直接使用重型滤镜。
- 让效果由少数共享 class 驱动，而不是分散在业务组件里。

### 6. 服务端设置存储

现有 `settings.update` 已支持嵌套对象扁平化写入，因此一期可以继续复用现有 settings 命令与 `SettingsRepo`。

持久化后的键形态示例：

- `appearance.personalization.version`
- `appearance.personalization.common.backgroundMode`
- `appearance.personalization.common.backgroundAssetId`
- `appearance.personalization.common.glassEnabled`
- `appearance.personalization.desktop.backgroundAssetId`
- `appearance.personalization.mobile.surfaceOpacity`

需要补充的服务端能力：

- 在 settings schema 中为 `appearance.personalization` 新增结构定义。
- 对数值范围、枚举值和空值做显式校验。
- 历史缺失值由 Web 端和服务端默认值解析逻辑兜底。

### 7. 背景图资产模型

一期不应复用现有 `/api/uploads`。

原因：

- 现有 `/api/uploads` 是 workspace 级文件上传。
- 背景图是账号级外观资产，不属于任何 workspace。
- 背景图需要独立的鉴权、目录、生命周期和类型限制。

建议新增专用接口，例如：

- `POST /api/appearance-assets`
- `DELETE /api/appearance-assets/:assetId`
- `GET /api/appearance-assets/:assetId`

接口约束：

- 只接受 `image/png`、`image/jpeg`、`image/webp`
- 限制单文件大小
- 限制最大像素尺寸
- 上传成功后返回：
  - `assetId`
  - `url`
  - `mime`
  - `width`
  - `height`
  - `size`

设置中只保存 `assetId`，不保存 URL。URL 应由资产接口或解析函数生成，避免设置数据与存储位置耦合。

### 8. 同步语义与当前系统现实约束

本次需求的产品语义是“账号同步、服务端全局保存、多端一致”。

但按照当前服务端实现，settings repo 实际上仍是“服务实例级”全局存储，而不是带 `userId` 的真实多用户模型。因此一期必须明确以下前提：

- 当前产品按单用户部署或单主体使用来设计。
- 在这个前提下，服务端 settings 可以满足“跨设备同步”的体验目标。
- 如果未来需要同一服务实例承载多个独立账号，则必须把 settings 和 appearance asset ownership 升级到 user-scoped 模型。

这不是一期 blocker，但必须写进规范，避免后续误判能力边界。

### 9. 降级与可访问性

必须为以下情况提供稳定降级：

- 浏览器不支持 `backdrop-filter`
  - 回退为半透明实底，不影响可读性。
- 当前主题是高对比度主题
  - 默认关闭或显著弱化背景模糊和毛玻璃。
- 背景图加载失败、资源不存在或无权限
  - 自动回退为纯主题背景，并提供可恢复提示。
- mobile 设备性能较弱
  - 对背景模糊、玻璃强度和透明度设置更保守的上限。

可访问性原则：

- 文字对比度优先于视觉效果。
- 毛玻璃和透明度不能让表单、终端、编辑器、弹层内容失去清晰边界。
- 高对比度主题始终高于个性化材质效果。

### 10. 错误处理

设置提交：

- 非法输入不保存。
- 越界数值在 UI 层立即报错并回退到上一个稳定值。
- `settings.update` 失败时恢复上一稳定值，并显示错误消息。

背景图上传：

- 类型不合法时阻止上传并显示明确提示。
- 上传失败时不改写当前已保存 `assetId`。
- 删除旧背景图时，只有在新图已经写入并且设置保存成功后，才触发旧资源清理。

运行时应用：

- 如果个性化配置解析失败，回退到默认个性化配置，而不是阻断页面加载。
- 如果 CSS 变量应用失败，不影响基础主题显示。

### 11. 测试策略

服务端测试：

- `settings.update`/`settings.get` 覆盖 `appearance.personalization` 的保存、读取和非法值校验。
- appearance asset 路由覆盖鉴权、类型限制、大小限制、删除和失败清理。

Web 单元测试：

- `Appearance` 设置页的共享值与设备覆盖交互。
- 上传成功、失败、替换、移除背景图。
- provider hydration 后的个性化配置解析与应用。

样式契约测试：

- CSS 变量应用是否覆盖 workbench 容器和共享 surface。
- 高对比度主题是否禁用或弱化玻璃效果。
- `backdrop-filter` 降级路径是否存在。

UI 预览与端到端：

- desktop theme + background image
- mobile theme + shared settings
- mobile theme + device override
- high contrast theme + personalization enabled

这些场景应进入现有 UI preview / e2e scene 体系，避免后续改动在视觉层静默回归。

## Rollout Plan

一期建议按以下顺序落地：

1. 扩展 settings schema 和 Web 端解析模型，先让个性化配置能够被读取和保存。
2. 接入基础 CSS 变量与 workbench 容器背景层，先支持无上传的占位能力。
3. 增加 appearance asset 路由和上传 UI，打通背景图设置。
4. 接入共享 surface 的玻璃与透明度变量。
5. 补齐 desktop/mobile/high-contrast 预览和测试矩阵。

## Phase 2 Preview

二期主题包功能可以建立在本次设计之上：

- 主题包定义基础 token、Monaco、terminal 和 icon theme。
- 用户个性化层继续作为 theme 之上的 overlay。
- 如果未来支持主题包携带默认背景和材质值，也应先进入主题层，再由个性化偏好覆盖。

这样可以保持：

- 主题包负责“基础视觉体系”
- 个性化偏好负责“用户自己的最终外观覆盖”
