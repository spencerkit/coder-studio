import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface WorkflowJob {
  uses?: string;
  needs?: string | string[];
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  with?: Record<string, unknown>;
  strategy?: { matrix?: Record<string, unknown> };
  secrets?: Record<string, string>;
  steps?: Array<{
    id?: string;
    name?: string;
    uses?: string;
    if?: string;
    run?: string;
    env?: Record<string, string>;
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
    const verifySteps = workflow.jobs.verify.steps ?? [];
    expect(verifySteps.find((step) => step.name === "Run type checks")?.run).toBe(
      "pnpm ci:typecheck"
    );
  });

  it("runs Desktop integration for relevant changes and reusable signed builds", () => {
    const workflow = loadWorkflow("desktop-verify.yml");
    const pullRequest = workflow.on.pull_request as { paths: string[] };
    const push = workflow.on.push as { branches: string[]; paths?: string[] };
    const workflowCall = workflow.on.workflow_call as {
      inputs: Record<string, { type: string; required: boolean; default?: unknown }>;
      outputs: Record<string, { description: string; value: string }>;
      secrets: Record<string, { required: boolean }>;
    };
    const windowsJob = workflow.jobs["desktop-windows-verify"];
    const linuxJob = workflow.jobs["desktop-linux-assets-verify"];
    const merged = workflow.jobs["desktop-channel-verify"];
    const windowsSteps = windowsJob.steps ?? [];
    const linuxSteps = linuxJob.steps ?? [];
    const windowsUpload = windowsSteps.find((step) => step.uses === "actions/upload-artifact@v4");
    const linuxUpload = linuxSteps.find((step) => step.uses === "actions/upload-artifact@v4");
    const windowsStage = windowsSteps.find((step) => step.name === "Stage Windows release assets");
    const linuxStage = linuxSteps.find((step) => step.name === "Stage WSL release assets");
    const windowsTypecheck = windowsSteps.find(
      (step) => step.name === "Test Desktop and type-check repository"
    );

    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(push).toEqual({ branches: ["main"] });
    expect(pullRequest.paths).toEqual([
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
    ]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflowCall.inputs).toEqual({
      signed: { type: "boolean", required: false, default: false },
      windows_signing: { type: "boolean", required: false, default: true },
      signing_key_artifact: { type: "string", required: false, default: "" },
      runtime_update_url: { type: "string", required: false, default: "" },
      release_tag: { type: "string", required: false, default: "" },
      runtime_min_shell_version: { type: "string", required: false, default: "" },
    });
    expect(workflowCall.secrets).toEqual({
      windows_csc_link: { required: false },
      windows_csc_key_password: { required: false },
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
      complete_artifact: {
        description: "Complete signed Desktop verification bundle",
        value: "${{ jobs['desktop-channel-verify'].outputs.artifact_name }}",
      },
    });
    expect(Object.keys(workflow.jobs)).toEqual([
      "prepare",
      "desktop-windows-verify",
      "desktop-linux-assets-verify",
      "desktop-channel-verify",
    ]);
    expect(merged.outputs).toEqual({
      artifact_name: "${{ steps.artifact_name.outputs.value }}",
    });
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
    expect(windowsJob.env).toMatchObject({
      CSC_LINK: "${{ inputs.windows_signing && secrets.windows_csc_link || '' }}",
      CSC_KEY_PASSWORD: "${{ inputs.windows_signing && secrets.windows_csc_key_password || '' }}",
      CSC_IDENTITY_AUTO_DISCOVERY: "${{ inputs.windows_signing && 'true' || 'false' }}",
    });
    const authenticode = windowsSteps.find(
      (step) => step.name === "Verify acceptance Authenticode signatures"
    );
    expect(authenticode?.if).toBe("inputs.windows_signing");
    expect(authenticode?.run).toContain("Get-AuthenticodeSignature");
    expect(authenticode?.run).toContain("release/desktop/latest.yml");
    expect(windowsTypecheck?.run).toContain("pnpm ci:typecheck");
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
        expect.objectContaining({ name: "Download acceptance signing key" }),
        expect.objectContaining({ name: "Configure signed acceptance channel" }),
      ])
    );
    expect(
      linuxSteps.filter(
        (step) => step.name?.includes("signing key") || step.name?.includes("signed acceptance")
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Download acceptance signing key" }),
        expect.objectContaining({ name: "Configure signed acceptance channel" }),
      ])
    );
    expect(windowsStage?.run).toContain(
      "stage --directory release/desktop-release-windows --components 'desktop,win-runtime'"
    );
    expect(linuxStage?.run).toContain(
      "stage --directory release/desktop-release-linux --components 'wsl-engine,wsl-runtime'"
    );
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
        step.uses === "actions/download-artifact@v4" && step.name?.includes("acceptance bundle")
    );
    const publicKeyDownload = publishSteps.find(
      (step) => step.name === "Download acceptance public key"
    );
    const previousShellBlockmapIndex = publishSteps.findIndex(
      (step) => step.name === "Carry forward previous Shell blockmap for legacy updater fallback"
    );
    const forceFullDownloadIndex = publishSteps.findIndex(
      (step) => step.name === "Force full Shell installer download"
    );
    const previousReleaseIndex = publishSteps.findIndex(
      (step) => step.name === "Download previous immutable Desktop release"
    );
    const migrationChannelIndex = publishSteps.findIndex(
      (step) => step.name === "Build legacy Runtime and manual modern Shell channels"
    );
    const validation = publishSteps.find(
      (step) => step.name === "Validate complete signed acceptance channel"
    );
    const validationIndex = publishSteps.findIndex(
      (step) => step.name === "Validate complete signed acceptance channel"
    );
    const release = publishSteps.find((step) => step.name === "Publish tag-pinned prerelease");

    expect(workflow.on).toEqual({
      workflow_dispatch: {
        inputs: {
          windows_signing: {
            description: "Sign Windows executables with Authenticode",
            required: true,
            default: true,
            type: "boolean",
          },
        },
      },
    });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(Object.keys(workflow.jobs)).toEqual([
      "prepare",
      "repository-verify",
      "build-assets",
      "publish",
      "installed-upgrades",
    ]);
    expect(prepare.permissions).toEqual({ contents: "read" });
    expect(prepare.outputs).toEqual({
      release_tag: "${{ steps.channel.outputs.release_tag }}",
      release_base_url: "${{ steps.channel.outputs.release_base_url }}",
      runtime_update_url: "${{ steps.channel.outputs.runtime_update_url }}",
      signing_key_artifact: "${{ steps.channel.outputs.signing_key_artifact }}",
      public_key_artifact: "${{ steps.channel.outputs.public_key_artifact }}",
      has_previous_desktop: "${{ steps.channel.outputs.has_previous_desktop }}",
      release_kind: "${{ steps.channel.outputs.release_kind }}",
      runtime_min_shell_version: "${{ steps.channel.outputs.runtime_min_shell_version }}",
      acceptance_scenarios: "${{ steps.channel.outputs.acceptance_scenarios }}",
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
    expect(resolveChannel?.run).toContain("has_previous_desktop=false");
    expect(resolveChannel?.run).toContain('--repo "${GITHUB_REPOSITORY}"');
    expect(resolveChannel?.run).toContain("require('./packages/desktop/package.json').version");
    expect(resolveChannel?.run).toContain("require('./packages/cli/package.json').version");
    expect(resolveChannel?.run).toContain("channel?.shell?.version===currentShell");
    expect(resolveChannel?.run).toContain("?'false':'true'");
    expect(resolveChannel?.run).toContain("release_kind=runtime-only");
    expect(resolveChannel?.run).toContain("release_kind=migration");
    expect(resolveChannel?.run).toContain("desktop-channel-modern.json");
    expect(resolveChannel?.run).toContain('runtime_min_shell_version="${current_shell}"');
    expect(resolveChannel?.run).toContain('runtime_min_shell_version="${previous_shell}"');
    expect(resolveChannel?.run).toContain("latest_legacy_channel");
    expect(resolveChannel?.run).toContain("--pattern 'desktop-channel.json'");
    expect(resolveChannel?.run).toContain(
      'acceptance_scenarios=\'["combined","wsl-combined","runtime-health-rollback","interrupted-download","restart-journal-recovery","external-sidecar-browser"]\''
    );
    expect(resolveChannel?.run).toContain(
      'acceptance_scenarios=\'["runtime-only","wsl","runtime-health-rollback","interrupted-download","restart-journal-recovery","external-sidecar-browser"]\''
    );
    expect(resolveChannel?.run).toContain(
      'acceptance_scenarios=\'["legacy-current","legacy-wsl-current","fresh-native","fresh-wsl","external-sidecar-browser"]\''
    );
    expect(resolveChannel?.run).toContain('acceptance_scenarios=\'["fresh-native","fresh-wsl"]\'');
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
        windows_signing: "${{ inputs.windows_signing }}",
        signing_key_artifact: "${{ needs.prepare.outputs.signing_key_artifact }}",
        runtime_update_url: "${{ needs.prepare.outputs.runtime_update_url }}",
        release_tag: "${{ needs.prepare.outputs.release_tag }}",
        runtime_min_shell_version: "${{ needs.prepare.outputs.runtime_min_shell_version }}",
      },
      secrets: {
        windows_csc_link: "${{ secrets.DESKTOP_WINDOWS_CSC_LINK }}",
        windows_csc_key_password: "${{ secrets.DESKTOP_WINDOWS_CSC_KEY_PASSWORD }}",
      },
    });
    expect(publish.needs).toEqual(["prepare", "repository-verify", "build-assets"]);
    expect(publish.environment).toBe("desktop-production");
    expect(publish.permissions).toEqual({ contents: "write" });
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name !== "publish") expect(job.permissions?.contents).not.toBe("write");
    }
    expect(artifactDownloads.map((step) => step.with?.name)).toEqual([
      "${{ needs.build-assets.outputs.complete_artifact }}",
    ]);
    for (const download of artifactDownloads) {
      expect(download.with?.path).toBe("release/desktop-acceptance");
    }
    expect(publicKeyDownload?.with).toMatchObject({
      name: "${{ needs.prepare.outputs.public_key_artifact }}",
      path: "release/desktop-ci-signing",
    });
    expect(previousShellBlockmapIndex).toBe(-1);
    expect(forceFullDownloadIndex).toBe(-1);
    expect(previousReleaseIndex).toBeGreaterThan(-1);
    expect(migrationChannelIndex).toBeGreaterThan(previousReleaseIndex);
    expect(validationIndex).toBeGreaterThan(migrationChannelIndex);
    expect(publishSteps[previousReleaseIndex]?.if).toBe(
      "needs.prepare.outputs.release_kind != 'full'"
    );
    expect(publishSteps[migrationChannelIndex]?.run).toContain("--prepare-modern-base");
    expect(publishSteps[migrationChannelIndex]?.run).toContain("--carry-forward-modern-from");
    expect(publishSteps[migrationChannelIndex]?.run).toContain("--carry-forward-shell-from");
    expect(publishSteps[migrationChannelIndex]?.run).toContain("--carry-forward-legacy-from");
    expect(publishSteps[migrationChannelIndex]?.run).toContain(
      "coder-studio-runtime-modern-win32-x64.manifest.json"
    );
    expect(publishSteps[migrationChannelIndex]?.run).toContain(
      "--output desktop-channel-modern.json"
    );
    expect(validation?.run).toContain('--release-kind "${{ needs.prepare.outputs.release_kind }}"');
    expect(validation?.run).toContain("--previous-release-directory");
    expect(validation?.run).toContain("--allow-resigned-engine");
    expect(validation?.run).toContain("Previous Desktop Runtime public key is required");
    expect(validation?.env?.CODER_STUDIO_PREVIOUS_RUNTIME_PUBLIC_KEY).toBe(
      "${{ secrets.DESKTOP_RUNTIME_PUBLIC_KEY }}"
    );
    expect(JSON.stringify(publish)).not.toContain("desktop:force-full-download");
    expect(publish.outputs?.complete_artifact).toBe("${{ steps.bundle.outputs.name }}");
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

  it("builds and validates one immutable signed Desktop channel before exposure", () => {
    const verify = loadWorkflow("desktop-verify.yml");
    const verifyPrepare = verify.jobs.prepare;
    const windows = verify.jobs["desktop-windows-verify"];
    const linux = verify.jobs["desktop-linux-assets-verify"];
    const merged = verify.jobs["desktop-channel-verify"];
    const mergedSteps = merged.steps ?? [];

    expect(verifyPrepare.outputs).toMatchObject({
      published_at: "${{ steps.metadata.outputs.published_at }}",
      signing_key_artifact: "${{ steps.metadata.outputs.signing_key_artifact }}",
      public_key_artifact: "${{ steps.metadata.outputs.public_key_artifact }}",
    });
    const prepareMetadata = (verifyPrepare.steps ?? []).find(
      (step) => step.name === "Resolve shared release metadata"
    );
    expect(prepareMetadata?.run).toContain("date -u +'%Y-%m-%dT%H:%M:%S.000Z'");
    expect(prepareMetadata?.run).toContain("published_at=${published_at}");
    expect(windows.needs).toBe("prepare");
    expect(linux.needs).toBe("prepare");
    expect(windows.env?.CODER_STUDIO_RELEASE_PUBLISHED_AT).toBe(
      "${{ needs.prepare.outputs.published_at }}"
    );
    expect(linux.env?.CODER_STUDIO_RELEASE_PUBLISHED_AT).toBe(
      "${{ needs.prepare.outputs.published_at }}"
    );
    expect(windows.env?.CODER_STUDIO_RUNTIME_MIN_SHELL_VERSION).toBe(
      "${{ inputs.runtime_min_shell_version }}"
    );
    expect(linux.env?.CODER_STUDIO_RUNTIME_MIN_SHELL_VERSION).toBe(
      "${{ inputs.runtime_min_shell_version }}"
    );
    expect(merged.needs).toEqual([
      "prepare",
      "desktop-windows-verify",
      "desktop-linux-assets-verify",
    ]);
    const buildIndex = mergedSteps.findIndex(
      (step) => step.name === "Build signed Desktop channel"
    );
    const validateIndex = mergedSteps.findIndex(
      (step) => step.name === "Validate complete signed Desktop channel"
    );
    const uploadIndex = mergedSteps.findIndex(
      (step) => step.name === "Upload complete Desktop verification bundle"
    );
    expect(buildIndex).toBeGreaterThan(-1);
    expect(validateIndex).toBeGreaterThan(buildIndex);
    expect(uploadIndex).toBeGreaterThan(validateIndex);
    expect(mergedSteps[buildIndex]?.run).toContain("pnpm desktop:channel");
    expect(mergedSteps[validateIndex]?.run).toContain(
      "--components 'desktop,win-runtime,wsl-engine,wsl-runtime'"
    );

    const release = loadWorkflow("desktop-release.yml");
    const releaseInputs = (release.on.workflow_dispatch as { inputs: Record<string, unknown> })
      .inputs;
    expect(releaseInputs).not.toHaveProperty("mode");
    expect(releaseInputs.windows_signing).toMatchObject({
      default: true,
      required: true,
      type: "boolean",
    });
    expect(release.jobs.prepare.outputs).toMatchObject({
      published_at: "${{ steps.release.outputs.published_at }}",
      release_kind: "${{ steps.release.outputs.release_kind }}",
      has_previous_desktop: "${{ steps.release.outputs.has_previous_desktop }}",
      runtime_min_shell_version: "${{ steps.release.outputs.runtime_min_shell_version }}",
      installed_targets: "${{ steps.release.outputs.installed_targets }}",
    });
    const resolveRelease = (release.jobs.prepare.steps ?? []).find(
      (step) => step.name === "Resolve versions and release tag"
    );
    expect(resolveRelease?.run).toContain("has_desktop_channel");
    expect(resolveRelease?.run).toContain('--pattern "${channel_asset}"');
    expect(resolveRelease?.run).toContain("desktop-channel-modern.json");
    expect(resolveRelease?.run).toContain('runtime_min_shell_version="${desktop_version}"');
    expect(resolveRelease?.run).toContain('runtime_min_shell_version="${previous_shell_version}"');
    expect(resolveRelease?.run).toContain(
      "require('./release/desktop-release-boundary/desktop-channel.json')"
    );
    expect(resolveRelease?.run).toContain("shell_change=$(node -e");
    expect(resolveRelease?.run).toContain('if [[ "${shell_change}" == "same" ]]');
    expect(resolveRelease?.run).toContain('elif [[ "${shell_change}" == "downgrade" ]]');
    expect(resolveRelease?.run).toContain("elif ! grep -q '(HTTP 404)'");
    expect(resolveRelease?.run).toContain('release_kind="runtime-only"');
    expect(resolveRelease?.run).toContain('release_kind="migration"');
    expect(resolveRelease?.run).toContain(
      'installed_targets=["native","wsl","fresh-native","fresh-wsl"]'
    );
    expect(resolveRelease?.run).toContain('echo "release_kind=${release_kind}"');
    const linuxBuild = release.jobs["linux-assets"];
    const windowsBuild = release.jobs["windows-assets"];
    const releaseTypecheck = (windowsBuild.steps ?? []).find(
      (step) => step.name === "Test Desktop and type-check repository"
    );
    expect(linuxBuild.env?.CODER_STUDIO_RELEASE_PUBLISHED_AT).toBe(
      "${{ needs.prepare.outputs.published_at }}"
    );
    expect(windowsBuild.env?.CODER_STUDIO_RELEASE_PUBLISHED_AT).toBe(
      "${{ needs.prepare.outputs.published_at }}"
    );
    expect(linuxBuild.env?.CODER_STUDIO_RUNTIME_MIN_SHELL_VERSION).toBe(
      "${{ needs.prepare.outputs.runtime_min_shell_version }}"
    );
    expect(windowsBuild.env?.CODER_STUDIO_RUNTIME_MIN_SHELL_VERSION).toBe(
      "${{ needs.prepare.outputs.runtime_min_shell_version }}"
    );
    expect(windowsBuild.env?.CODER_STUDIO_FACTORY_RELEASE_BASE_URL).toBe(
      "https://github.com/${{ github.repository }}/releases/download/${{ needs.prepare.outputs.tag }}/"
    );
    expect(windowsBuild.env?.CSC_IDENTITY_AUTO_DISCOVERY).toBe(
      "${{ inputs.windows_signing && 'true' || 'false' }}"
    );
    expect(JSON.stringify(linuxBuild)).toContain("needs.prepare.outputs.release_kind");
    expect(JSON.stringify(windowsBuild)).toContain("needs.prepare.outputs.release_kind");
    expect(linuxBuild.env?.CODER_STUDIO_FACTORY_RELEASE_BASE_URL).toBeUndefined();
    expect(releaseTypecheck?.run).toContain("pnpm ci:typecheck");
    const publishSteps = release.jobs.publish.steps ?? [];
    const previousIndex = publishSteps.findIndex(
      (step) => step.name === "Download previous immutable release"
    );
    const prepareBasesIndex = publishSteps.findIndex(
      (step) => step.name === "Prepare legacy and modern Shell bases"
    );
    const channelIndex = publishSteps.findIndex(
      (step) => step.name === "Build signed Desktop channel"
    );
    const previousShellBlockmapIndex = publishSteps.findIndex(
      (step) => step.name === "Carry forward previous Shell blockmap for legacy updater fallback"
    );
    const forceFullDownloadIndex = publishSteps.findIndex(
      (step) => step.name === "Force full Shell installer download"
    );
    const productionValidateIndex = publishSteps.findIndex(
      (step) => step.name === "Validate complete production release"
    );
    const attestIndex = publishSteps.findIndex((step) => step.name === "Attest release artifacts");
    const releaseIndex = publishSteps.findIndex(
      (step) => step.name === "Publish immutable prerelease"
    );
    expect(previousIndex).toBeGreaterThan(-1);
    expect(prepareBasesIndex).toBeGreaterThan(previousIndex);
    expect(previousShellBlockmapIndex).toBe(-1);
    expect(forceFullDownloadIndex).toBe(-1);
    expect(channelIndex).toBeGreaterThan(prepareBasesIndex);
    expect(productionValidateIndex).toBeGreaterThan(channelIndex);
    expect(attestIndex).toBeGreaterThan(productionValidateIndex);
    expect(releaseIndex).toBeGreaterThan(attestIndex);
    expect(publishSteps[prepareBasesIndex]?.run).toContain("--carry-forward-modern-from");
    expect(publishSteps[prepareBasesIndex]?.run).toContain("--prepare-modern-base");
    expect(publishSteps[prepareBasesIndex]?.run).toContain("--carry-forward-from");
    expect(publishSteps[prepareBasesIndex]?.run).toContain("--carry-forward-legacy-from");
    expect(publishSteps[channelIndex]?.run).toContain("--output desktop-channel-modern.json");
    expect(publishSteps[channelIndex]?.run).toContain(
      "coder-studio-runtime-modern-win32-x64.manifest.json"
    );
    expect(publishSteps[productionValidateIndex]?.run).toContain("--release-kind");
    expect(publishSteps[productionValidateIndex]?.run).toContain("--previous-release-directory");
    expect(publishSteps[releaseIndex]?.run).toContain("--prerelease --latest=false");
    expect(publishSteps[releaseIndex]?.run).toContain("Install Coder-Studio-Setup-");
    expect(publishSteps[releaseIndex]?.run).toContain("not Authenticode-signed");
    expect(JSON.stringify(release.jobs.publish)).not.toContain("desktop:force-full-download");
  });

  it("gates Desktop and CLI promotion on immutable installed-upgrade reports", () => {
    const acceptance = loadWorkflow("desktop-acceptance.yml");
    const installed = acceptance.jobs["installed-upgrades"];
    const installedSteps = installed.steps ?? [];
    const runInstalled = installedSteps.find(
      (step) => step.name === "Run installed Desktop update scenario"
    );
    const downloadPrevious = installedSteps.find(
      (step) => step.name === "Download previous stable Desktop release"
    );
    const prepareScenario = installedSteps.find(
      (step) => step.name === "Prepare scenario-specific signed channel"
    );
    const prepareWsl = installedSteps.find(
      (step) => step.name === "Prepare disposable WSL distribution"
    );
    expect(installed.needs).toEqual(["prepare", "publish"]);
    expect(installed.environment).toBe("desktop-production");
    expect(installed.strategy?.matrix?.scenario).toBe(
      "${{ fromJSON(needs.prepare.outputs.acceptance_scenarios) }}"
    );
    expect(runInstalled?.run).toContain("pnpm acceptance:desktop:installed");
    expect(runInstalled?.run).not.toContain("pnpm acceptance:desktop:installed --");
    expect(runInstalled?.run).toContain("-CandidateInstaller");
    expect(runInstalled?.run).toContain("-PublicKeyPath");
    expect(downloadPrevious?.run).toContain("'modern.yml'");
    expect(downloadPrevious?.run).toContain("'build-info-modern.json'");
    expect(downloadPrevious?.run).toContain("'desktop-channel-modern.json'");
    expect(runInstalled?.run).toContain("if ('${{ steps.scenario.outputs.components }}')");
    expect(runInstalled?.run).toContain("-SkipAuthenticode");
    expect(prepareScenario?.run).toContain("'runtime:win32-x64'");
    expect(prepareScenario?.run).toContain("'wsl-combined'");
    expect(prepareScenario?.run).toContain("$useModernChannel");
    expect(prepareScenario?.run).toContain("$isFrozenLegacy");
    expect(prepareScenario?.run).toContain("runtime-previous-public.pem");
    expect(prepareScenario?.run).toContain("'desktop-channel-modern.json'");
    expect(prepareScenario?.run).toContain("$releaseKind -eq 'full'");
    expect(prepareScenario?.run).toContain("yyyy-MM-ddTHH:mm:ss.fffZ");
    expect(prepareScenario?.run).toContain("InvariantCulture");
    expect(prepareScenario?.run).toContain("'desktop:artifacts', 'validate'");
    expect(prepareScenario?.run).not.toContain("'desktop:artifacts', '--', 'validate'");
    expect(prepareScenario?.run).toContain("scripts/serve-static-http.mjs");
    expect(prepareScenario?.run).toContain("Invoke-WebRequest -UseBasicParsing -Method Head");
    expect(prepareScenario?.run).toContain("desktop-installed-http.stderr.log");
    expect(runInstalled?.run).toContain(
      "@('fresh-wsl', 'legacy-wsl-current', 'wsl', 'wsl-combined')"
    );
    expect(prepareWsl?.run).toContain("systemd=false");
    expect(prepareWsl?.run).toContain("useradd --create-home --shell /bin/bash coderstudio");
    expect(prepareWsl?.run).toContain("default=coderstudio");
    expect(prepareWsl?.run).toContain("wsl.exe --terminate $distro");
    expect(installedSteps.some((step) => step.name === "Upload installed-upgrade report")).toBe(
      true
    );

    const release = loadWorkflow("desktop-release.yml");
    const releaseInstalled = release.jobs["installed-upgrade"];
    const promotion = release.jobs.promote;
    expect(releaseInstalled.needs).toEqual(["prepare", "publish"]);
    expect(releaseInstalled.strategy?.matrix?.target).toBe(
      "${{ fromJSON(needs.prepare.outputs.installed_targets) }}"
    );
    const releaseRunInstalled = (releaseInstalled.steps ?? []).find(
      (step) => step.name === "Run production installed Desktop update"
    );
    const releasePrepareWsl = (releaseInstalled.steps ?? []).find(
      (step) => step.name === "Prepare disposable production WSL distribution"
    );
    expect(releaseRunInstalled?.run).not.toContain("pnpm acceptance:desktop:installed --");
    expect(releaseRunInstalled?.run).toContain("if ('${{ steps.identity.outputs.components }}')");
    expect(releaseRunInstalled?.run).toContain("-SkipAuthenticode");
    expect(releasePrepareWsl?.run).toContain("systemd=false");
    expect(releasePrepareWsl?.run).toContain("useradd --create-home --shell /bin/bash coderstudio");
    expect(releasePrepareWsl?.run).toContain("default=coderstudio");
    expect(releasePrepareWsl?.run).toContain("wsl.exe --terminate $distro");
    expect(promotion.needs).toEqual(["prepare", "publish", "installed-upgrade"]);
    const promotionSteps = promotion.steps ?? [];
    const validateReports = promotionSteps.find(
      (step) => step.name === "Validate promotion report identities"
    );
    const downloadChannel = promotionSteps.find(
      (step) => step.name === "Download immutable channel identity"
    );
    const promote = promotionSteps.find((step) => step.name === "Promote existing prerelease");
    expect(downloadChannel?.run).toContain('--repo "${GITHUB_REPOSITORY}"');
    expect(downloadChannel?.run).toContain("--pattern 'desktop-channel*.json'");
    expect(validateReports?.run).toContain("channelSignatureDigest");
    expect(validateReports?.run).toContain("modernChannelSignatureDigest");
    expect(validateReports?.run).toContain('report.scenario.startsWith("fresh-")');
    expect(validateReports?.run).toContain(
      'const expectedProductionCount = releaseKind === "migration" ? 4 : 2'
    );
    expect(validateReports?.run).toContain("text.charCodeAt(0) === 0xfeff");
    expect(validateReports?.run).toContain("commitSha");
    expect(validateReports?.run).toContain("wslRuntimeVersion");
    expect(validateReports?.run).toContain("wsl-combined");
    expect(validateReports?.run).toContain("legacy-wsl-current");
    expect(validateReports?.run).toContain("report.releaseKind !== releaseKind");
    expect(validateReports?.run).toContain(
      '["runtime-only", "wsl", "runtime-health-rollback", "interrupted-download", "restart-journal-recovery", "external-sidecar-browser"]'
    );
    expect(promote?.run?.trim()).toBe(
      'gh release edit "${{ needs.prepare.outputs.tag }}" --repo "${GITHUB_REPOSITORY}" --prerelease=false --latest'
    );
    const promotionText = JSON.stringify(promotion);
    expect(promotionText).not.toMatch(/pnpm (build|dist)|gh release upload|--clobber/);

    const cli = loadWorkflow("publish.yml");
    const cliInputs = (cli.on.workflow_dispatch as { inputs: Record<string, unknown> }).inputs;
    expect(cliInputs.promote).toMatchObject({ default: true, type: "boolean" });
    const steps = cli.jobs.publish.steps ?? [];
    const readVersion = steps.find((step) => step.name === "Read CLI version");
    const packIndex = steps.findIndex((step) => step.name === "Pack CLI candidate once");
    const validatePackageIndex = steps.findIndex(
      (step) => step.name === "Validate packed CLI assets"
    );
    const stageIndex = steps.findIndex(
      (step) => step.name === "Publish or reuse immutable CLI candidate"
    );
    const acceptanceIndex = steps.findIndex(
      (step) => step.name === "Run isolated packaged CLI acceptance"
    );
    const candidateCleanupIndex = steps.findIndex(
      (step) => step.name === "Remove candidate-only npm dist-tag"
    );
    const desktopReportIndex = steps.findIndex(
      (step) => step.name === "Validate required Desktop acceptance report"
    );
    const promoteIndex = steps.findIndex((step) => step.name === "Promote accepted CLI dist-tag");
    const preserveDesktopIndex = steps.findIndex(
      (step) => step.name === "Preserve Desktop update channel assets"
    );
    const tagIndex = steps.findIndex((step) => step.name === "Create and push release tag");
    const githubReleaseIndex = steps.findIndex((step) => step.name === "Create GitHub release");
    const preserveDesktop = steps[preserveDesktopIndex];
    expect(packIndex).toBeGreaterThan(-1);
    expect(readVersion?.run).toContain(
      'acceptance_tag="rc-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"'
    );
    expect(validatePackageIndex).toBeGreaterThan(packIndex);
    expect(stageIndex).toBeGreaterThan(validatePackageIndex);
    expect(acceptanceIndex).toBeGreaterThan(stageIndex);
    expect(candidateCleanupIndex).toBeGreaterThan(acceptanceIndex);
    expect(desktopReportIndex).toBeGreaterThan(acceptanceIndex);
    expect(preserveDesktopIndex).toBeGreaterThan(desktopReportIndex);
    expect(promoteIndex).toBeGreaterThan(preserveDesktopIndex);
    expect(tagIndex).toBeGreaterThan(preserveDesktopIndex);
    expect(githubReleaseIndex).toBeGreaterThan(tagIndex);
    expect(promoteIndex).toBeGreaterThan(desktopReportIndex);
    expect(steps[packIndex]?.run).toContain("pnpm --dir ./packages/cli pack --json");
    expect(steps[packIndex]?.run).not.toMatch(/(^|\s)npm pack/);
    expect(steps[validatePackageIndex]?.run).toContain("pnpm validate:cli-package");
    expect(steps[validatePackageIndex]?.run).toContain('--tarball "${TARBALL}"');
    expect(steps[validatePackageIndex]?.run).toContain(
      "--source-package-json packages/cli/package.json"
    );
    expect(steps[stageIndex]?.run).toContain("dist.integrity");
    expect(steps[stageIndex]?.run).toContain('pnpm publish "${tarball}"');
    expect(steps[stageIndex]?.run).toContain('npm pack "${PACKAGE_NAME}@${CANDIDATE_VERSION}"');
    expect(steps[stageIndex]?.run).toContain('--compare-tarball "${registry_tarball}"');
    expect(steps[stageIndex]?.run).toContain("npm dist-tag add");
    expect(steps[stageIndex]?.run).not.toMatch(/(^|\s)npm publish "\$\{tarball\}"/);
    expect(steps[acceptanceIndex]?.run).toContain("pnpm acceptance:cli:update");
    expect(steps[candidateCleanupIndex]?.if).toBe("inputs.promote == false");
    expect(steps[candidateCleanupIndex]?.run).toContain("if ! npm dist-tag rm");
    expect(steps[candidateCleanupIndex]?.run).toContain("::warning");
    expect(steps[desktopReportIndex]?.run).toContain("wsl-combined");
    expect(steps[desktopReportIndex]?.run).toContain("fresh-native");
    expect(steps[desktopReportIndex]?.run).toContain("fresh-wsl");
    expect(steps[desktopReportIndex]?.run).toContain("legacy-current");
    expect(steps[desktopReportIndex]?.run).toContain("legacy-wsl-current");
    expect(steps[desktopReportIndex]?.run).toContain("releaseKinds");
    expect(steps[desktopReportIndex]?.run).toContain('releaseKind === "full"');
    expect(steps[desktopReportIndex]?.run).toContain('releaseKind !== "migration"');
    expect(steps[desktopReportIndex]?.run).toContain(
      '["runtime-only", "wsl", "runtime-health-rollback", "interrupted-download", "restart-journal-recovery", "external-sidecar-browser"]'
    );
    expect(steps[desktopReportIndex]?.run).toContain("reports.length === 2");
    expect(steps[desktopReportIndex]?.run).toContain(
      'report.scenario !== "runtime-health-rollback"'
    );
    expect(steps[desktopReportIndex]?.run).toContain("report.rollbackRuntimeVersion");
    expect(steps[desktopReportIndex]?.run).toContain("text.charCodeAt(0) === 0xfeff");
    expect(steps[preserveDesktopIndex]?.if).toBe("inputs.promote");
    expect(steps[promoteIndex]?.run).toContain("npm dist-tag add");
    expect(steps[promoteIndex]?.run).toContain("if ! npm dist-tag rm");
    expect(steps[promoteIndex]?.run).toContain("::warning");
    expect(steps[promoteIndex]?.run?.indexOf("npm dist-tag add")).toBeLessThan(
      steps[promoteIndex]?.run?.indexOf("if ! npm dist-tag rm") ?? -1
    );
    expect(preserveDesktop?.run).toContain(
      'gh release download "${latest_tag}" --dir desktop-channel-assets --clobber'
    );
    expect(preserveDesktop?.run).not.toContain("--pattern");
    expect(preserveDesktop?.run).not.toContain("|| true");
    expect(preserveDesktop?.run).toContain('test -n "${latest_tag}"');
    expect(JSON.stringify(cli)).not.toContain("pnpm publish:cli -- --publish");
  });
});
