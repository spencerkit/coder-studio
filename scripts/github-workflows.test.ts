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
    const validation = publishSteps.find(
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
      },
      secrets: {
        windows_csc_link: "${{ secrets.DESKTOP_WINDOWS_CSC_LINK }}",
        windows_csc_key_password: "${{ secrets.DESKTOP_WINDOWS_CSC_KEY_PASSWORD }}",
      },
    });
    expect(publish.needs).toEqual(["prepare", "repository-verify", "build-assets"]);
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
    });
    const resolveRelease = (release.jobs.prepare.steps ?? []).find(
      (step) => step.name === "Resolve versions and release tag"
    );
    expect(resolveRelease?.run).toContain("has_desktop_channel");
    expect(resolveRelease?.run).toContain("--pattern desktop-channel.json");
    expect(resolveRelease?.run).toContain("shell_change=$(node -e");
    expect(resolveRelease?.run).toContain('if [[ "${shell_change}" == "same" ]]');
    expect(resolveRelease?.run).toContain('elif [[ "${shell_change}" == "downgrade" ]]');
    expect(resolveRelease?.run).toContain("elif ! grep -q '(HTTP 404)'");
    expect(resolveRelease?.run).toContain('release_kind="runtime-only"');
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
    const carryIndex = publishSteps.findIndex(
      (step) => step.name === "Carry forward immutable Shell and Engine"
    );
    const channelIndex = publishSteps.findIndex(
      (step) => step.name === "Build signed Desktop channel"
    );
    const productionValidateIndex = publishSteps.findIndex(
      (step) => step.name === "Validate complete production release"
    );
    const attestIndex = publishSteps.findIndex((step) => step.name === "Attest release artifacts");
    const releaseIndex = publishSteps.findIndex(
      (step) => step.name === "Publish immutable prerelease"
    );
    expect(previousIndex).toBeGreaterThan(-1);
    expect(carryIndex).toBeGreaterThan(previousIndex);
    expect(channelIndex).toBeGreaterThan(carryIndex);
    expect(productionValidateIndex).toBeGreaterThan(channelIndex);
    expect(attestIndex).toBeGreaterThan(productionValidateIndex);
    expect(releaseIndex).toBeGreaterThan(attestIndex);
    expect(publishSteps[productionValidateIndex]?.run).toContain("--release-kind");
    expect(publishSteps[releaseIndex]?.run).toContain("--prerelease --latest=false");
    expect(publishSteps[releaseIndex]?.run).toContain("not Authenticode-signed");
  });

  it("gates Desktop and CLI promotion on immutable installed-upgrade reports", () => {
    const acceptance = loadWorkflow("desktop-acceptance.yml");
    const installed = acceptance.jobs["installed-upgrades"];
    const installedSteps = installed.steps ?? [];
    const runInstalled = installedSteps.find(
      (step) => step.name === "Run installed Desktop update scenario"
    );
    const prepareScenario = installedSteps.find(
      (step) => step.name === "Prepare scenario-specific signed channel"
    );
    expect(installed.needs).toEqual(["prepare", "publish"]);
    expect(installed.strategy?.matrix?.scenario).toBe(
      "${{ fromJSON(needs.prepare.outputs.acceptance_scenarios) }}"
    );
    expect(runInstalled?.run).toContain("pnpm acceptance:desktop:installed");
    expect(runInstalled?.run).toContain("-CandidateInstaller");
    expect(runInstalled?.run).toContain("-PublicKeyPath");
    expect(runInstalled?.run).toContain("-SkipAuthenticode");
    expect(prepareScenario?.run).toContain("'runtime:win32-x64'");
    expect(prepareScenario?.run).toContain("'wsl-combined'");
    expect(runInstalled?.run).toContain("@('fresh-wsl', 'wsl', 'wsl-combined')");
    expect(installedSteps.some((step) => step.name === "Upload installed-upgrade report")).toBe(
      true
    );

    const release = loadWorkflow("desktop-release.yml");
    const releaseInstalled = release.jobs["installed-upgrade"];
    const promotion = release.jobs.promote;
    expect(releaseInstalled.needs).toEqual(["prepare", "publish"]);
    const releaseRunInstalled = (releaseInstalled.steps ?? []).find(
      (step) => step.name === "Run production installed Desktop update"
    );
    expect(releaseRunInstalled?.run).toContain("-SkipAuthenticode");
    expect(promotion.needs).toEqual(["prepare", "publish", "installed-upgrade"]);
    const promotionSteps = promotion.steps ?? [];
    const validateReports = promotionSteps.find(
      (step) => step.name === "Validate promotion report identities"
    );
    const promote = promotionSteps.find((step) => step.name === "Promote existing prerelease");
    expect(validateReports?.run).toContain("channelSignatureDigest");
    expect(validateReports?.run).toContain("commitSha");
    expect(validateReports?.run).toContain("wslRuntimeVersion");
    expect(validateReports?.run).toContain("wsl-combined");
    expect(promote?.run?.trim()).toBe(
      'gh release edit "${{ needs.prepare.outputs.tag }}" --prerelease=false --latest'
    );
    const promotionText = JSON.stringify(promotion);
    expect(promotionText).not.toMatch(/pnpm (build|dist)|gh release upload|--clobber/);

    const cli = loadWorkflow("publish.yml");
    const cliInputs = (cli.on.workflow_dispatch as { inputs: Record<string, unknown> }).inputs;
    expect(cliInputs.promote).toMatchObject({ default: true, type: "boolean" });
    const steps = cli.jobs.publish.steps ?? [];
    const packIndex = steps.findIndex((step) => step.name === "Pack CLI candidate once");
    const stageIndex = steps.findIndex(
      (step) => step.name === "Publish or reuse immutable CLI candidate"
    );
    const acceptanceIndex = steps.findIndex(
      (step) => step.name === "Run isolated packaged CLI acceptance"
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
    expect(stageIndex).toBeGreaterThan(packIndex);
    expect(acceptanceIndex).toBeGreaterThan(stageIndex);
    expect(desktopReportIndex).toBeGreaterThan(acceptanceIndex);
    expect(preserveDesktopIndex).toBeGreaterThan(desktopReportIndex);
    expect(promoteIndex).toBeGreaterThan(preserveDesktopIndex);
    expect(tagIndex).toBeGreaterThan(preserveDesktopIndex);
    expect(githubReleaseIndex).toBeGreaterThan(tagIndex);
    expect(promoteIndex).toBeGreaterThan(desktopReportIndex);
    expect(steps[stageIndex]?.run).toContain("dist.integrity");
    expect(steps[stageIndex]?.run).toContain('npm publish "${tarball}"');
    expect(steps[acceptanceIndex]?.run).toContain("pnpm acceptance:cli:update");
    expect(steps[desktopReportIndex]?.run).toContain("wsl-combined");
    expect(steps[desktopReportIndex]?.run).toContain("fresh-native");
    expect(steps[desktopReportIndex]?.run).toContain("fresh-wsl");
    expect(steps[preserveDesktopIndex]?.if).toBe("inputs.promote");
    expect(steps[promoteIndex]?.run).toContain("npm dist-tag add");
    expect(steps[promoteIndex]?.run).toContain("npm dist-tag rm");
    expect(preserveDesktop?.run).toContain(
      'gh release download "${latest_tag}" --dir desktop-channel-assets --clobber'
    );
    expect(preserveDesktop?.run).not.toContain("--pattern");
    expect(preserveDesktop?.run).not.toContain("|| true");
    expect(preserveDesktop?.run).toContain('test -n "${latest_tag}"');
    expect(JSON.stringify(cli)).not.toContain("pnpm publish:cli -- --publish");
  });
});
