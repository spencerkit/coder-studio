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
    const workflowCall = workflow.on.workflow_call as {
      inputs: Record<string, { type: string; default?: unknown }>;
      outputs: Record<string, { value: string }>;
    };

    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.on).toMatchObject({ push: { branches: ["main"] } });
    expect(pullRequest.paths).toEqual(
      expect.arrayContaining([
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
      ])
    );
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
});
