# UI 组件库 v1 · 设计文档

> **版本：** 1.0
> **日期：** 2026-05-06
> **状态：** Draft（等待评审）
> **作者：** Spencer + Claude

---

## 0. 文档说明

### 0.1 目的

把 `packages/web` 现有的"裸 div + 全局 className 拼接"模式，重构为一套**有类型的 React 基础组件库**，沉淀在 `packages/web/src/components/ui/`。目标：

- 高频 UI 固化为组件，业务侧不再到处手写 className
- 收敛后续开发成本，统一 PC / 移动端兼容方式
- 9500 行的全局 `components.css` 持续瘦身，最终保留的只剩真正属于 feature 的专用 chrome
- 给设计/产品/工程一份共同的真相源（命名、变体、扩展边界）

### 0.2 背景

当前 `packages/web` 的现状：

- ✅ 已有 Aurora Mint 设计 token（`styles/tokens.css`）：颜色 / 间距（4px 网格）/ 字号 / 圆角 / 阴影 / 动效 / z-index / 触摸目标，光暗主题已通过 `[data-theme="light"]` 覆盖
- ✅ 已有移动端断点 `@media (max-width: 899px) or (pointer: coarse)`，触摸目标自动从 32 / 40px 升到 44 / 48 / 56px
- ✅ 已有 `desktop-shell` / `mobile-shell` 双壳，移动端 form-shifting pattern 局部存在（如 `mobile-select-sheet`、命令面板的 sheet 形态）
- ❌ 没有类型化的 React 组件原子层：`<button className="btn btn-primary btn-sm">` 这类调用遍布代码库
- ❌ `styles/components.css` 单文件 9515 行，集中了几乎所有组件样式
- ❌ `features/shared/components/` 仅 1 个 `PageHeader`，绝大多数 feature 重复实现按钮 / 输入框 / 弹层

### 0.3 设计目标

- **统一原语**：覆盖 24 个高频组件（Tier 0-2），业务侧只 import 一处
- **PC / 移动一套 API**：触摸/尺寸差异由 token 自动适配，形态分叉（dropdown ↔ sheet）由 `useViewport()` 内部决策，调用方零感知
- **零视觉回归**：迁移期老 className 与新组件并存，每个组件迁完才删旧 CSS 块
- **strangle 渐进迁移**：每个组件一个独立 PR，每个 PR 都可单独合并，业务节奏不被阻塞

### 0.4 非目标

- ❌ 不抽独立 npm 包（与"单 CLI 分发"形态正交，未来需要时再说）
- ❌ 不引入 Tailwind / styled-components / Stitches / panda 等运行时方案
- ❌ 不引入 Storybook / Chromatic / pixel-diff 工具
- ❌ 不重做设计 token（`tokens.css` 为唯一真相源，不在本期改）
- ❌ 不覆盖 Tier 3 装配件（PageHeader、CommandPalette 外壳、Form 布局原语）—— 留给后续
- ❌ 不重写 Monaco / xterm 相关 UI

---

## 1. 关键设计决策

| # | 决策 | 取舍理由 |
|---|---|---|
| D1 | 组件库住 `packages/web/src/components/ui/`，不抽独立子包 | 单 CLI 分发形态下，多一份子包构建/版本/类型映射成本无收益 |
| D2 | 每组件一个文件夹，`index.tsx + index.module.css + index.test.tsx` | 与 `coding-style.md` 既有规约一致，许多小文件 > 一个 9500 行巨石 |
| D3 | 形态分叉用 `useViewport()` 自动切换（单 API） | 业务侧零负担，跟"统一组件库"目标对齐；`forceMode` 作为极少使用的 escape hatch |
| D4 | 触摸目标差异 100% 由 token 解决，组件不写 `@media` | 媒体查询的真相源只能在 `tokens.css`，避免规则散落 |
| D5 | 迁移期 CSS Module 用 `:global` 别名共存老 className | 实现真正的零视觉回归，老调用点不动也能跑 |
| D6 | Modal 不在移动端自动转 Sheet，`<Sheet>` 显式暴露 | 与现有 codebase 行为一致；要 sheet 必须主动选 |
| D7 | Tooltip 在 `pointer: coarse` 上 no-op，不做长按版 | 长按版改造成本高、收益小，v2 再说 |
| D8 | strangle 模式分 4 阶段（A/B/C/D），1 组件 1 PR | 任意阶段可暂停，业务并行开发不受阻 |
| D9 | 无 Storybook、无 pixel-diff 工具，靠 RTL + 现有 e2e 截图 | 维持已有工具栈；24 组件规模下人工目检足够 |
| D10 | 引入 `@floating-ui/react`（PC 浮层定位）和 `clsx`（className 拼接） | 行业事实标准，最小依赖；Sheet 不依赖 Floating UI |
| D11 | 完成判定：`components.css` 行数 ≤ 2000 行 + 全部 24 个组件 🟢 | 留出 feature 专用 chrome 的合理空间，不做激进清零 |

