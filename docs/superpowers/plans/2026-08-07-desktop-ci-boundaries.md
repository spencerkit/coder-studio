# Desktop CI Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate fast repository CI, heavyweight Desktop integration verification, and manually published Desktop acceptance channels without changing Desktop/Runtime build commands or production release behavior.

**Architecture:** Keep `.github/workflows/ci.yml` as the universal fast check and make it callable by acceptance. Move Windows Desktop packaging and Linux WSL verification into a path-aware reusable workflow. Add a manual acceptance workflow that creates ephemeral signing material, calls both reusable validation workflows, and publishes only after all signed assets pass validation.

**Tech Stack:** GitHub Actions reusable workflows, pnpm, TypeScript, Vitest, `yaml`, Electron Builder, OpenSSL, GitHub CLI.

---

## File Map

- Modify `package.json` and `pnpm-lock.yaml`: add the YAML parser used by workflow contract tests.
- Create `scripts/github-workflows.test.ts`: protect event, job, permission, path, reusable-input, and artifact-output boundaries.
- Modify `.github/workflows/ci.yml`: retain fast jobs, add `workflow_call`, and remove Desktop/acceptance jobs.
- Create `.github/workflows/desktop-verify.yml`: reusable/direct Windows and Linux Desktop integration lanes.
- Create `.github/workflows/desktop-acceptance.yml`: manual signing, reusable validation, aggregation, and prerelease publication.
- Modify `docs/desktop.md` and `docs/desktop-runtime-updates.md`: document the three workflow layers.

### Task 1: Protect and Extract Fast Repository CI

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `scripts/github-workflows.test.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the YAML parser as a direct test dependency**

```bash
pnpm add --save-dev --workspace-root yaml@^2.8.1
```

Expected: the root manifest and lockfile record `yaml`.

- [ ] **Step 2: Write the failing fast-CI boundary test**

Create `scripts/github-workflows.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface WorkflowJob {
  uses?: string;
  permissions?: Record<string, string>;
}

interface Workflow {
  on: Record<string, unknown>;
  jobs: Record<string, WorkflowJob>;
}

const workflowsRoot = resolve(import.meta.dirname, "../.github/workflows");

function loadWorkflow(name: string): Workflow {
  return parse(readFileSync(resolve(workflowsRoot, name), "utf8")) as Workflow;
}

describe("GitHub workflow boundaries", () => {
  it("keeps repository CI fast and reusable", () => {
    const workflow = loadWorkflow("ci.yml");
    expect(workflow.on).toHaveProperty("workflow_call");
    expect(workflow.on).toHaveProperty("pull_request");
    expect(workflow.on).toMatchObject({ push: { branches: ["main"] } });
    expect(Object.keys(workflow.jobs)).toEqual(["verify", "windows-runtime-verify"]);
  });
});
```

- [ ] **Step 3: Run RED**

```bash
pnpm exec vitest run --config scripts/vitest.config.ts scripts/github-workflows.test.ts
```

Expected: FAIL because `ci.yml` lacks `workflow_call` and still contains Desktop/acceptance jobs.

- [ ] **Step 4: Implement the fast workflow boundary**

Change the trigger to:

```yaml
on:
  workflow_call:
  pull_request:
  push:
    branches:
      - main
```

Delete `acceptance_channel`, `desktop-windows-verify`, `desktop-linux-assets-verify`, and `publish-desktop-acceptance`. Preserve the existing `verify`, `windows-runtime-verify`, and concurrency blocks byte-for-byte.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm exec vitest run --config scripts/vitest.config.ts scripts/github-workflows.test.ts
git add package.json pnpm-lock.yaml scripts/github-workflows.test.ts .github/workflows/ci.yml
git commit -m "ci: isolate fast repository verification"
```

Expected: PASS, then one focused commit.

### Task 2: Add Reusable Desktop Integration Verification

**Files:**
- Modify: `scripts/github-workflows.test.ts`
- Create: `.github/workflows/desktop-verify.yml`

- [ ] **Step 1: Add the failing Desktop workflow contract**

Append inside the existing `describe` block:

