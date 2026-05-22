# UI Typography Role Convergence Design

Date: 2026-05-21
Status: Draft
Owner: Codex

## Problem

当前普通 UI 的 typography 角色过多，`kicker / label / meta / body / body-strong / app-title / section-title / page-title / display / code-inline` 这些语义层把“标题、正文、辅助信息”拆得太细，导致组件选型成本高，也容易重新回到局部自定义字号的状态。

本次需要把普通 UI typography 收敛成一套更小、更稳定的语义角色，让开发者只需要判断“这是 heading 还是 body”，而不是在十几个细分角色里找最像的那个。

## Goals

- 把普通 UI typography 收敛为单层语义角色。
- 只保留 `heading-1` 到 `heading-6` 和 `body-1` 到 `body-6`。
- 这 12 个角色必须覆盖所有普通 UI 组件，包括 `button`、`input`、`textarea`、`select`、`tabs`、`modal`、`toast`、`tooltip`、`badge`、`tag`、`empty state`、`notice`、`confirm dialog` 等共享组件。
- 让 `body-3` 成为普通正文的默认角色。
- 保持 `heading` 和 `body` 的色彩独立，颜色继续由 `text-primary / text-secondary / text-tertiary` 这类 tone token 管理。
- 保持 PC 与 Mobile 的 typography 值一致，不再分端维护字号表。
- 保留用户自定义覆盖能力，但只允许通过 token/主题层覆盖，不允许组件自己分叉出新的字号规则。

## Non-Goals

- 不新增 `caption` 家族。
- 不保留单独的 `code` 字号角色。
- 不引入第二层基础字号尺子。
- 不调整 terminal、editor、diff 这类代码型界面的独立排版体系。
- 不在本次规范中重做字体家族选择。

## Final Contract

### 1. Role Set

普通 UI 仅保留以下 12 个角色：

- `heading-1`
- `heading-2`
- `heading-3`
- `heading-4`
- `heading-5`
- `heading-6`
- `body-1`
- `body-2`
- `body-3`
- `body-4`
- `body-5`
- `body-6`

### 2. Role Values

所有角色在 PC 和 Mobile 上使用同一组值。

#### Heading

| Role | Value | Typical use |
| --- | --- | --- |
| `heading-1` | `28px / 1.1 / 600` | hero, large page title |
| `heading-2` | `24px / 1.15 / 600` | page title |
| `heading-3` | `20px / 1.2 / 600` | major section title |
| `heading-4` | `18px / 1.25 / 400` | panel / modal title |
| `heading-5` | `16px / 1.3 / 400` | card / group title |
| `heading-6` | `14px / 1.35 / 400` | compact title / row title |

#### Body

| Role | Value | Typical use |
| --- | --- | --- |
| `body-1` | `18px / 1.6 / 400` | lead copy |
| `body-2` | `16px / 1.6 / 400` | descriptive copy |
| `body-3` | `14px / 1.6 / 400` | default body, buttons, inputs, tabs, main row text |
| `body-4` | `13px / 1.5 / 400` | secondary copy |
| `body-5` | `12px / 1.45 / 400` | helper, meta, time, status support |
| `body-6` | `11px / 1.4 / 400` | microcopy, fine print, compact hints |

### 3. Mapping Rules

- `body-3` is the default ordinary text role.
- `button`, `input`, `textarea`, `select`, and `tab` should default to `body-3`.
- All shared UI components must map to one of the 12 roles above; no shared component may introduce a private typography family or a new ad hoc role.
- Helper text, meta text, timestamps, and weak status copy should default to `body-5`.
- Small labels and terse hints should use `body-6`.
- Title-like text that does not actually structure the page should be demoted into `heading-4` to `heading-6` or `body-4` to `body-6`, depending on role.
- Inline code and other code-like snippets in ordinary UI should reuse body roles instead of introducing a separate code role.

### 4. Tone Rules

- Typography roles do not own color.
- Default neutral text tones remain separate tokens, primarily `text-primary`, `text-secondary`, and `text-tertiary`.
- Components may combine a typography role with a tone token, but the typography role itself should not encode color.

### 5. Override Rules

- User customization remains allowed.
- Overrides must happen at the token/role level.
- Components should not hardcode alternate font-size ladders or create local typography families.

## Migration Principles

- New work should only consume the 12-role contract.
- Existing shared UI components must be migrated into this contract as a whole, not piecemeal by component family.
- Legacy typography roles should be treated as migration-only compatibility surface.
- If a surface cannot clearly justify a title role, it should fall back to `body-3`, `body-5`, or `body-6` instead of inventing a new role.