---

## 2. 总体架构与目录布局

### 2.1 目录结构

```
packages/web/src/
├── components/
│   └── ui/                          # 新增。Tier 0-2 全部住这里
│       ├── button/
│       │   ├── index.tsx            # 组件实现 + 类型导出
│       │   ├── index.module.css     # 从 components.css 切出来的对应块
│       │   ├── index.test.tsx       # 单测
│       │   └── README.md            # 该组件使用文档
│       ├── input/
│       ├── modal/                   # 含 Modal / ModalHeader / ModalBody / ModalFooter
│       ├── select/                  # 内部含 select-dropdown + select-sheet 两套实现
│       ├── ...（共 24 个组件目录）
│       ├── _internal/               # 仅库内部用，不进桶文件
│       │   ├── use-viewport.ts      # 从 shells/ 抽过来共用
│       │   ├── portal.tsx           # Modal/Popover/Sheet 共用 portal
│       │   ├── focus-trap.ts        # 钩子化 focus trap
│       │   └── dismiss.ts           # ESC / 外部点击 / overlay 点击统一关闭
│       ├── index.ts                 # 桶文件，统一 named export
│       ├── README.md                # 库使用守则（§7）
│       └── MIGRATION.md             # 迁移登记表（§5）
├── styles/
│   ├── tokens.css                   # 不动
│   ├── base.css                     # 不动
│   └── components.css               # 持续瘦身（迁完一块删一块）
└── features/                         # 现有 features 不动，迁移分批进行
```

### 2.2 核心模式

1. **每组件一个文件夹**：`index.tsx + index.module.css + index.test.tsx + README.md`
2. **样式切出而非复刻**：从 `components.css` 切对应 CSS 块到 module，class 名保持一致（详见 §4）
3. **桶文件统一导出**：业务侧只 `import { Button, Modal, Select } from "@/components/ui"`，不允许写到子路径
4. **`_internal/`** 收纳跨组件共用的非公开实现（viewport / portal / focus-trap / dismiss），不进桶文件
5. **`features/shared/components/page-header.tsx`** 是 Tier 3 装配件，本期不迁

---

## 3. 组件清单（共 24 个）

按 Tier 列出，每个组件给出关键 props 与映射的现有 CSS 块。

### 3.1 Tier 0 · 纯原子（11 个，token-driven，无 JS 分叉）

| 组件 | 变体 / 尺寸 | Props 关键字段 | 来源 |
|---|---|---|---|
| `Button` | `variant`: primary \| secondary \| ghost \| danger<br>`size`: sm \| md \| lg | `loading`, `leadingIcon`, `trailingIcon`, `as`(polymorphic) | 抽 `.btn .btn-*` |
| `IconButton` | `variant`: ghost \| filled<br>`size`: sm \| md \| lg | `aria-label`(必填), `icon` | 抽 `.btn` icon-only |
| `Input` | `size`: sm \| md \| lg<br>`invalid`: bool | `prefix`, `suffix`, `clearable`, `disabled`, `readOnly` | 抽 `.input` |
| `Textarea` | `size`: md \| lg | `rows`, `autoResize`, `invalid` | 抽 `.input.textarea` |
| `Tag` | `color`: blue \| green \| amber \| pink \| purple \| neutral<br>`size`: sm \| md | `removable`, `onRemove` | 抽 `.badge .badge-*` |
| `Badge` | `tone`: dot \| count | `count`, `max`(默认 99) | 抽 `.badge` |
| `Pill` | `active`: bool, `disabled`: bool | `onClick`, `leadingIcon` | 抽 `.settings-pill*` |
| `StatusDot` | `tone`: success \| warning \| error \| info \| neutral<br>`size`: sm \| md \| lg | `pulse`: bool | 抽 `--status-dot-*` |
| `Kbd` | `size`: sm \| md | 子节点 = 键名 | base.css `kbd` |
| `Spinner` | `size`: sm \| md \| lg | `label`(a11y) | 抽 `.animate-spin` |
| `Switch` | `size`: sm \| md | `checked`, `onCheckedChange`, `disabled` | **新写**（无现成 class） |

