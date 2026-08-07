import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface WorkflowJob {
  uses?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  with?: Record<string, unknown>;
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

  it("publishes acceptance assets only through an explicit manual workflow", () => {
    const workflow = loadWorkflow("desktop-acceptance.yml");
    const prepare = workflow.jobs.prepare;
    const repositoryVerify = workflow.jobs["repository-verify"];
    const buildAssets = workflow.jobs["build-assets"];
    const publish = workflow.jobs.publish;
    const prepareSteps = prepare.steps ?? [];
    const publishSteps = publish.steps ?? [];
    const resolveChannel = prepareSteps.find((step) => step.name === "Resolve acceptance channel");
    const generateKey = prepareSteps.find(
      (step) => step.name === "Generate ephemeral Runtime signing key"
    );
    const signingKeyUpload = prepareSteps.find(
      (step) => step.name === "Upload ephemeral signing key"
    );
    const publicKeyUpload = prepareSteps.find(
      (step) => step.name === "Upload acceptance public key"
    );
    const artifactDownloads = publishSteps.filter(
      (step) =>
        step.uses === "actions/download-artifact@v4" && step.name?.includes("acceptance assets")
    );
    const publicKeyDownload = publishSteps.find(
      (step) => step.name === "Download acceptance public key"
    );
    const validation = publishSteps.find(
      (step) => step.name === "Validate complete signed acceptance channel"
    );
    const release = publishSteps.find((step) => step.name === "Publish tag-pinned prerelease");

    expect(workflow.on).toEqual({ workflow_dispatch: null });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(Object.keys(workflow.jobs)).toEqual([
      "prepare",
      "repository-verify",
      "build-assets",
      "publish",
    ]);
    expect(prepare.permissions).toEqual({ contents: "read" });
    expect(prepare.outputs).toEqual({
      release_tag: "${{ steps.channel.outputs.release_tag }}",
      release_base_url: "${{ steps.channel.outputs.release_base_url }}",
      runtime_update_url: "${{ steps.channel.outputs.runtime_update_url }}",
      signing_key_artifact: "${{ steps.channel.outputs.signing_key_artifact }}",
      public_key_artifact: "${{ steps.channel.outputs.public_key_artifact }}",
    });
    expect(resolveChannel?.run).toContain(
      'release_tag="desktop-ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"'
    );
    expect(resolveChannel?.run).toContain(
      'release_base_url="https://github.com/${GITHUB_REPOSITORY}/releases/download/${release_tag}"'
    );
    expect(resolveChannel?.run).toContain(
      "runtime_update_url=${release_base_url}/coder-studio-runtime-win32-x64.manifest.json"
    );
    expect(resolveChannel?.run).toContain(
      'signing_key_artifact="desktop-ci-signing-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"'
    );
    expect(resolveChannel?.run).toContain(
      'public_key_artifact="desktop-acceptance-public-key-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"'
    );
    expect(generateKey?.run).toContain("openssl genpkey -algorithm Ed25519");
    expect(signingKeyUpload?.with).toMatchObject({
      name: "${{ steps.channel.outputs.signing_key_artifact }}",
      path: "release/desktop-ci-signing/",
      "retention-days": 1,
    });
    expect(publicKeyUpload?.with).toMatchObject({
      name: "${{ steps.channel.outputs.public_key_artifact }}",
      path: "release/desktop-ci-signing/runtime-public.pem",
    });
    expect(repositoryVerify).toMatchObject({
      permissions: { contents: "read" },
      uses: "./.github/workflows/ci.yml",
    });
    expect(buildAssets).toMatchObject({
      needs: "prepare",
      permissions: { contents: "read" },
      uses: "./.github/workflows/desktop-verify.yml",
      with: {
        signed: true,
        signing_key_artifact: "${{ needs.prepare.outputs.signing_key_artifact }}",
        runtime_update_url: "${{ needs.prepare.outputs.runtime_update_url }}",
      },
    });
    expect(publish.needs).toEqual(["prepare", "repository-verify", "build-assets"]);
    expect(publish.permissions).toEqual({ contents: "write" });
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name !== "publish") expect(job.permissions?.contents).not.toBe("write");
    }
    expect(artifactDownloads.map((step) => step.with?.name)).toEqual([
      "${{ needs.build-assets.outputs.windows_artifact }}",
      "${{ needs.build-assets.outputs.linux_artifact }}",
    ]);
    for (const download of artifactDownloads) {
      expect(download.with?.path).toBe("release/desktop-acceptance");
    }
    expect(publicKeyDownload?.with).toMatchObject({
      name: "${{ needs.prepare.outputs.public_key_artifact }}",
      path: "release/desktop-ci-signing",
    });
    expect(validation?.run).toContain(
      "validate --directory release/desktop-acceptance --components 'desktop,win-runtime,wsl-engine,wsl-runtime'"
    );
    expect(release?.run).toContain("gh release create");
    expect(release?.run).toContain("--draft");
    expect(release?.run).toContain(
      "gh api \"repos/${GITHUB_REPOSITORY}/releases/tags/${RELEASE_TAG}\" --jq '.draft'"
    );
    expect(release?.run).toContain('if [[ "${existing_is_draft}" != "true" ]]');
    expect(release?.run).toContain("Refusing to overwrite non-draft release");
    expect(release?.run).toContain("elif grep -q '(HTTP 404)'");
    expect(release?.run).toContain(
      'gh release upload "${RELEASE_TAG}" release/desktop-acceptance/* --clobber'
    );
    expect(release?.run).toContain(
      'gh release edit "${RELEASE_TAG}" --draft=false --prerelease --latest=false'
    );
  });
});