```ts
it("runs Desktop integration for relevant changes and reusable signed builds", () => {
  const workflow = loadWorkflow("desktop-verify.yml");
  const pullRequest = workflow.on.pull_request as { paths: string[] };
  const workflowCall = workflow.on.workflow_call as {
    inputs: Record<string, { type: string; default?: unknown }>;
    outputs: Record<string, { value: string }>;
  };

  expect(workflow.on).toHaveProperty("workflow_dispatch");
  expect(workflow.on).toMatchObject({ push: { branches: ["main"] } });
  expect(pullRequest.paths).toEqual(expect.arrayContaining([
    ".github/workflows/desktop-verify.yml",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "packages/desktop/**",
    "packages/desktop-engine/**",
    "packages/server/**",
    "packages/web/**",
    "packages/providers/**",
    "packages/core/**",
    "packages/utils/**",
    "packages/cli/**",
    "scripts/**",
  ]));
  expect(workflowCall.inputs).toMatchObject({
    signed: { type: "boolean", default: false },
    signing_key_artifact: { type: "string", default: "" },
    runtime_update_url: { type: "string", default: "" },
  });
  expect(Object.keys(workflowCall.outputs)).toEqual(["windows_artifact", "linux_artifact"]);
  expect(Object.keys(workflow.jobs)).toEqual([
    "desktop-windows-verify",
    "desktop-linux-assets-verify",
  ]);
});
```

- [ ] **Step 2: Run RED**

Run the focused Vitest command from Task 1. Expected: FAIL with `ENOENT` for `desktop-verify.yml`.

- [ ] **Step 3: Create the reusable/direct workflow interface**

Use `workflow_call` inputs `signed` (boolean, default `false`), `signing_key_artifact` (string, default empty), and `runtime_update_url` (string, default empty). Expose `windows_artifact` and `linux_artifact` from the two job outputs. Add direct `workflow_dispatch`, path-filtered `pull_request`, and unconditional `push` to `main`.

The PR paths must be exactly the safe dependency closure asserted by the test. Add read-only top-level permissions and:

```yaml
concurrency:
  group: desktop-verify-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

- [ ] **Step 4: Move and parameterize the Windows job**

Move the current `desktop-windows-verify` body out of `ci.yml`. Remove `needs: acceptance_channel`. Add an `artifact_name` job output backed by this first step:

```yaml
- name: Resolve artifact name
  id: artifact-name
  shell: pwsh
  run: '"name=desktop-windows-${{ github.sha }}" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append'
```

Use `if: inputs.signed` for signing-artifact download/configuration. Set the existing private key, public key, and `${{ inputs.runtime_update_url }}` in `GITHUB_ENV`. Keep Desktop test/typecheck, `pnpm dist:desktop`, smoke, staging, and upload commands unchanged. Signed calls validate normally; direct unsigned runs add `--allow-unsigned`. Upload `${{ steps.artifact-name.outputs.name }}`.

- [ ] **Step 5: Move and parameterize the Linux job**

Move the current `desktop-linux-assets-verify` body, remove `needs: acceptance_channel`, and add:

```yaml
- name: Resolve artifact name
  id: artifact-name
  shell: bash
  run: echo "name=desktop-linux-${GITHUB_SHA}" >> "${GITHUB_OUTPUT}"
```

Expose that name as the job output. Use `if: inputs.signed` for signing setup. Keep WSL Engine/Runtime builds and staging unchanged. Require signed validation for called acceptance and allow unsigned direct verification. Upload the resolved artifact name.

- [ ] **Step 6: Run GREEN and commit**

```bash
pnpm exec vitest run --config scripts/vitest.config.ts scripts/github-workflows.test.ts scripts/desktop-release-artifacts.test.ts scripts/package-desktop.test.ts scripts/prepare-desktop-package.test.ts
git add scripts/github-workflows.test.ts .github/workflows/desktop-verify.yml
git commit -m "ci: extract desktop integration verification"
```

Expected: all selected tests PASS.

### Task 3: Add Manual Signed Acceptance Publication

**Files:**
- Modify: `scripts/github-workflows.test.ts`
- Create: `.github/workflows/desktop-acceptance.yml`

- [ ] **Step 1: Add the failing acceptance contract**

Append:

```ts
it("publishes acceptance assets only through an explicit manual workflow", () => {
  const workflow = loadWorkflow("desktop-acceptance.yml");
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.jobs["repository-verify"]?.uses).toBe("./.github/workflows/ci.yml");
  expect(workflow.jobs["build-assets"]?.uses).toBe("./.github/workflows/desktop-verify.yml");
  expect(workflow.jobs.publish?.permissions).toMatchObject({ contents: "write" });
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (name !== "publish") expect(job.permissions?.contents).not.toBe("write");
  }
});
```

- [ ] **Step 2: Run RED**

Run the focused workflow test. Expected: FAIL with `ENOENT` for `desktop-acceptance.yml`.

- [ ] **Step 3: Create preparation and reusable validation jobs**

Create a `workflow_dispatch`-only workflow. Its read-only `prepare` job emits `release_tag`, `release_base_url`, `runtime_update_url`, and `signing_key_artifact`; generates the same ephemeral Ed25519 pair as the old CI job; uploads the pair for one day; and separately uploads only `runtime-public.pem` as `desktop-acceptance-public-key-${{ github.run_id }}-${{ github.run_attempt }}`.

Add:

```yaml
repository-verify:
  permissions:
    contents: read
  uses: ./.github/workflows/ci.yml