### 3.2 Tier 1 · 反馈/容器（9 个，PC/移动同形态）

| 组件 | 关键 props | 备注 / 来源 |
|---|---|---|
| `Modal` + `ModalHeader` / `ModalBody` / `ModalFooter` | `open`, `onOpenChange`, `size`: sm/md/lg/full, `dismissible`, `initialFocus` | 抽 `.modal-overlay .modal-card .modal-*`；含 portal + focus trap；**移动端不自动转 Sheet** |
| `ConfirmDialog` | `title`, `description`, `confirmText`, `cancelText`, `tone`: default/danger | 基于 Modal 的便利封装 |
| `Toast` + `ToastProvider` / `useToast()` | `tone`: info/success/warning/error, `title`, `description`, `duration`, `action` | 收编 `features/notifications/toast-container`；保留位置规则（PC 右下、移动顶部居中） |
| `Tooltip` | `content`, `placement`, `delay`, `disabled` | **`pointer: coarse` 时整个组件 no-op**（不做长按版，v2 再说） |
| `ProgressBar` | `value`, `max`, `indeterminate`, `tone` | 抽 `--progress-height` |
| `Notice` | `tone`: info/success/warning/error, `title`, `action`, `dismissible` | 抽 `.settings-page__notice*` |
| `EmptyState` | `title`, `description`, `icon`, `action` | 既有空态 pattern 收口 |
| `Tabs` + `TabList` / `Tab` / `TabPanel` | `value`, `onValueChange`, `variant`: line/pill/segmented, `orientation` | 移动端横向滚动（CSS-only），不分叉 |
| `SegmentedControl` | `options`, `value`, `onChange`, `size` | Tabs 的 segmented 变体的语义化别名 |

### 3.3 Tier 2 · Form-shifting（4 个，单 API auto-detect）

| 组件 | PC 形态 | 移动形态 | 关键 props |
|---|---|---|---|
| `Select` | dropdown | bottom sheet（复用 `mobile-select-sheet`） | `options`, `value`, `onChange`, `placeholder`, `searchable`, `forceMode`: dropdown/sheet/auto |
| `Popover` | 浮层（基于 trigger 锚定） | bottom sheet | `trigger`, `content`, `placement`(PC), `forceMode` |
| `ActionMenu` | dropdown menu | action sheet | `items: { label, icon?, tone?, onSelect, disabled? }[]`, `trigger`, `forceMode` |
| `Sheet` + `SheetHeader` / `SheetBody` / `SheetFooter` | 右侧 drawer（默认 PC） | bottom sheet（默认 mobile） | `open`, `onOpenChange`, `side`: bottom/right/auto, `dismissible`；同时是 Tier 2 其他组件的底层原语 |

### 3.4 跨组件命名约定

- **颜色语义**：`tone` 字段（`success`/`warning`/`error`/`info`/`neutral`），跟 token 对齐
- **视觉变体**：`variant` 字段（如 `primary`/`secondary`/`ghost`/`danger`）
- **尺寸**：`size` 字段（`sm`/`md`/`lg`），不用 `xs`/`xl`（token 也只有 sm/md/lg 三档）
- **受控对**：`open`/`onOpenChange`、`checked`/`onCheckedChange`、`value`/`onValueChange`（参考 Radix 习惯）
- **多态**：能用 `as` polymorphic 就用（Button 接 anchor 等）
- **a11y 必填**：`IconButton` / `Spinner` 的 `aria-label` 通过 TS 类型层强制必填

---

## 4. Form-shifting 机制

### 4.1 唯一真相源：`useViewport()`

抽到 `components/ui/_internal/use-viewport.ts`，从 `shells/` 借用现成实现并对外公开：

```ts
export type Viewport = "mobile" | "desktop";

export function useViewport(): Viewport {
  // matchMedia: (max-width: 899px) or (pointer: coarse)
  // 监听 change 事件，旋屏 / 缩窗自动更新
  // useSyncExternalStore 保证初次渲染一致
}
```

整个 ui 库**只允许通过 `useViewport()` 拿 viewport**，禁止任何组件自己 `window.matchMedia`——保证升级断点策略时只改一个文件。

### 4.2 每个 form-shifting 组件的实现模式

统一约定：**外壳 + 两套实现 + forceMode 桥**。以 `Select` 为例：

