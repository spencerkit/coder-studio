# Seasonal Themes Design

Date: 2026-05-24
Status: Draft
Owner: Codex

## Problem

当前产品已经有成熟的主题系统：`appearance.themeId` 贯通 Web UI、Monaco、terminal 和 icon tone，用户可以在现有内建主题之间切换。但现有主题更多是通用产品风格，还没有一套能明显传达“春夏秋冬”情绪变化的主题组。

这次需求不是做单纯的背景皮肤，也不是额外引入一套并行的季节系统，而是在现有主题模型内新增一组完整、可长期使用的四季主题。目标是让使用者在切换主题时能感受到春天的灿烂、夏天的生命力、秋天的寂寥和冬天的静谧，同时保持企业级产品应有的可读性、稳定性和系统感。

## Goals

- 新增 `8` 个内建四季主题：春、夏、秋、冬各自提供 `light` 和 `dark` 两个版本。
- 继续复用现有主题切换与解析规则，不新增第二套季节主题机制。
- 让四季主题在 Web UI、Monaco、terminal、icon tone 上保持统一体验，而不是只改网页背景色。
- 采用偏企业级的 `Enterprise-Balanced` 方向：季节感明确，但不让界面大面积高饱和染色。
- 让同季节的 `light / dark` 一眼看出属于同一组，同时保留各自适合明暗模式的层级与对比。
- 保持设置页中的主题选择结构清晰，可直观看出季节和明暗对应关系。

## Non-Goals

- 本期不改主题切换机制，不增加“按季节自动切换”。
- 本期不增加背景图片、动态天气、粒子、动画等附加季节效果。
- 本期不引入新的“主题包”或任意自定义 token 注入能力。
- 本期不改变现有 `success / warning / error / info` 的语义职责。
- 本期不重做 icon glyph 系统，不为四季主题单独设计一套图标造型语言。
- 本期不改写外观个性化设置模型，不和背景个性化功能耦合。

## User Decisions Captured

- 季节主题不是轻量皮肤，而是完整应用主题。
- 优先方向是“平衡型”：允许春夏更张扬，秋冬更克制，但整体仍要适合长期使用。
- 春天主色逻辑为“花的红色”，强调灿烂感，但背景不应被大面积红色铺满。
- 夏天主色逻辑为生命的绿色。
- 秋天主色逻辑为黄色系，但应避免廉价高亮黄，更偏麦黄、琥珀、深金。
- 冬天主色逻辑为白色系与冷灰蓝，强调静谧、雪雾、冷空气感。
- 每个季节都要提供 `light` 和 `dark` 两个版本。
- 不改变当前主题系统规则，只是在现有模型里新增一组主题。
- 最终方向选定为更企业级的 `Enterprise-Balanced`，而不是纯情绪板式或极度克制的方案。

## Approaches Considered

### Option A: Enterprise-Soft

四季主色主要进入强调层，页面和面板大体保持中性，季节感更多体现在按钮、选中态、标签、图标和焦点。

优点：

- 风险最低，最接近典型企业产品。
- 最不容易影响正文区、代码区和表单控件的可读性。

缺点：

- 四季差异会偏弱，可能无法达到“明显感受到四季变化”的目标。

### Option B: Enterprise-Balanced（推荐）

保留成熟产品的中性层级结构，但允许不同季节在 page、surface、sidebar 等表面层注入低饱和色温，同时让强调层更明确地体现季节主色。

优点：

- 四季感清楚，但整体仍像稳定的产品主题系统。
- 最容易兼顾“春夏更鲜明、秋冬更收束”的情绪目标。
- 最适合扩展到 `light / dark` 双套并保持配对关系。

缺点：

- 设计和实现上比 `Enterprise-Soft` 更需要精细校准表面、边框、选中态、Monaco 和 terminal 色阶。

### Option C: Enterprise-Expressive

将更多季节色温带入侧栏、面板和 overlay，整体主题切换时能更强烈地感受到季节变化。

优点：

- 辨识度最高，最容易让用户感到“换了一个季节”。

缺点：

- 长时间使用风险更高。
- 最容易让正文区、代码区和功能性控件的对比失衡。

## Final Choice

采用 Option B。

这组四季主题将沿用现有主题系统的结构，通过稳定的语义 token 层把季节气质注入到 Web UI、Monaco、terminal 和 icon tone 中。整体方向是企业级、可长期使用的季节主题，而不是海报式或背景皮肤式表达。

