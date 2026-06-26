# Mobile Agent Provider Compact Design

## Goal

Make the mobile `Select Agent` provider list more compact by removing the redundant middle description line for launch-ready providers while preserving install and error guidance when it is needed.

## Scope

- Mobile provider list in `MobileAgentSheet` create mode only
- Do not change desktop behavior
- Do not change the session-switching mode layout

## Behavior

### Launch-ready providers

- Keep the provider name as the primary label
- Keep the status/meta line such as `Start new session` or `Starting`
- Remove the redundant default description line such as `Start Codex session`

### Providers needing guidance

- Keep manual install or error guidance in the description slot
- Keep the diagnostics trailing action when guidance is present

## Styling

- Scope density changes to the mobile agent sheet only
- Tighten row padding and copy spacing slightly so the provider list reads denser without affecting other mobile command sheets
- Keep the monogram icon treatment and provider theme colors unchanged

## Testing

- Component test: launch-ready providers no longer render the default `Start {provider} session` description
- Component test: guidance text still appears when a provider needs help
- Theme test: agent-sheet-specific compact spacing tokens are present
