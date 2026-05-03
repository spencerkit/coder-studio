# Mobile Select Sheet Unification Design

> Date: 2026-05-03
> Status: Approved for planning
> Scope: Unify mobile select-like interactions for supervisor evaluator, agent session/provider selection, terminal switching, and branch quick pick

## 1. Goal

This design consolidates the current mobile select-like interactions into a single component model built on top of the existing mobile sheet container. The target is not every popup on mobile, but the subset of selection flows that currently diverge in structure and styling despite solving the same user problem: choose one thing from a mobile list, sometimes with search or creation.

The unified component will be a single mobile selector surface with optional capabilities enabled by props:

- simple single-select lists
- grouped sections
- search
- create-from-query
- action rows
- internal mode switching with back navigation

This keeps the component surface singular while still allowing the branch picker and agent flows to express their extra behavior without forking the UI shell again.

## 2. In Scope

This design applies only to these mobile selection scenarios:

- supervisor evaluator provider selection
- agent session switching
- agent provider selection when creating a session
- terminal switching
- branch quick pick, including search and branch creation

The design also includes:

- a shared `MobileSelectSheet` API
- migration of the above flows to that shared API
- removal of redundant mobile-only selector shells that become unused after migration

## 3. Out of Scope

The following mobile overlays remain unchanged in this effort:

- workspace switch drawer
- workspace launch / directory picker
- command palette

This design also does not include:

- desktop selector unification
- multi-select behavior
- arbitrary custom item layouts via free-form render callbacks
- manual retry / confirmation subflows inside the selector

Desktop behavior can continue using existing surfaces, including the current terminal dropdown. This change is about mobile convergence only.

## 4. Problem

The current mobile experience has multiple selector-like surfaces with overlapping responsibilities:

- supervisor evaluator uses a native `<select>` inside a mobile sheet
- agent session and provider selection use `MobileInlineSheet`
- terminal selection uses `MobileInlineSheet` on mobile and a different dropdown on desktop
- branch switching uses a separate quick-pick overlay with its own search, list, and hint layout

These flows differ in:

- container shape
- spacing and list density
- header behavior
- selection affordances
- search placement
- active-state styling
- empty/loading states

From the user's perspective, these are all variants of the same job: open a selection surface, inspect options, optionally filter or create, and commit one choice. Maintaining separate shells increases visual inconsistency and implementation overhead without a product-level benefit.

## 5. Design Constraints

- The component layer should converge to one mobile selector component.
- Scenario differences should be expressed through props and structured data, not through separate UI shells.
- The unified selector should reuse the existing `MobileSheet` container instead of inventing another overlay primitive.
- Search and create behavior must fit inside the same selector component, not launch nested overlays.
- Internal mode changes such as `agent session list -> provider list` must happen inside one sheet with a single back path.
- The selector should remain single-select only for this phase.
- Existing business triggers can remain scenario-specific; only the opened selector surface must be unified.
- Out-of-scope overlays must keep their current behavior and should not be opportunistically migrated.

## 6. Core Decision

Introduce a single component, `MobileSelectSheet`, that renders mobile selection flows on top of `MobileSheet`.

`MobileSelectSheet` is not a general modal replacement. It is a focused selection surface with a fixed interaction model:

- open from a caller-owned trigger
- optionally search the available options
- optionally show non-select actions
- optionally create from the current query
- highlight the current single selected item
- select and close by default
- optionally expose back navigation when the caller is using internal modes

This turns the existing collection of mobile selector surfaces into one product primitive instead of several unrelated components.

## 7. Component Model

### 7.1 Responsibility Split

`MobileSheet` remains the low-level container responsible for:

- backdrop
- header shell
- close/back affordances
- fullscreen vs non-fullscreen framing

`MobileSelectSheet` becomes the higher-level selector component responsible for:

- optional search field
- section headers
- option rows
- action rows
- active-state presentation
- create-row presentation
- loading, empty, and filtered-empty states
- select-and-close behavior

Business components remain responsible for:

- when the selector opens
- how data is fetched or derived
- what the selected value means
- what happens after selection or creation