```
components/ui/select/
├── index.tsx               # 外壳，决策 viewport，分发到子实现
├── select-dropdown.tsx     # PC 实现（dropdown）
├── select-sheet.tsx        # Mobile 实现（复用现有 mobile-select-sheet）
├── types.ts                # SelectProps / SelectOption（两套实现共享）
├── index.module.css        # 仅放壳层（极少）
└── index.test.tsx
```

```tsx
export function Select(props: SelectProps) {
  const viewport = useViewport();
  const mode = props.forceMode ?? "auto";
  const resolved = mode === "auto" ? viewport : mode === "sheet" ? "mobile" : "desktop";
  return resolved === "mobile" ? <SelectSheet {...props} /> : <SelectDropdown {...props} />;
}
```

要点：

- **Props 类型在两套实现间共享**（`types.ts`），调用方永远看到同一个 `SelectProps`
- **状态全在外壳**（受控 `value` / 非受控内部 state）；子实现只负责**渲染** + 把回调透传上来——避免两套实现状态走偏
- **`forceMode`**：`"auto" | "dropdown" | "sheet"`（Sheet/Popover/ActionMenu 同形）；**默认始终 `auto`**，escape hatch 极少用
- 子实现**不导出**（不在桶文件里），调用方拿不到——防止业务侧绕开壳层

### 4.3 共享底层原语

`Sheet` 既是 Tier 2 公开组件，**也是 Select / Popover / ActionMenu 在移动端的内部容器**——它们都拿 `<Sheet>` 当 mobile 实现的外框。

```
                       useViewport()
                            │
            ┌───────────────┴────────────────┐
        desktop                          mobile
            │                                │
   ┌────────┼─────────┐              ┌──────┴──────┐
Popover  ActionMenu  Select         Sheet（共享）
[Floating UI 锚定]                   ├─ Popover content
                                    ├─ ActionMenu items
                                    └─ Select options
```

`@floating-ui/react` 作为 PC 浮层定位库引入；mobile 不依赖它（Sheet 是 fixed bottom）。

### 4.4 Portal / Focus / Dismiss 共享设施

`_internal/` 下提供 3 个内部模块，所有 form-shifting + Modal 共用：

- `portal.tsx`：`<UiPortal>` 默认 `document.body`，可注入 `containerRef`（测试用）
- `focus-trap.ts`：钩子化的 focus trap（避开重型库，自己写 ~80 行）
- `dismiss.ts`：统一 ESC / 外部点击 / overlay 点击的关闭逻辑（含 `dismissible` 参数）

`Modal` 虽然不 form-shift，也用同一组设施——保证可关闭、可达性、portal 行为在所有浮层组件里一致。

### 4.5 关键边界 & 失败模式

| 风险 | 处理 |
|---|---|
| viewport 切换时正在打开浮层 | 切换瞬间 `useViewport()` 返回新值 → 子实现整体 unmount/remount（state 在壳层保留），用户看到形态切换但选中态不丢 |
| 测试时 matchMedia 不可用（jsdom） | `setup.ts` 已有 mock；扩展 helper `renderWithViewport(ui, "mobile" \| "desktop")` 让两条路径都能单测覆盖 |
| 嵌套浮层（Popover 里再开 ActionMenu） | z-index 走 `--z-popover` < `--z-modal-backdrop`；Sheet 不允许嵌套（mobile-friendly D9：同时只有一个 sheet） |
| 服务端渲染 | `web` 是纯 SPA，无 SSR；`useViewport` 用 `useSyncExternalStore` 保证未来加 SSR 不返工 |
| `forceMode` 与 viewport 冲突时的 a11y | 强制 `dropdown` 在触摸设备上仍能点开但触摸目标会变小——文档明确警告，仅给"尺寸预览/桌面截图"等场景使用 |

### 4.6 a11y 锚点

| 组件 | role 与键盘行为 |
|---|---|
| Select (dropdown) | `role="combobox"` + `listbox`；↑↓ 移光标，Enter 选中，Esc 关闭 |
| Select (sheet) | sheet 内 `role="dialog"`，list 用 `role="listbox"`；触摸点选 |
| Popover | `role="dialog"` + `aria-modal="false"`；触发器 `aria-expanded` |
| ActionMenu (dropdown) | `role="menu"` + `menuitem`；↑↓ 移动 |
| ActionMenu (sheet) | sheet 内仍 `role="menu"`；触摸点选 |
| Sheet / Modal | `role="dialog"` + `aria-modal="true"`；focus trap 必须 |