build-assets:
  needs: prepare
  permissions:
    contents: read
  uses: ./.github/workflows/desktop-verify.yml
  with:
    signed: true
    signing_key_artifact: ${{ needs.prepare.outputs.signing_key_artifact }}
    runtime_update_url: ${{ needs.prepare.outputs.runtime_update_url }}
```

- [ ] **Step 4: Add write-scoped publication**

`publish` must need `prepare`, `repository-verify`, and `build-assets`, and it alone gets `contents: write`. Download the exact reusable-workflow output artifacts into `release/desktop-acceptance`, load the acceptance public key, validate all four components, and reuse the existing draft-then-prerelease `gh release` commands. Do not pass `--latest`.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm exec vitest run --config scripts/vitest.config.ts scripts/github-workflows.test.ts
git add scripts/github-workflows.test.ts .github/workflows/desktop-acceptance.yml
git commit -m "ci: separate desktop acceptance publishing"
```

Expected: all workflow contract tests PASS.

### Task 4: Update Desktop Workflow Documentation

**Files:**
- Modify: `docs/desktop.md:242`
- Modify: `docs/desktop-runtime-updates.md:99`

- [ ] **Step 1: Document the three validation layers**

Replace the old two-layer section with four bullets: fast `ci.yml`; path-aware/callable `desktop-verify.yml`; manual signed `desktop-acceptance.yml`; and unchanged production `desktop-release.yml`. State that only acceptance publishes test assets and that it never updates `latest`.

- [ ] **Step 2: Replace stale operator instructions**

Tell operators to manually run `Publish Desktop acceptance`; remove `publish_acceptance=true`. Preserve ephemeral-key retention, tag-pinned prerelease, and cleanup guidance.

- [ ] **Step 3: Verify references and commit**

```bash
rg -n 'publish_acceptance|手动运行 `CI`|desktop-acceptance|desktop-verify' docs .github/workflows
git add docs/desktop.md docs/desktop-runtime-updates.md
git commit -m "docs: describe desktop CI layers"
```

Expected: no stale operator instructions.

### Task 5: Verify the Complete Change

**Files:**
- Verify only; correct only planned files if a check identifies a defect.

- [ ] **Step 1: Run focused tests**

```bash
pnpm exec vitest run --config scripts/vitest.config.ts scripts/github-workflows.test.ts scripts/desktop-release-artifacts.test.ts scripts/package-desktop.test.ts scripts/prepare-desktop-package.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository verification**

```bash
pnpm ci:verify
```

Expected: changeset validation, lint, tests, and production build PASS.

- [ ] **Step 3: Inspect final state**

```bash
git diff --check origin/feature/desktop...HEAD
git status --short
git diff origin/feature/desktop...HEAD -- .github/workflows package.json pnpm-lock.yaml scripts/github-workflows.test.ts docs/desktop.md docs/desktop-runtime-updates.md
```

Expected: no whitespace errors; unrelated user files remain untracked and untouched.

- [ ] **Step 4: Review invariants**

Confirm universal CI has only two fast jobs; Desktop verification is path-aware on PRs and callable; unsigned direct builds alone use `--allow-unsigned`; acceptance calls both reusable workflows; only its publish job writes contents; and `desktop-release.yml` is unchanged.

- [ ] **Step 5: Commit any correction**

If verification required a correction, stage only affected planned files and commit `fix: validate desktop workflow boundaries`. If not, do not create an empty commit.
