# Work Analysis Provider Usage Capability Matrix

Date: 2026-06-04
Owner: docs/superpowers/research
Scope: current `packages/server/src/work-analysis/log-sources/*` adapters, related tests, and a limited check of local provider roots where available

## Rating Scale

- `full`: current adapter already extracts the metric as a first-class normalized field
- `partial`: raw logs appear to contain the signal, but the adapter only extracts it indirectly, incompletely, or not at all
- `none`: no current adapter support and no confirming evidence from the inspected fixtures/roots

## Matrix

| Provider | Workspace path | Timestamps | Session counts | Tool counts | Model identity | Token usage | Cache usage | Reasoning usage | Cost estimation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `codex` | full | full | full | full | full | partial | partial | partial | none |
| `claude` | full | full | full | full | none | partial | partial | partial | none |
| `gemini` | full | full | full | none | none | none | none | none | none |
| `cursor` | full | partial | full | full | none | none | none | none | none |
| `opencode` | full | full | full | full | full | none | none | none | none |

## Evidence Notes

### `codex`

- Workspace path is extracted from first valid metadata record `payload.cwd`; tests assert matching by `cwd`.
- Timestamps are explicit when record timestamps exist, otherwise file `mtime` fallback.
- Session counts are supported because each parsed JSONL becomes one normalized `WorkLogSession`.
- Tool counts are extracted from `tool` / `command` / `function`-like records into `toolUseCount`.
- Model identity is normalized as `payload.model ?? payload.model_provider`.
- Raw local Codex logs include `event_msg` `token_count` records with `input_tokens`, `cached_input_tokens`, `output_tokens`, and `reasoning_output_tokens`, but the adapter does not read them. That makes token, cache, and reasoning usage `partial`, not `full`.
- No inspected Codex source exposes a normalized cost field or adapter-side cost calculation.

### `claude`

- Workspace path comes from record `cwd`; timestamps come from record `timestamp`; tests cover session grouping and workspace attribution.
- Session counts are available through grouped `sessionId` records.
- Tool counts are inferred from `toolUse`, `attachment`, or `tool` presence, so current coverage is broad enough for `full` in V1 terms.
- Current adapter does not normalize model identity even though raw local Claude assistant records include `message.model`.
- Raw local Claude logs also include `message.usage` with `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`, and assistant content may include `thinking`. The adapter ignores all of these, so token/cache/reasoning usage are `partial`.
- No cost field or cost estimation path is implemented.

### `gemini`

- Workspace path is authoritative via `.project_root`; tests verify tmp/history dedupe and workspace matching.
- Timestamps come from `startTime` / `lastUpdated` with file `mtime` fallback.
- Session counts are supported at the chat-file level.
- Current adapter hardcodes `toolUseCount: 0`, and inspected tests/fixtures do not prove an extractable tool metric from the current Gemini chat shape.
- No normalized model, token, cache, reasoning, or cost support is present in the current adapter or fixtures.

### `cursor`

- Workspace path is extracted from transcript record `cwd`; tests verify logs without `cwd` are skipped.
- Timestamps are only file `mtime`, and the design doc explicitly calls this out as a V1 limitation. That keeps timestamps `partial`.
- Session counts are available because each transcript file becomes one session.
- Tool counts are inferred from transcript content parts with `tool` / `command` / `function` markers.
- No normalized model, token, cache, reasoning, or cost support is present in the adapter or tests.

### `opencode`

- Workspace path comes from `project.worktree` with `session.directory` fallback.
- Timestamps are explicit from `session.time_created` and `session.time_updated`.
- Session counts, tool counts, and model identity are all normalized from SQLite query results; tests cover the query shape and a real fixture path.
- The current SQL does not query any token, cache, reasoning, or cost fields. The inspected adapter and tests do not establish those metrics as available for V1.

## V1 Conclusion

The current work-analysis implementation already has the strongest usage-source foundation in `codex` and `claude`.

- `codex` already normalizes workspace, timestamps, session counts, tool counts, and model identity, and its raw logs clearly expose token/cache/reasoning counters that can be added later.
- `claude` already normalizes workspace, timestamps, session counts, and tool counts, and its raw logs also expose token/cache usage plus model and thinking data that are not yet harvested.

If V1 usage reporting needs the best initial provider coverage with the lowest research risk, `codex` and `claude` are the right starting sources. The findings here support that conclusion.