Tooltip 在 `pointer: coarse` 直接 no-op，不影响 a11y（信息必须有 visible 文本兜底）。

---

## 5. 样式策略与 Token 使用

### 5.1 一条铁律

**所有组件样式必须只引用 `tokens.css` 里的变量**，禁止任何硬编码颜色 / 间距 / 圆角 / 字号 / 动效。`tokens.css` 是 light/dark 切换、移动断点、未来主题化的唯一开关——组件层不重复这些决策。

### 5.2 组件 CSS Module 模板

```css
/* components/ui/button/index.module.css */
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  height: var(--btn-height-md);
  padding: 0 var(--sp-4);
  border-radius: var(--radius-md);
  font: var(--font-medium) var(--text-base) / var(--leading-tight) var(--font-sans);
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border);
  transition: background var(--duration-fast) var(--ease-out);
  min-height: var(--touch-target-min); /* 触摸目标自动跟随媒体查询 */
}

.primary { background: var(--accent-blue); color: var(--text-inverse); border-color: transparent; }
.secondary { /* ... */ }
.ghost { background: transparent; }
.danger { background: var(--color-error); color: var(--text-inverse); }

.sm { height: var(--btn-height-sm); padding: 0 var(--sp-3); }
.lg { height: var(--btn-height-lg); padding: 0 var(--sp-5); }
.loading { pointer-events: none; opacity: 0.7; }
```

```tsx
// components/ui/button/index.tsx
import s from "./index.module.css";
import clsx from "clsx";

export const Button = ({ variant = "secondary", size = "md", loading, className, ...rest }: ButtonProps) => (
  <button
    {...rest}
    disabled={loading || rest.disabled}
    className={clsx(s.btn, s[variant], size !== "md" && s[size], loading && s.loading, className)}
  />
);
```

要点：

- Module class 名用**简洁 kebab-case**（`primary` 而不是 `btn--primary`），靠模块作用域天然隔离
- `clsx` 作为唯一 className 拼接工具（已是 React 生态事实标准，无新依赖负担——`packages/web` 当前未装，需加上）
- **触摸目标走 token**：`min-height: var(--touch-target-min)`，移动端自动膨胀到 44px，组件 JSX 里**不写 `@media`**

### 5.3 组件层 `@media` 的红线

**默认禁止**在组件 module 里写 `@media`。所有 PC/移动差异通过：

1. `tokens.css` 里的媒体查询切换 token 值（已就绪）
2. Tier 2 的 form-shifting 走 `useViewport()`（§4）

只有**纯样式微调**（如 hover 仅在 `(hover: hover)` 生效以避免移动端 sticky hover）允许局部 `@media`，但必须在该组件的 `index.module.css` 顶部用注释说明理由。这条规则在迁移期会被反复违反，靠 PR review 兜底（不强制 stylelint）。

### 5.4 零视觉回归保证机制

迁移期最大的风险是"组件抽完，视觉跑了"。三道闸：

1. **Class 名同名搬运**：从 `components.css` 切出 `.btn .btn-primary` 那段，搬进 `button/index.module.css` 时 class 名一字不改；module 内用 `:global` 包裹层 + 模块级 class（仅在迁移期使用 `:global` 别名）

   ```css
   /* button/index.module.css 迁移期形态 */
   .btn, :global(.btn) { /* ... */ }
   .primary, :global(.btn-primary) { /* ... */ }
   ```

   这样**新组件和老 className 都能命中同一份 CSS**，旧调用点零改动继续工作

2. **删除 `components.css` 旧块的时机**：当某组件**所有调用点都迁完**（grep 验证），同一 PR 内一次性删除 module 里的 `:global` 别名 + `components.css` 旧块。验收：截图对比关键页面无 diff

3. **截图基线**（轻量）：迁移每个组件前，e2e 截图存一份；迁移后跑同一组截图对比。不引入 visual regression 工具，纯人工目检（项目目前的 `e2e-screenshots/` 已是这套机制）

### 5.5 主题化（已就绪，不动）

`[data-theme="light"]` 切换由 `tokens.css` 处理，**组件层完全无感**——不需要每个组件重写 light 变体。这也是不允许硬编码颜色的根本原因。

### 5.6 Consumer 扩展点

每个组件统一暴露 3 类逃生口（按推荐度排序）：