## Final Design

### 1. 主题模型与命名

在现有主题注册表基础上新增 `8` 个内建主题：

- `spring-light`
- `spring-dark`
- `summer-light`
- `summer-dark`
- `autumn-light`
- `autumn-dark`
- `winter-light`
- `winter-dark`

继续沿用现有 `AppThemeDefinition` 模型，不新增新的季节主题类型。每个主题仍然包含：

- `id`
- `family`
- `kind`
- `labelKey`
- `pairedThemeId`
- `isHighContrast`
- `documentThemeAttr`
- `terminalTheme`
- `monaco`
- `iconTheme`

`ThemeFamily` 扩展为包含四个新 family：

- `spring`
- `summer`
- `autumn`
- `winter`

成对关系固定如下：

- `spring-light` ↔ `spring-dark`
- `summer-light` ↔ `summer-dark`
- `autumn-light` ↔ `autumn-dark`
- `winter-light` ↔ `winter-dark`

这样可以保持与现有 `mint / graphite / nord / hc` 完全一致的解析与切换逻辑。

### 2. 整体视觉原则

四季主题遵循以下全局原则：

- 大面积页面和面板优先使用低饱和表面色，不用主色直接铺满整个界面。
- 季节主色主要进入强调层：主按钮、选中态、焦点、重要标签、部分图标 tone、局部高光区。
- `light` 版主要通过空气感、色温和背景透气度来区分季节。
- `dark` 版主要通过更深的色温和更清楚的强调色来区分季节。
- 同季节的 `light / dark` 必须一眼看出属于同一组，不能做成两个不相关的主题。

### 3. 四季语义色板策略

#### Spring

目标气质是“花的红色”和“灿烂”，但不是告警红，也不是大面积粉色界面。

原则：

- 主强调色使用花瓣红、玫瑰珊瑚、胭脂红一类的暖红系。
- 表面层使用浅暖白、微粉雾灰作为基底，保持明亮和通透。
- 少量嫩叶绿可作为辅助点缀，但不抢夺主强调角色。
- `spring-dark` 使用莓红、深玫瑰、花影红作为强调，底色偏暖黑灰或轻微紫灰。

#### Summer

目标气质是生命力、生长和饱满，但不是荧光绿，也不是环保海报式满屏绿。

原则：

- 主强调色使用叶绿、草木绿、生命力绿。
- 表面层只做极轻的灰绿倾向，正文和主要容器保持接近中性。
- `summer-dark` 使用深林绿、湿润绿，体现沉稳的生命力，而不是霓虹科技绿。

#### Autumn

目标气质是黄色系、成熟、日照和寂寥，但避免节庆金或廉价高亮黄。

原则：

- 主强调色使用麦黄、琥珀、深金、枯叶黄。
- 表面层使用纸张暖黄、谷物米色和干燥暖灰。
- `autumn-dark` 使用深琥珀、焦糖棕金、暮色黄褐，传达成熟收束感。

#### Winter

目标气质是白色系、冷空气、雪雾和静谧，是四季中最克制的一组。

原则：

- 主强调色使用冷灰蓝、雾蓝、雪光蓝，避免强饱和亮蓝。
- 表面层使用雪白、雾白、冷灰和淡蓝灰。
- `winter-dark` 使用夜雪蓝灰、月光钢蓝和冷静深灰，整体存在感比其他季节更轻。

### 4. 语义状态与季节主色的边界

状态语义继续保持稳定，不让季节主色直接吞并系统状态色。

必须明确的边界：

- 春的主强调色不等于 `error`
- 夏的主强调色不等于 `success`
- 秋的主强调色不等于 `warning`
- 冬的主强调色可以邻近 `info`，但要比系统信息蓝更安静

实现原则：

- `success / warning / error / info` 仍保留稳定语义职责。
- 季节主色与状态色可以在色相上相近，但不能让用户在交互上混淆。
- 因此，季节色更多接管 `accent`、`focus`、`selection`、`icon accent`，而不是直接替换所有状态色。

### 5. CSS Token 设计

在 [packages/web/src/styles/tokens.css](/home/spencer/workspace/coder-studio/packages/web/src/styles/tokens.css) 中新增 `8` 个 `[data-theme="..."]` block。

继续沿用现有 token 命名和结构，不引入第二套季节 token 命名空间。

优先需要校准的角色包括：