### 7.2 Structured Data, Not Free-Form Rendering

To prevent the component from drifting back into scenario-specific layouts, callers should provide structured item data rather than arbitrary item render functions.

The selector should support:

- option items
- action items
- grouped sections

Each option item may carry:

- `id`
- `label`
- `description`
- `meta`
- `badge`
- `icon`
- `disabled`
- `keywords`
- `tone`

Each action item may carry:

- `id`
- `label`
- `description`
- `icon`
- `disabled`
- `tone`
- action handler

The component owns the visual arrangement of those fields so all migrated flows keep a shared rhythm and hierarchy.

### 7.3 Capability Flags

The component should enable extra behaviors through props rather than through forks:

- `searchable`
- `searchPlaceholder`
- `create`
- `selectedId`
- `closeOnSelect`
- `loading`
- `emptyText`
- `onBack`

This keeps the component singular while allowing branch selection to be richer than terminal switching.

## 8. Proposed API Shape

The exact TypeScript can evolve during implementation, but the design target is:

```ts
type MobileSelectItem = {
  id: string;
  label: string;
  description?: string;
  meta?: string;
  badge?: string;
  icon?: ReactNode;
  disabled?: boolean;
  keywords?: string[];
  tone?: 'default' | 'danger';
};

type MobileSelectActionItem = {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onAction: () => void | Promise<void>;
};

type MobileSelectSection =
  | {
      kind: 'options';
      id: string;
      title?: string;
      items: MobileSelectItem[];
    }
  | {
      kind: 'actions';
      id: string;
      title?: string;
      items: MobileSelectActionItem[];
    };

type MobileSelectCreateConfig = {
  visible: boolean;
  label: (query: string) => string;
  disabled?: (query: string) => boolean;
  onCreate: (query: string) => void | Promise<void>;
};

type MobileSelectSheetProps = {
  title: string;
  kicker?: string;
  sections: MobileSelectSection[];
  selectedId?: string | null;
  searchable?: boolean;
  searchPlaceholder?: string;
  create?: MobileSelectCreateConfig;
  loading?: boolean;
  emptyText?: string;
  closeOnSelect?: boolean;
  onSelect: (id: string) => void | Promise<void>;
  onClose: () => void;
  onBack?: () => void;
};
```

The design intentionally stays single-select. No multi-select state, bulk actions, or checkbox semantics should be introduced in this phase.

## 9. Interaction Rules

The unified selector should obey a fixed set of rules across all migrated flows:

- Selection is single-choice only.
- `closeOnSelect` defaults to `true`.
- Search filters option sections only, not action sections.
- Search matches against `label`, `description`, `meta`, and `keywords`.
- Create affordances appear only when the caller enables `create.visible`.
- Create happens inside the same sheet; it does not open a second overlay.
- The active item always has a consistent highlight and check indicator.
- Tapping the currently selected option can close the sheet; it should not produce a second state.
- Dangerous items such as `Close current session` appear only in `actions` sections, not mixed into option rows.
- Internal mode changes reuse the same sheet and use back navigation instead of stacking sheets.

## 10. Scenario Mapping

### 10.1 Supervisor Evaluator Provider

Current state:

- Mobile supervisor detail uses `MobileSheet`.
- Inside it, evaluator provider selection is a native `<select>`.

Target state:

- Replace the native `<select>` with a trigger row or button inside the existing form.
- Tapping that trigger opens `MobileSelectSheet`.
- The selector renders a simple single-select options section for evaluator providers.
- Selecting a provider updates `draftEvaluatorProviderId` and closes the selector.

This removes the only native-select styling exception from the scoped flows without rewriting the rest of the supervisor form.

### 10.2 Agent Session / Provider Flow

Current state:

- `MobileAgentSheet` mixes session switching, create-session entry, close-session action, and provider selection in a `MobileInlineSheet`.

Target state:

- Retire `MobileAgentSheet` as a dedicated shell.
- The mobile dock trigger opens `MobileSelectSheet` in `session mode`.
- `session mode` contains:
  - an `actions` section for `Create session` and `Close current session`
  - an `options` section for current sessions