| 方式 | 用途 | 例 |
|---|---|---|
| 语义 props | 90% 场景 | `<Button variant="danger" size="lg">` |
| `className` 透传 | 极少数边角布局微调 | `<Button className={s.headerCta}>` |
| `style={{"--btn-height-md": "36px"}}` | 一次性破坏 token 的特殊点 | 调试 / 一次性 demo 用，不进 prod |

**禁止**为某个 feature 加新的 `<Button>` 子变体（如 `variant="auth-cta"`），破坏一致性必须经过设计审。

---

## 6. 迁移路线与节奏

### 6.1 总策略：四阶段 strangle，每阶段都可独立合并

```
Phase A: 基建 + Tier 0 落地        （首个 PR 起底，之后 1 组件 1 PR）
   ├─ 装 clsx、抽 _internal 三件套（portal / focus-trap / use-viewport / dismiss）
   └─ Button / IconButton / Input / Tag / Badge / Pill / StatusDot / Kbd / Spinner / Switch / Textarea
            ↓（不阻塞 Phase B/C，可并行）
Phase B: Tier 1 反馈/容器           （1 组件 1 PR）
   └─ Modal / ConfirmDialog / Toast / Tooltip / ProgressBar / Notice / EmptyState / Tabs / SegmentedControl
            ↓
Phase C: Tier 2 form-shifting       （1 组件 1 PR，依赖 Phase B 的 Modal/Sheet 设施）
   └─ Sheet → Select → Popover → ActionMenu
            ↓
Phase D: 收尾                       （1 个 PR）
   └─ 删除 components.css 残余、删除 :global 别名、补使用守则、跑全量 e2e
```

每个组件 PR **范围 = 新组件 + 单测 + 至少 1 个真实调用点迁过去**——保证组件不是"写完吃灰"，且迁移有 reference 实现。

### 6.2 迁移顺序的依据

按"**依赖向 + 收益密度**"决定先后：

| 阶段 | 优先级排序 | 理由 |
|---|---|---|
| Phase A | Button → Input → Tag → IconButton → Pill → StatusDot → Spinner → Kbd → Switch → Badge → Textarea | Button/Input 是出现频率最高、回归风险最小、收益最大；Switch 是新写需要设计校准；Textarea 跟 Input 共享样式放一起 |
| Phase B | Modal → ConfirmDialog → Toast → Notice → Tooltip → ProgressBar → EmptyState → Tabs → SegmentedControl | Modal 是 Phase C 的基础设施依赖；Toast 已基本成型，迁移成本低；Tooltip 中等（要处理 coarse pointer no-op） |
| Phase C | **Sheet → Select → Popover → ActionMenu** | Sheet 必须先；Select 是已有 mobile-select-sheet 的最直接收编 |

### 6.3 单组件迁移 SOP（每个 PR 都按这个走）

1. **基线截图**：在 main 上跑 e2e，存当前调用点的截图（关键页面）
2. **创建** `components/ui/<name>/` 目录，落 `index.tsx + index.module.css + index.test.tsx + README.md`
3. **从 `components.css` 切对应 CSS 块到 module**，`:global` 别名共存（§5.4）
4. **单测覆盖**：variants / sizes / states + 两 viewport 路径（form-shifting 组件必）
5. **选 1-3 个真实调用点迁到新组件**
6. **重新跑 e2e，截图对比无 diff**
7. **更新 `MIGRATION.md`**：记入"已落地、调用点部分迁移"
8. **后续 N 个 PR 持续迁剩余调用点**，不需要再走 1-7 全程，只补 e2e
9. **当某组件最后一个调用点迁完**：同 PR 删 `:global` 别名 + `components.css` 对应块

**只有第 9 步会真正删 CSS**——直到那一刻，老代码一直能跑。任何阶段都可以暂停或回滚。

### 6.4 迁移登记表

新建 `packages/web/src/components/ui/MIGRATION.md`，每个组件一行：

```md
| Component  | Status        | Legacy classes              | Callers left | Last update |
|------------|---------------|-----------------------------|--------------|-------------|
| Button     | 🟡 in-flight | .btn .btn-*                 | 23           | 2026-05-08  |
| Input      | 🟢 complete  | (deleted)                   | 0            | 2026-05-12  |
| Modal      | ⚫ not-started| .modal-overlay .modal-card  | —            | —           |
```

每个 PR 必须更新这张表（CI 不强制，PR template 里提醒）。表本身就是"什么时候删 components.css 哪一段"的真相源。

### 6.5 业务侧并行开发的兼容

