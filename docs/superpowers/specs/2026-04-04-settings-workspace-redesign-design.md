# Settings Workspace Redesign Design

**Date:** 2026-04-04

**Status:** Proposed

## Goal

Redesign the Settings experience so it feels like a coherent runtime configuration workspace instead of a flat list of generic form rows, with the largest improvement focused on provider configuration.

The redesign must:

- make page hierarchy obvious before users encounter form controls
- make provider settings feel like runtime configuration, not a generic admin form
- align titles, hints, single-line inputs, and multiline editors into one visual system
- preserve the product's dark, terminal-first, quiet-ops design language

## Background

The current Settings page uses a shared flat document shell and a row-based form structure across all panels. This keeps implementation simple, but it produces three visible problems:

- provider sections exist in schema only, not in the actual visual hierarchy
- titles, hints, and controls do not feel like they belong to one coordinated form language
- multiline technical fields such as args, env maps, and JSON areas are visually compressed into the same rhythm as simple text inputs

This is most obvious in provider settings, where the user is configuring a runtime with different field types and different levels of technical trust.

The existing project design system already points in a better direction:

- dark terminal minimalist
- quiet ops
- explicit panel boundaries
- grouped sections
- advanced JSON areas clearly separated

The redesign should move Settings toward that language without turning it into a glossy SaaS admin panel.

## Decision

Adopt a sectioned workspace layout for the entire Settings page.

The new Settings experience will:

- keep the left navigation as the panel index
- add a shared right-side page header for every panel
- organize panel content as a stack of low-contrast section slabs
- give provider settings a runtime summary plus clearly separated configuration sections
- use different field layouts for simple inputs versus technical multiline editors

The overall direction is "Sectioned Workspace / Balanced":

- stronger structure than the current flat document view
- more restrained than a dense control-center dashboard
- optimized for technical configuration rather than marketing-style polish

## Non-Goals

- Do not redesign Settings into a card-heavy SaaS management dashboard.
- Do not add provider-specific business logic or new provider fields in this phase.
- Do not change provider settings persistence behavior, draft behavior, or update semantics.
- Do not remove the shared settings shell or shared control classes entirely unless needed for the new structure.
- Do not introduce a separate mobile-only information architecture.

## Requirements

### Visual

- The page must remain dark, dense, and operational.
- Hierarchy should come from alignment, typography, separators, and local surface contrast rather than oversized cards.
- Focus states must remain crisp and technical.
- Monospace styling should be used selectively for runtime-oriented fields and multiline technical editors.

### Structural

- Every settings panel must have a page header.
- Every panel must render as a stack of sections rather than one undifferentiated list.
- Provider settings must expose section boundaries that match provider manifests.
- Multiline technical fields must receive a layout that differs from simple inline inputs.

### UX

- Users should understand which settings panel they are in before editing any field.
- Users should understand what each provider section controls before reading individual field hints.
- Placeholder text should not carry explanatory burden that belongs in labels or hints.
- Unknown provider fallback should still render inside the same page language as known providers.

### Technical

- Existing provider draft preservation behavior for multiline fields must remain intact.
- Existing provider unknown-state fallback behavior must remain intact.
- Existing build metadata footer must remain visible.
- Responsive behavior must preserve the same information hierarchy on smaller screens.

## Design

### 1. Shared Workspace Shell

Settings becomes a two-region workspace:

- left region: panel index
- right region: active panel workspace

The left region remains lightweight and acts only as navigation. It should feel more clearly active when a panel is selected, but it should not compete with the content area.

The right region is standardized for all panels:

- page header
- content section stack
- low-priority footer metadata

This creates one reusable Settings language across General, Provider, and Appearance instead of letting each panel feel like a special-case form.

### 2. Panel Header Model

Each panel gets a restrained header block above the sections.

The header contains:

- a small kicker label
- a panel title
- one sentence of purpose text
- provider pages only: a compact provider identity summary

The provider identity summary should clarify which runtime the user is editing and what category of behavior this page controls. It should not become a large hero banner or analytics card.

### 3. Section Slab Model

Each logical group becomes its own low-contrast slab with:

- section label or id
- section title
- optional section description
- field stack

The slab should read as a technical panel section, not a floating marketing card. Visual separation should come from subtle boundaries and internal spacing, not large shadows or bright backgrounds.

This explicitly replaces the older constraint that discouraged section headings and summary blocks. That older constraint optimized for flatness, but it is now the primary cause of weak hierarchy in Settings.