- 页面和表面：
  - `--bg-page`
  - `--bg-surface`
  - `--bg-sidebar`
  - `--bg-terminal`
  - `--bg-hover`
  - `--bg-active`
  - `--bg-input`
- 边框与对比：
  - `--border`
  - `--border-light`
  - `--border-focus`
  - `--border-error`
- 文本：
  - `--text-primary`
  - `--text-secondary`
  - `--text-tertiary`
  - `--text-disabled`
- 强调与语义：
  - `--accent-blue`
  - `--accent-green`
  - `--accent-amber`
  - `--accent-pink`
  - `--accent-purple`
  - `--color-success`
  - `--color-warning`
  - `--color-error`
  - `--color-info`
- 状态与 overlay：
  - `--state-*`
  - `--overlay-*`
  - `--surface-*`
  - `--shadow-glow`
- 图标：
  - `--icon-*`

这里的关键不是机械换色，而是保证：

- 表面层级能被清楚分辨
- 控件 hover / active / selected 状态仍然明显
- 各季节的焦点色和选中态具有各自气质

### 6. Monaco 与 Terminal

四季主题必须提供完整的 `terminalTheme` 和 `monaco` 定义，不能只改网页 token。

#### Monaco

原则：

- `editor.background` 仍围绕主题基底控制，不使用过强情绪色。
- `comment` 维持中性偏灰，避免语义噪音。
- `keyword` 使用季节主强调色。
- `string` 使用与季节主强调相协调的辅助色。
- `selectionBackground`、`editorCursor.foreground`、`editorLineNumber.foreground` 跟随季节气质微调。

这样用户会感知到“整个产品都进入了同一个季节”，但写代码时不至于疲劳。

#### Terminal

原则：

- 背景和前景对比优先稳定性。
- ANSI palette 保持语义可辨，不为了追求季节感而破坏红绿黄蓝的角色。
- 可让 `cursor`、`selectionBackground` 和个别亮色通道体现季节主色倾向。

### 7. Icon Theme

第一阶段不改变 icon glyph 选择逻辑，只调整各季节的 tone 和 surface 倾向。

策略：

- Spring：accent 更偏花红系
- Summer：accent 更偏叶绿系
- Autumn：accent 更偏琥珀黄系
- Winter：accent 更偏冷灰蓝系

文件、状态和导航图标仍维持稳定的语义结构，避免为四季主题引入新的图标复杂度。

### 8. 设置页与文案

设置页继续使用当前主题选择逻辑，不引入新的切换规则。

建议将四季主题作为一个独立分组加入现有主题列表，顺序固定为：

- `Spring Light`
- `Spring Dark`
- `Summer Light`
- `Summer Dark`
- `Autumn Light`
- `Autumn Dark`
- `Winter Light`
- `Winter Dark`

需要同步补充：

- `labelKey`
- 中英文翻译文案
- 主题选择器内的排序与分组文案

这样用户在设置页中能清楚理解这是“四季主题组”，并看出每个季节的明暗对应关系。

### 9. 测试与验证

至少需要更新以下测试面：

- [packages/web/src/theme/registry.test.ts](/home/spencer/workspace/coder-studio/packages/web/src/theme/registry.test.ts)
  - 主题总数
  - family 覆盖
  - paired theme 对称性
  - `labelKey` 可翻译性
  - `documentThemeAttr` 与 `id` 对齐
- `resolve` 类测试
  - 新主题 `themeId` 可被正确解析
  - 未知值仍回退默认主题
- 样式主题测试
  - 新主题的 token 覆盖完整
  - 共享组件在四季主题下仍有合理状态对比
- 如测试范围允许，补充设置页或视觉测试
  - 确认主题列表中新增四季项
  - 确认 light / dark 对应关系显示正确

### 10. Implementation Notes

建议按以下顺序实现：

1. 扩展 `theme registry`、`ThemeFamily`、`THEME_IDS` 和 `pairedThemeId`
2. 补齐 `tokens.css` 中 `8` 个新主题 block
3. 为新主题补齐 `terminalTheme`、`monaco`、`iconTheme`
4. 更新设置页主题列表与文案
5. 补齐测试与必要视觉回归

这样能先把主题定义层打稳，再逐步连通 UI 和测试。

## Open Questions

当前没有阻塞实现的开放问题。

唯一的主观校准点是：在正式实现时，`Enterprise-Balanced` 方向可以根据实际预览结果，在“更克制一点”和“再多一点季节感”之间做一次小幅微调，但不改变本设计的结构和边界。