迁移期内业务功能继续推进，规则：

| 场景 | 做法 |
|---|---|
| 新写功能 | **必须**用新组件（已落地的 Tier 0/1/2）；未落地的可临时用旧 className，落地后跟着迁 |
| 修改既有功能 | 默认不要求顺手迁，但**不允许新增旧 className**；要新加按钮 = 用 `<Button>` |
| 紧急 bugfix | 不阻塞，可改旧 className |
| 视觉调整 | 改 token 而不是改组件 module；token 没暴露的字段考虑加进 token |

### 6.6 完成判定

整个项目"完成"的客观标准：

- [ ] `components/ui/` 下 24 个组件全部落地，单测通过
- [ ] `MIGRATION.md` 24 行全部 🟢 complete
- [ ] `components.css` 行数 ≤ 2000 行（剩下的是真正属于 feature 而非组件库的样式：terminal、editor、xterm、git-status-bar 等专用 chrome）
- [ ] 全量 e2e 通过，与基线截图无 diff
- [ ] `MIGRATION.md` 标注 "v1 完成"，`README.md` 升级到"使用守则"形态

### 6.7 时间预期（粗估）

- Phase A 基建 + Tier 0：约 2-3 周（11 个组件）
- Phase B Tier 1：约 2-3 周（9 个组件）
- Phase C Tier 2：约 2-3 周（4 个组件，但每个都要双实现）
- Phase D 收尾：约 1 周

总计 7-10 周，**每周末都有可合并的成果**。任何 phase 可暂停，库当时已落地的部分仍可使用。

---

## 7. 测试策略

### 7.1 三层覆盖（按强制度排序）

| 层级 | 工具 | 覆盖范围 | 强制度 |
|---|---|---|---|
| **单元** | Vitest + RTL（已就绪） | 每个组件的 props/variants/states/事件 | **必须** |
| **集成（form-shifting 专属）** | RTL + matchMedia mock | Tier 2 组件的 desktop/mobile 双路径渲染 + `forceMode` | **必须** |
| **视觉基线** | 现有 e2e 截图（人工目检） | 迁移每个组件前后对比关键页面 | **必须**，但靠 SOP 兜底，不上工具 |

不引入 Storybook、Chromatic、Percy 等——按"砍复杂度"原则维持在已有工具栈内。

### 7.2 单元测试模板（每个组件必有）

```tsx
// components/ui/button/index.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from ".";

describe("Button", () => {
  it("renders children with default variant", () => { /* ... */ });
  it.each(["primary", "secondary", "ghost", "danger"])("variant=%s", (variant) => { /* ... */ });
  it.each(["sm", "md", "lg"])("size=%s", (size) => { /* ... */ });
  it("loading disables click and shows spinner", async () => { /* ... */ });
  it("calls onClick when clicked", async () => { /* ... */ });
  it("renders as anchor when as='a'", () => { /* ... */ });
});
```

最低标准：**每个变体/尺寸至少一个 smoke test，所有交互至少一个事件 test，所有禁用态至少一个反向 test**。不追求行覆盖率指标。

### 7.3 form-shifting 双路径测试（Tier 2 必备）

抽 `test-utils/render-with-viewport.tsx` 工具：

```tsx
export function renderWithViewport(ui: ReactNode, viewport: "mobile" | "desktop") {
  // mock matchMedia 返回 viewport 对应的 matches
  setupMatchMediaMock(viewport);
  return render(ui);
}
```

每个 Tier 2 组件必须包含：

1. `desktop` 路径下渲染 dropdown/popover 形态
2. `mobile` 路径下渲染 sheet 形态
3. `forceMode="dropdown"` 在 mobile viewport 下仍渲染 dropdown
4. viewport 切换时 selected value 不丢失（remount 行为）

### 7.4 视觉回归基线

迁移每个组件按 §6.3 SOP 跑：

1. **迁移前**：`pnpm e2e --grep <调用点页面>` → 输出存到 `e2e-screenshots/baseline/<component>/`
2. **迁移后**：跑同一组用例 → 输出对比 baseline，PR 描述贴 before/after 截图
3. 接受标准：肉眼无 diff（像素级偏移 ≤ 1px 抗锯齿等不算回归）

不上 pixel-diff 工具——成本/收益不划算，组件库有限规模下人工目检足够。

### 7.5 a11y 测试（轻量）

不引专门的 a11y 测试库，但每个组件单测里必须验证：

