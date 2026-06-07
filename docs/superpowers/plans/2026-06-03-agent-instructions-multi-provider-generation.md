# Agent Instructions Multi-Provider Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `agent.md` generation from Codex-only headless execution to the built-in `codex`, `claude`, `gemini`, and `cursor` providers while keeping server-owned validation and file writes.

**Architecture:** Keep `agent_instructions_generate` as an explicit headless scenario, but add it to the built-in providers that already support stable headless execution. Replace the Codex-only output parser with provider-aware envelope extraction plus a unified generation JSON payload parser, then update prompt, command, and UI filtering tests around the new contract.

**Tech Stack:** TypeScript, Vitest, React Testing Library, Jotai, existing provider/server command architecture

---

### Task 1: Expand Built-In Provider Generation Capability

**Files:**
- Modify: `packages/providers/src/claude/definition.ts`
- Modify: `packages/providers/src/gemini/definition.ts`
- Modify: `packages/providers/src/cursor/definition.ts`
- Test: `packages/providers/src/claude/definition.test.ts`
- Test: `packages/providers/src/gemini/definition.test.ts`
- Test: `packages/providers/src/cursor/definition.test.ts`

- [ ] **Step 1: Write the failing provider definition tests**

Add assertions that `supportedScenarios` includes `agent_instructions_generate` and that the provider `headless.buildCommand(...)` returns a non-null command for that scenario.

```ts
expect(claudeDefinition.headless?.supportedScenarios).toEqual([
  "supervisor_eval",
  "agent_instructions_generate",
  "session_analysis",
]);
expect(
  claudeDefinition.headless?.buildCommand({}, "agent_instructions_generate", {
    prompt: "Return strict JSON",
    sessionId: "sess-1",
    workspacePath: "/workspace",
  })
).not.toBeNull();
```

- [ ] **Step 2: Run the targeted provider tests and verify they fail**

Run:

```bash
pnpm vitest run packages/providers/src/claude/definition.test.ts packages/providers/src/gemini/definition.test.ts packages/providers/src/cursor/definition.test.ts
```

Expected: FAIL because the scenario list does not yet include `agent_instructions_generate` and `buildCommand(...)` returns `null` for that scenario.

- [ ] **Step 3: Update the provider definitions**

Extend each built-in headless definition to accept `agent_instructions_generate` and reuse the existing headless command builder.

```ts
headless: {
  supportedScenarios: ["supervisor_eval", "agent_instructions_generate", "session_analysis"],
  buildCommand(config, scenario, req) {
    if (
      scenario !== "supervisor_eval" &&
      scenario !== "agent_instructions_generate" &&
      scenario !== "session_analysis"
    ) {
      return null;
    }

    return buildClaudeSupervisorEvalCommand(config, req);
  },
},
```

- [ ] **Step 4: Re-run the targeted provider tests and verify they pass**

Run:

```bash
pnpm vitest run packages/providers/src/claude/definition.test.ts packages/providers/src/gemini/definition.test.ts packages/providers/src/cursor/definition.test.ts
```

Expected: PASS

### Task 2: Replace Codex-Only Output Parsing With Provider-Aware Extraction

**Files:**
- Modify: `packages/server/src/agent-instructions/output.ts`
- Modify: `packages/server/src/__tests__/agent-instructions/output.test.ts`

- [ ] **Step 1: Write the failing parser tests**

Add tests for:

- extracting final text from Codex JSONL
- extracting final text from Claude/Gemini/Cursor JSON envelopes
- parsing unified generation payload JSON
- surfacing `ok: false`
- rejecting invalid JSON and invalid headings

Representative fixtures:

```ts
const claudeEnvelope = JSON.stringify({
  type: "result",
  result: '{"ok":true,"content":"# Agent Instructions\\n\\n## Project Overview\\n"}',
});

const codexJsonl = [
  JSON.stringify({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: '{"ok":true,"content":"# Agent Instructions\\n\\n## Project Overview\\n"}',
    },
  }),
].join("\n");
```

- [ ] **Step 2: Run the parser tests and verify they fail**

Run:

```bash
pnpm vitest run packages/server/src/__tests__/agent-instructions/output.test.ts
```

Expected: FAIL because only Codex markdown extraction exists today and there is no unified payload parser.

- [ ] **Step 3: Implement provider-aware extraction and unified payload parsing**

Refactor `output.ts` to expose two layers:

- provider-specific final-text extraction
- provider-agnostic generation payload parsing

Target API:

```ts
export function extractAgentInstructionsReplyText(providerId: string, stdout: string): string
export function parseGeneratedAgentInstructionsPayload(replyText: string): string
```

Behavior:

- `extractAgentInstructionsReplyText(...)`
  - `codex`: read JSONL `item.completed` / `agent_message`
  - `claude`, `gemini`, `cursor`: decode the final text field from the JSON envelope
- `parseGeneratedAgentInstructionsPayload(...)`
  - parse JSON
  - require `ok === true`
  - require non-empty `content`
  - normalize markdown through `normalizeGeneratedAgentInstructionsMarkdown(...)`

- [ ] **Step 4: Re-run the parser tests and verify they pass**

Run:

```bash
pnpm vitest run packages/server/src/__tests__/agent-instructions/output.test.ts
```

