import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface WorkflowJob {
  uses?: string;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps?: Array<{
    id?: string;
    name?: string;
    uses?: string;
    if?: string;
    run?: string;
    with?: Record<string, unknown>;
  }>;
}

interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

const workflowsRoot = resolve(import.meta.dirname, "../.github/workflows");

function loadWorkflow(name: string): Workflow {
  return parse(readFileSync(resolve(workflowsRoot, name), "utf8")) as Workflow;
}

describe("GitHub workflow boundaries", () => {
  it("keeps repository CI fast and reusable", () => {
    const workflow = loadWorkflow("ci.yml");
    expect(workflow.on).toEqual({
      workflow_call: null,
      pull_request: null,
      push: { branches: ["main"] },
    });
    expect(Object.keys(workflow.jobs).sort()).toEqual(["verify", "windows-runtime-verify"].sort());
  });

  it("runs Desktop integration for relevant changes and reusable signed builds", () => {
    const workflow = loadWorkflow("desktop-verify.yml");
    const pullRequest = workflow.on.pull_request as { paths: string[] };
    const push = workflow.on.push as { branches: string[]; paths?: string[] };
    const workflowCall = workflow.on.workflow_call as {
      inputs: Record<string, { type: string; required: boolean; default?: unknown }>;
      outputs: Record<string, { description: string; value: string }>;
    };
    const windowsJob = workflow.jobs["desktop-windows-verify"];
    const linuxJob = workflow.jobs["desktop-linux-assets-verify"];
    const windowsSteps = windowsJob.steps ?? [];
    const linuxSteps = linuxJob.steps ?? [];
    const windowsUpload = windowsSteps.find((step) => step.uses === "actions/upload-artifact@v4");
    const linuxUpload = linuxSteps.find((step) => step.uses === "actions/upload-artifact@v4");
    const windowsValidation = windowsSteps.find(
      (step) => step.name === "Stage and validate Windows release assets"
    );
    const linuxValidation = linuxSteps.find(
      (step) => step.name === "Stage and validate WSL release assets"
    );

    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(push).toEqual({ branches: ["main"] });
    expect(pullRequest.paths).toEqual([
      ".github/workflows/desktop-verify.yml",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "packages/desktop/**",
      "packages/desktop-engine/**",
      "packages/server/**",
      "packages/web/**",
      "packages/providers/**",
      "packages/core/**",
      "packages/utils/**",
      "packages/cli/**",
      "scripts/**",
    ]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflowCall.inputs).toEqual({
      signed: { type: "boolean", required: false, default: false },
      signing_key_artifact: { type: "string", required: false, default: "" },
      runtime_update_url: { type: "string", required: false, default: "" },
    });
    expect(workflowCall.outputs).toEqual({
      windows_artifact: {
        description: "Windows Desktop verification artifact",
        value: "${{ jobs['desktop-windows-verify'].outputs.artifact_name }}",
      },
      linux_artifact: {
        description: "Linux Desktop verification artifact",
        value: "${{ jobs['desktop-linux-assets-verify'].outputs.artifact_name }}",
      },
    });
    expect(Object.keys(workflow.jobs)).toEqual([
      "desktop-windows-verify",
      "desktop-linux-assets-verify",
    ]);
    expect(windowsJob.outputs).toEqual({
      artifact_name: "${{ steps.artifact_name.outputs.value }}",
    });
    expect(linuxJob.outputs).toEqual({
      artifact_name: "${{ steps.artifact_name.outputs.value }}",
    });
    expect(windowsSteps[0]).toMatchObject({
      id: "artifact_name",
      run: '"value=desktop-windows-${{ github.sha }}" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append',
    });
    expect(linuxSteps[0]).toMatchObject({
      id: "artifact_name",
      run: 'echo "value=desktop-linux-${GITHUB_SHA}" >> "${GITHUB_OUTPUT}"',
    });
    expect(windowsUpload?.with).toMatchObject({
      name: "${{ steps.artifact_name.outputs.value }}",
      overwrite: true,
    });
    expect(linuxUpload?.with).toMatchObject({
      name: "${{ steps.artifact_name.outputs.value }}",
      overwrite: true,
    });
    expect(
      windowsSteps.filter(
        (step) => step.name?.includes("signing key") || step.name?.includes("signed acceptance")
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Download acceptance signing key", if: "inputs.signed" }),
        expect.objectContaining({
          name: "Configure signed acceptance channel",
          if: "inputs.signed",
        }),
      ])
    );
    expect(
      linuxSteps.filter(
        (step) => step.name?.includes("signing key") || step.name?.includes("signed acceptance")
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Download acceptance signing key", if: "inputs.signed" }),
        expect.objectContaining({
          name: "Configure signed acceptance channel",
          if: "inputs.signed",
        }),
      ])
    );
    expect(windowsValidation?.run).toContain('if ("${{ inputs.signed }}" -eq "true")');
    expect(windowsValidation?.run).toContain(
      "validate --directory release/desktop-release-windows --components 'desktop,win-runtime'"
    );
    expect(windowsValidation?.run).toContain("--allow-unsigned");
    expect(linuxValidation?.run).toContain('if [[ "${{ inputs.signed }}" == "true" ]]');
    expect(linuxValidation?.run).toContain(
      "validate --directory release/desktop-release-linux --components 'wsl-engine,wsl-runtime'"
    );
    expect(linuxValidation?.run).toContain("--allow-unsigned");
  });
});