- Choosing `Create session` switches the same selector into `provider mode`.
- `provider mode` contains a simple `options` section for providers such as `Claude` and `Codex`.
- `onBack` returns from `provider mode` to `session mode`.

This keeps the flow in one component while preserving the two distinct user tasks.

### 10.3 Terminal Switcher

Current state:

- Mobile fullscreen terminal opens a `MobileInlineSheet`.
- Desktop keeps its dropdown.

Target state:

- Keep the existing trigger button in the terminal toolbar.
- On mobile, replace the `MobileInlineSheet` branch with `MobileSelectSheet`.
- The selector shows terminal rows as a simple options section with the current terminal highlighted.
- Selecting a terminal switches and closes the sheet.

Desktop behavior stays unchanged in this phase.

### 10.4 Branch Quick Pick

Current state:

- Branch switching uses a dedicated quick-pick overlay with search, keyboard hints, and create-new-branch behavior.

Target state:

- Keep the existing branch trigger button.
- Replace the overlay UI layer with `MobileSelectSheet`.
- Enable `searchable`.
- Map current branch results into a single options section.
- Use the `create` config to expose `create branch from query` when appropriate.
- Reuse the existing branch action logic for filtering, selection, and creation.

This keeps the richer branch flow inside the same selector component instead of preserving a separate quick-pick shell.

## 11. Components to Keep and Retire

### Keep

- `MobileSheet` as the shared low-level sheet container
- existing business triggers such as branch buttons and terminal selector buttons
- existing business hooks and atoms that already manage branch, terminal, supervisor, and session state

### Add

- `MobileSelectSheet`

### Retire or Stop Using for These Flows

- `MobileAgentSheet`
- mobile usage of `MobileInlineSheet`
- standalone `BranchQuickPick` overlay UI
- the native supervisor evaluator `<select>`

`MobileInlineSheet` can be deleted entirely if no other mobile flow still depends on it after migration. If any remaining usage is discovered during implementation, deletion can be deferred until the last consumer is removed.

## 12. Implementation Order

Implementation should proceed from lowest-risk to highest-risk migration:

1. Introduce `MobileSelectSheet` on top of `MobileSheet` with shared layout, sections, search, active state, and optional create/action support.
2. Migrate the terminal switcher, which is the simplest single-select list.
3. Migrate the supervisor evaluator provider selection, which validates selector usage inside an existing form flow.
4. Migrate branch quick pick, which validates search and create behavior.
5. Migrate the agent flow last, because it is the only scoped scenario with internal mode switching and mixed action/option sections.

This sequence lets the team verify the component incrementally before replacing the most stateful flow.

## 13. Testing Strategy

Coverage should focus on both the shared component and scenario-specific integration.

### Shared Component Coverage

- renders option sections and action sections correctly
- highlights the selected item consistently
- filters option items when searching
- leaves action items visible during search
- shows empty state when filtered results are empty
- shows create row only when enabled and query is valid
- triggers `onBack`, `onClose`, `onSelect`, and `onCreate` correctly

### Scenario Integration Coverage

- supervisor evaluator opens the selector and updates provider state on selection
- terminal switcher opens the selector and switches the active terminal
- branch flow filters results and can create a branch from the current query
- agent flow can switch between session mode and provider mode inside one sheet
- agent flow can switch sessions and invoke create/close actions without opening a second selector shell

### Regression Focus

- workspace drawer remains unchanged
- workspace launch modal remains unchanged
- command palette remains unchanged
- desktop terminal dropdown remains unchanged

## 14. Acceptance Criteria

This effort is complete when:

- mobile selector flows `1/2/3/5` all render through a shared `MobileSelectSheet`
- the supervisor evaluator no longer uses a native `<select>` on mobile
- branch switching no longer uses a separate quick-pick overlay shell
- agent create/switch flows no longer use a dedicated `MobileInlineSheet`
- terminal switching no longer uses `MobileInlineSheet` on mobile
- search and create behaviors are available through props within the same selector component
- out-of-scope overlays `4/6/7` remain behaviorally unchanged
- tests cover both the shared selector logic and the migrated flows
