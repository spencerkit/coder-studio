# Richer Agent Instructions Generation Design

## Goal

Improve generated `.coder-studio/agent.md` so it works as a short project operating guide for coding agents, not just a safe repository summary.

The output should stay compact enough to read in one to two screens, but it should provide better actionability in three areas:

- project structure and architecture boundaries
- practical command and verification guidance
- file constraints and collaboration rules

## Non-Goals

- Do not turn `agent.md` into a long handbook or full architecture document.
- Do not require manual project-specific configuration before generation becomes useful.
- Do not replace the existing static generator path used by non-agent generation flows unless needed by shared summary code.
- Do not depend on Mermaid or other diagram formats. Output remains pure Markdown.

## Recommended Approach

Use a richer structured workspace summary as the main improvement point, then update the generation prompt to consume that summary.

This keeps the system mostly automatic, improves output quality across repositories, and remains testable. It also avoids hardcoding full documents in the server while still allowing a small fixed set of high-value rules and constraints.

## Alternatives Considered

### 1. Prompt-only expansion

Keep the current summary model and only ask the model to write more helpful content.

Trade-off:
- Lowest engineering cost
- Weakest reliability because the model cannot infer high-value structure that is not present in the input

### 2. Structured summary expansion

Expand workspace intelligence with architecture, key directories, command coverage, and constraints, then update the prompt to use it.

Trade-off:
- Moderate implementation cost
- Best balance of quality, determinism, and testability

This is the chosen approach.

### 3. Mostly server-rendered template

Generate most of the final Markdown on the server and let the model fill only a few fields.

Trade-off:
- Very stable output
- Too rigid and closer to hardcoded documentation than generation

## Desired Output Shape

Generated `agent.md` should stay pure Markdown and use these second-level sections in this order:

- `Project Overview`
- `Architecture Map`
- `Key Directories`
- `Development Commands`
- `Workflow Expectations`
- `File Constraints`
- `Review Checklist`
- `Provider Notes`

Content expectations:

- `Project Overview`
  - Short repository description
  - Top-level stack/runtime summary
  - Monorepo/single-package context if applicable
- `Architecture Map`
  - Pure Markdown hierarchy
  - Short role descriptions for major layers or packages
- `Key Directories`
  - Only the most relevant 3-6 directories/packages
  - One-line reason each matters to an agent
- `Development Commands`
  - Real commands only
  - Prefer root verification and CI-style commands when present
- `Workflow Expectations`
  - Small fixed ruleset with optional project-specific additions when supported by facts
- `File Constraints`
  - Boundaries and editing cautions
  - Must not invent repo-specific rules without evidence
  - May include small generic safety rules when no stronger repo facts exist
- `Review Checklist`
  - Short, concrete pre-handoff checks
- `Provider Notes`
  - Small fixed provider-specific notes carried forward from today

## Data Model Changes

Extend workspace intelligence so generation has richer structured facts.

Current summary is too thin. The new summary should add the following fields or equivalent structure:

- `workspaceKind`
  - Examples: `monorepo`, `node_app`, `unknown`
- `topLevelDirectories`
  - Sorted list of meaningful root directories, filtered to avoid noise
- `keyDirectories`
  - Array of objects with:
    - `path`
    - `kind`
    - `reason`
- `packages`
  - Array of objects with:
    - `path`
    - `name`
    - `role`
    - `scripts`
- `documentationEntries`
  - Important docs beyond just `README.md` and `docs/`
- `verificationCommands`
  - Prioritized list of concrete commands useful before completion
- `fileConstraints`
  - Structured constraints inferred from repository shape and known conventions

These do not need to be exposed publicly outside generation if that increases churn, but they must be structured enough to test independently.

## Inference Rules

The summary builder should infer useful facts conservatively.

### Workspace Kind

Infer `monorepo` when workspace markers such as `pnpm-workspace.yaml` exist or multiple `packages/*/package.json` files are present.

### Key Directories

For this repository family and similar monorepos, prioritize directories like:

- `packages/web`
- `packages/server`
- `packages/providers`
- `packages/core`
- `packages/cli`
- `docs`
- `e2e`
- `scripts`