- 关键 `role`（如 `Modal` → `dialog`、`Tabs` → `tab`/`tabpanel`）
- 关键 `aria-*`（如 `aria-modal`、`aria-expanded`、`aria-label`）
- `IconButton` 的 `aria-label` 必填、`Spinner` 的 `label` 必填（用作 `aria-label`）——TS 类型层强制（required string）

未来若要上 axe-core，加 `@axe-core/react` 单点验证而非全量扫描。

---

## 8. 使用守则与文档

### 8.1 库总览 README

`packages/web/src/components/ui/README.md`，定位为"项目内的组件库使用手册"。结构：

```md
# Coder Studio UI

## 总则
- 所有 UI 必须用本目录组件，禁止新增旧式 className
- 所有颜色/间距/字号/动效来自 tokens.css，禁止硬编码
- form-shifting 组件由 useViewport 自动适配 PC/移动，业务侧无感

## 组件索引
| 组件 | Tier | 文档 |
|---|---|---|
| Button | 0 | ./button/README.md |
...

## 命名约定
- variant：视觉变体（primary/secondary/...）
- tone：颜色语义（success/warning/...）
- size：sm/md/lg
- 受控对：value/onValueChange、open/onOpenChange、checked/onCheckedChange

## 扩展守则
- 90% 用 props（variant / size / tone）
- 边角用 className 透传
- 一次性破坏用 style 注入 token 变量
- ❌ 禁止新增 variant，必须经过设计校准

## 迁移状态
见 ./MIGRATION.md
```

### 8.2 单组件 README（每组件 1 个，简短）

每个组件目录追加 `README.md`，约 30-80 行，结构：

```md
# Button

## 使用
\`\`\`tsx
<Button variant="primary" size="md" loading={isPending}>保存</Button>
\`\`\`

## Props
| Prop | Type | Default | 说明 |
|---|---|---|---|
| variant | "primary"\|"secondary"\|"ghost"\|"danger" | "secondary" | |
| size | "sm"\|"md"\|"lg" | "md" | |
| loading | boolean | false | 显示 spinner，禁用点击 |
| as | ElementType | "button" | polymorphic |

## 注意
- danger 仅用于破坏性操作（删除/退出）
- loading 期间 onClick 不会触发
```

不上 Storybook，不写 MDX——README 就是组件文档。降低维护门槛。

### 8.3 设计师/产品对齐文档

本设计文档（`docs/superpowers/specs/2026-05-06-ui-component-library-design.md`）作为对外参考；后续如有新增组件诉求，**先开 issue 讨论 → 设计文档增补 → 再实现**，不允许临时塞新变体。

---

## 9. 风险与回滚

| 风险 | 严重度 | 缓解 |
|---|---|---|
| 视觉回归（迁移漏改 / class 名错位） | 高 | §5.4 三道闸 + §7.4 截图基线 + §6.3 SOP 第 6 步强制对比 |
| 组件 API 设计错，发现后大量调用点要改 | 中 | 每个组件 PR 至少迁 1-3 个真实调用点（§6.3 第 5 步），尽早暴露 API 不合身 |
| 迁移期长，业务团队不耐烦 | 中 | strangle 模式下任何 phase 可暂停，已落地组件可独立使用；PR 拆得小可并行 review |
| `useViewport` 抽走破坏 `shells/` | 低 | Phase A 第一步就是抽 + 替换 `shells/` 调用，绑定测试 |
| 引入新依赖（`clsx` / `@floating-ui/react`） | 低 | 都是行业事实标准，体积可控；放在 Phase A 的基建 PR 一起评 |
| 触摸目标 token 在桌面端被错误升大（误判 `pointer: coarse`） | 低 | 已有 `tokens-touch.test.ts` 兜底；`useViewport` 单测覆盖 |

**回滚策略**：每个组件 PR 独立可 revert；`MIGRATION.md` 行就是 revert 索引。最坏情况整个 v1 暂停在某 Phase，已落地组件继续使用，未迁移代码不受影响。

---

## 10. 后续（v2 范围，本期不做）

- Tier 3 装配件（PageHeader / CommandPalette 外壳 / Form 布局原语）
- Tooltip 长按版（移动端可看 tooltip）
- 抽独立 `@coder-studio/ui` 子包（如果有跨项目复用诉求）
- Storybook / 设计系统站点
- axe-core 自动 a11y 扫描
- 受控/非受控双模式扫描（部分组件可能只支持受控，看实际需求加）
- 暗黑模式以外的多主题支持