### 4. Provider Page Composition

Provider pages will follow a consistent order:

1. Panel header with provider identity summary
2. Runtime summary slab
3. Manifest-driven settings sections

The runtime summary slab is a lightweight orienting block. It can include:

- provider name
- runtime framing such as startup, auth, or behavior
- a short sentence describing what this provider page configures

It should not duplicate all field-level hints. Its job is orientation, not exhaustive documentation.

Manifest sections such as `startup`, `launch-auth`, `config`, and `behavior` should each render as their own slab. This preserves the manifest model while finally making it visible in the UI.

### 5. Field Layout Rules

Not all settings fields should share the same row structure.

#### Simple fields

Text, command, and select fields should use a disciplined two-column row:

- left: field label and hint
- right: control

The control column should have a stable width range so controls align across a section.

#### Technical multiline fields

String lists, env maps, and JSON fields should use a roomier pattern:

- section-local explanation remains visible
- field label and hint remain associated with the editor
- the editor receives more vertical emphasis and a larger minimum height

This can be expressed as either:

- a wider right-column editor inside the row model, or
- a stacked internal layout where copy sits above the editor

The final implementation should choose the simpler variant that fits existing component structure, but the key rule is that multiline editors must no longer feel squeezed into the same visual rhythm as single-line inputs.

### 6. Control Language

The redesigned control system should unify:

- input height
- inner padding
- corner radius
- label weight
- hint contrast
- focus treatment

Control behavior remains unchanged, but the visual roles become clearer:

- section title: structural hierarchy
- field label: action hierarchy
- field hint: explanation
- placeholder: example only

Runtime-oriented single-line fields such as executable path, model, and base URL may lean slightly more technical through monospace or technical spacing cues, but should still feel part of the same family as the rest of the form.

### 7. Footer Metadata

Autosave status and build metadata remain in the footer bar, but the footer should read as page metadata rather than content.

It should:

- stay visible
- remain compact
- avoid competing with the section stack

### 8. Responsive Behavior

On smaller screens:

- the left navigation continues collapsing to a horizontal top scroller
- the page header remains at the top of the content area
- section slabs remain intact
- simple field rows may collapse from two columns to stacked copy-plus-control

Responsive behavior must preserve the same structure, not invent a different mobile information architecture.

### 9. Unknown Provider Fallback

Unknown provider fallback should still render gracefully inside the same workspace shell:

- standard page header
- standard section slab
- provider identifier
- fallback explanation

This avoids the current mismatch where fallback content risks reading like an orphaned default card.

## Implementation Boundaries

The redesign should be implemented primarily in:

- `apps/web/src/components/Settings/Settings.tsx`
- `apps/web/src/components/Settings/ProviderSettingsPanel.tsx`
- `apps/web/src/styles/app.css`

The redesign may require extending provider manifest types only if implementation needs presentation metadata, but the preferred path is to reuse the existing manifest section model first.

Tests that currently assert the absence of section headers, summaries, or provider-oriented page structure should be updated to reflect the new direction instead of preserved.

## Risks

- It is easy to overshoot into a dashboard aesthetic that conflicts with the product's quiet engineering tone.
- A more expressive structure can accidentally fragment the shared Settings implementation if General, Provider, and Appearance drift into separate patterns.
- Multiline editors can become visually dominant if their surface treatment is too strong.
- Updating tests without preserving the important behavioral guarantees could regress multiline draft handling or unknown-provider fallback behavior.

## Validation Plan

The redesign should be considered complete when the following are true:

1. General, Provider, and Appearance all render with the shared workspace shell and panel header model.
2. Provider settings render as distinct manifest-driven sections instead of a flat row list.
3. Single-line and multiline fields have clearly different but coherent layouts.
4. `Codex`, `Claude`, and unknown-provider states all render correctly.
5. Existing multiline draft-state behavior still works.
6. Existing footer build metadata still renders.
7. Responsive layout remains usable at current mobile breakpoints.
8. Settings structure tests are updated to validate the new hierarchy instead of the old flat-shell assumptions.

## Open Items

- Whether the runtime summary slab should include a compact provider badge only, or also include one additional line describing where settings are applied.
  - Recommendation: include one additional descriptive line.
- Whether technical single-line fields should all use monospace input text or only provider runtime fields.
  - Recommendation: scope monospace treatment to runtime-oriented provider fields and multiline technical editors.