Selection rules:

- only include directories that exist
- cap at 3-6 items
- prefer code-bearing directories over support directories
- produce short deterministic reasons, not vague summaries

### Package Roles

Infer role from path and package name with conservative heuristics:

- `web` => frontend UI
- `server` => backend/server/runtime/WS commands
- `providers` => provider integrations/adapters
- `core` => shared protocol/types/runtime contracts
- `cli` => launcher or command-line entrypoint
- `utils` => shared utilities

If role confidence is weak, fall back to a generic but truthful description such as "shared package" instead of guessing.

### Documentation Entries

Prefer documentation with operational value:

- `README.md`
- `docs/help/*`
- `docs/wiki/*`
- root contribution or architecture docs if present

Cap the list so the output remains compact.

### Command Prioritization

Current generation overemphasizes only `dev/build/lint`. The new prioritization should:

- keep existing script-derived commands
- include stronger verification commands such as:
  - `pnpm ci:test`
  - `pnpm ci:typecheck`
  - `pnpm ci:verify`
  - `pnpm acceptance:phase1`
- include package-level test commands only if clearly available and useful
- rank commands by likely usefulness to an agent:
  - verification first
  - then build/typecheck/lint
  - then local dev commands

### File Constraints

This section should be assembled from a mix of repository facts and a small safe template.

Examples of allowed automatically generated constraints:

- preserve existing package boundaries in a monorepo
- keep frontend changes in `packages/web` and backend runtime changes in `packages/server` unless cross-package edits are required
- prefer existing patterns and naming conventions in the touched package
- avoid unrelated refactors across packages while solving a targeted task
- use repository-level verification commands before claiming completion

These are acceptable because they are grounded in repo shape and established collaboration expectations, not arbitrary invention.

## Prompt Changes

The prompt should be updated to:

- request the new section order
- explicitly ask for a Markdown hierarchy under `Architecture Map`
- ask for 3-6 key directories only
- ask for practical commands, not placeholders
- ask for concise but specific file constraints
- forbid invented package roles, commands, or rules

The prompt should still require a single JSON object result and preserve strict parsing expectations.

## Error Handling

No new user-visible error classes are required for this enhancement.

If richer summary data cannot be derived:

- generation should fall back to thinner facts rather than fail
- missing optional fields should simply produce shorter sections
- the system must still return valid Markdown when enough baseline facts exist

## Testing Strategy

### Workspace Intelligence Tests

Add focused tests for the richer summary builder:

- monorepo detection
- key directory selection and ordering
- package role inference
- command prioritization
- documentation entry selection
- file constraint generation

### Prompt Tests

Add tests that assert the prompt now requires:

- the new section order
- Markdown hierarchy for `Architecture Map`
- a limited number of key directories
- concise constraints and review checklist behavior

### Command-Level Tests

Extend agent instructions command tests so mocked provider output can be validated against stronger expectations for the prompt input and expected section presence.

### Real End-to-End Verification

After implementation:

- run the targeted server tests
- run real `Codex` generation through the existing WS command path
- inspect the resulting `.coder-studio/agent.md`
- confirm it includes:
  - architecture map as pure Markdown hierarchy
  - key directories with meaningful roles
  - richer command guidance
  - file constraints that are short and actionable

## Implementation Outline

1. Expand workspace intelligence data gathering and inference helpers.
2. Update the generation prompt to consume the richer facts and new section contract.
3. Update tests for summary inference and prompt expectations.
4. Run real generation and tune compactness if output becomes too verbose.

## Risks

- Over-inference can create inaccurate constraints or package roles.
- Too much data can make the prompt noisy and reduce output quality.
- Excessive command lists can reduce readability.

Mitigations:

- cap lists aggressively
- prefer deterministic heuristics
- fall back to omission instead of guessing
- verify with a real generation pass before considering the work done

## Success Criteria

The enhancement is successful when a real generated `agent.md`:

- clearly explains the repository shape in pure Markdown
- gives an agent a useful shortlist of where to look first
- includes better verification guidance than only `dev/build/lint`
- includes short file constraints that reduce low-quality cross-cutting edits
- remains compact enough to read quickly