Expected: PASS

### Task 3: Switch Generation Prompt and Server Flow to the Unified Contract

**Files:**
- Modify: `packages/server/src/agent-instructions/prompt.ts`
- Modify: `packages/server/src/agent-instructions/agent-generator.ts`
- Test: `packages/server/src/__tests__/agent-instructions-command.test.ts`

- [ ] **Step 1: Write the failing generation command tests**

Update or add command tests so each supported provider returns a provider-specific envelope containing a unified payload, and the command result still returns normalized markdown content.

Representative assertions:

```ts
expect(result.data).toEqual({
  content: "# Agent Instructions\n\nGenerated for tests\n",
  meta: {
    providerId: "claude",
    model: "sonnet",
  },
});
```

Add explicit failure cases for:

- payload `{ "ok": false, "error": "..." }`
- malformed payload JSON
- valid payload with invalid heading

- [ ] **Step 2: Run the targeted command tests and verify they fail**

Run:

```bash
pnpm vitest run packages/server/src/__tests__/agent-instructions-command.test.ts
```

Expected: FAIL because `agent-generator.ts` still calls the Codex-only extractor and `prompt.ts` still requests raw markdown output.

- [ ] **Step 3: Update the generation prompt**

Rewrite `buildAgentInstructionsGenerationPrompt(...)` so it requires exactly one JSON object with:

```json
{
  "ok": true,
  "content": "# Agent Instructions\n..."
}
```

and optionally:

```json
{
  "ok": false,
  "error": "..."
}
```

Keep the existing fixed section order and required bullet lists.

- [ ] **Step 4: Update the generator flow**

In `agent-generator.ts`:

- keep provider resolution logic
- run the provider headless command
- call `extractAgentInstructionsReplyText(provider.id, stdout)`
- call `parseGeneratedAgentInstructionsPayload(replyText)`
- return normalized markdown content and metadata

Representative change:

```ts
const replyText = extractAgentInstructionsReplyText(provider.id, stdout);
const content = parseGeneratedAgentInstructionsPayload(replyText);

return {
  content,
  meta: {
    providerId: provider.id,
    model,
  },
};
```

- [ ] **Step 5: Re-run the targeted command tests and verify they pass**

Run:

```bash
pnpm vitest run packages/server/src/__tests__/agent-instructions-command.test.ts
```

Expected: PASS

### Task 4: Verify Provider Listing and UI Filtering Regression Coverage

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/agent-instructions-section.test.tsx`
- Modify: `packages/server/src/__tests__/provider-list.test.ts`
- Modify: `packages/server/src/__tests__/provider-runtime/runtime-status.test.ts`

- [ ] **Step 1: Write the failing listing/filtering assertions**

Update test fixtures so `claude`, `gemini`, and `cursor` can appear as generation-capable providers when runtime-available.

Representative UI assertion:

```ts
expect(within(providerSelect).getByRole("option", { name: "Claude" })).toBeInTheDocument();
expect(within(providerSelect).getByRole("option", { name: "Codex" })).toBeInTheDocument();
```

- [ ] **Step 2: Run the targeted provider listing and UI tests**

Run:

```bash
pnpm vitest run packages/web/src/features/workspace/views/shared/agent-instructions-section.test.tsx packages/server/src/__tests__/provider-list.test.ts packages/server/src/__tests__/provider-runtime/runtime-status.test.ts
```

Expected: FAIL where old assumptions still treat only Codex as generation-capable.

- [ ] **Step 3: Adjust fixtures or assertions to match the expanded capability set**

Make the tests assert the intended rule:

- generation-capable means provider advertises `agent_instructions_generate`
- visible in UI only when runtime-available

Do not change the filtering rule itself unless a failing test shows an actual logic gap.

- [ ] **Step 4: Re-run the targeted provider listing and UI tests**

Run:

```bash
pnpm vitest run packages/web/src/features/workspace/views/shared/agent-instructions-section.test.tsx packages/server/src/__tests__/provider-list.test.ts packages/server/src/__tests__/provider-runtime/runtime-status.test.ts
```

Expected: PASS

### Task 5: Full Regression Verification

**Files:**
- No additional code changes expected

- [ ] **Step 1: Run the full targeted regression suite**

Run:

```bash
pnpm vitest run \
  packages/providers/src/claude/definition.test.ts \
  packages/providers/src/gemini/definition.test.ts \
  packages/providers/src/cursor/definition.test.ts \
  packages/server/src/__tests__/agent-instructions/output.test.ts \
  packages/server/src/__tests__/agent-instructions-command.test.ts \
  packages/server/src/__tests__/provider-list.test.ts \
  packages/server/src/__tests__/provider-runtime/runtime-status.test.ts \
  packages/web/src/features/workspace/views/shared/agent-instructions-section.test.tsx
```

Expected: PASS

- [ ] **Step 2: Run lint or type-aware validation if the changed packages require it**

Run:

```bash
pnpm vitest run
```

If that is too slow or noisy in the current branch, run the repo-standard targeted verification command that covers changed packages and record what was actually run.

- [ ] **Step 3: Review git diff for scope**

Run:

```bash
git diff -- packages/providers/src packages/server/src packages/web/src
```

Expected: only provider capability, prompt/parser/generator flow, and related tests change.
