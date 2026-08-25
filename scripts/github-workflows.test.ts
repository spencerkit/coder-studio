import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface WorkflowStep {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  uses?: string;
  needs?: string | string[];
  if?: string;
  environment?: string;
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  with?: Record<string, unknown>;
  strategy?: { matrix?: Record<string, unknown> };
  concurrency?: { group: string; "cancel-in-progress": boolean };
  secrets?: Record<string, string> | "inherit";
  steps?: WorkflowStep[];
}

interface Workflow {
  name?: string;
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, WorkflowJob>;
}

const workflowsRoot = resolve(import.meta.dirname, "../.github/workflows");

function workflowPath(name: string): string {
  return resolve(workflowsRoot, name);
}

function loadWorkflow(name: string): Workflow {
  return parse(readFileSync(workflowPath(name), "utf8")) as Workflow;
}

function jobText(job: WorkflowJob): string {
  return JSON.stringify(job);
}

function step(job: WorkflowJob, name: string): WorkflowStep | undefined {
  return (job.steps ?? []).find((candidate) => candidate.name === name);
}

describe("repository verification workflows", () => {
  it("keeps repository CI fast and reusable", () => {
    const workflow = loadWorkflow("ci.yml");
    expect(workflow.on).toEqual({
      workflow_call: null,
      pull_request: null,
      push: { branches: ["main"] },
    });
    expect(Object.keys(workflow.jobs).sort()).toEqual(["verify", "windows-runtime-verify"].sort());
    expect(step(workflow.jobs.verify, "Run type checks")?.run).toBe("pnpm ci:typecheck");
  });

  it("uses split Product and Desktop artifact commands in Desktop verification", () => {
    const workflow = loadWorkflow("desktop-verify.yml");
    const source = readFileSync(workflowPath("desktop-verify.yml"), "utf8");
    const pullRequest = workflow.on.pull_request as { paths: string[] };

    expect(pullRequest.paths).toContain("packages/desktop/**");
    expect(pullRequest.paths).toContain("packages/cli/**");
    expect(source).toContain("pnpm release:artifacts stage-product");
    expect(source).toContain("--components win-runtime");
    expect(source).toContain("--components wsl-runtime");
    expect(source).toContain("pnpm release:artifacts stage-desktop");
    expect(source).toContain("--components windows");
    expect(source).toContain("--components wsl-engine");
    expect(source).toContain("pnpm release:artifacts validate-product");
    expect(source).toContain("pnpm release:artifacts validate-desktop");
    expect(source).not.toContain("desktop:artifacts");
    expect(source).not.toContain("--release-kind");
    expect(source).not.toContain("--previous-release-directory");
  });
});

describe("Product publication workflow", () => {
  it("triggers only for Product version releases and supports idempotent recovery", () => {
    const workflow = loadWorkflow("product-release.yml");
    const push = workflow.on.push as { branches: string[]; paths: string[] };
    const dispatch = workflow.on.workflow_dispatch as {
      inputs: Record<string, Record<string, unknown>>;
    };

    expect(push).toEqual({
      branches: ["main"],
      paths: ["packages/cli/package.json"],
    });
    expect(dispatch.inputs).toEqual({
      candidate_tag: {
        description: "Existing immutable Product candidate tag to resume",
        required: false,
        default: "",
        type: "string",
      },
      final_dist_tag: {
        description: "Final npm dist-tag advanced after acceptance",
        required: true,
        default: "latest",
        type: "string",
      },
      windows_signing: {
        description: "Require stable Desktop Authenticode signing for workflow_dispatch runs",
        required: false,
        default: true,
        type: "boolean",
      },
    });
    expect(workflow.concurrency).toEqual({
      group: "product-production",
      "cancel-in-progress": false,
    });
    expect(step(workflow.jobs.prepare, "Resolve immutable Product identity")?.run).toContain(
      'if [[ -n "${REQUESTED_CANDIDATE_TAG}" ]]'
    );
    expect(JSON.stringify(workflow.on)).not.toContain("run_id");
    expect(existsSync(workflowPath("publish.yml"))).toBe(false);
  });

  it("builds one immutable Product candidate and gates automatic promotion on every acceptance", () => {
    const workflow = loadWorkflow("product-release.yml");
    const jobs = workflow.jobs;
    expect(Object.keys(jobs)).toEqual([
      "prepare",
      "windows-runtime",
      "wsl-runtime",
      "publish-candidate",
      "accept-cli",
      "accept-runtime",
      "compatibility",
      "promote",
    ]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(jobs["windows-runtime"].needs).toBe("prepare");
    expect(jobs["wsl-runtime"].needs).toBe("prepare");
    expect(jobs["publish-candidate"].needs).toEqual(["prepare", "windows-runtime", "wsl-runtime"]);
    expect(jobs["accept-cli"].needs).toEqual(["prepare", "publish-candidate"]);
    expect(jobs["accept-runtime"].needs).toEqual(["prepare", "publish-candidate"]);
    expect(jobs.compatibility.needs).toEqual(["prepare", "publish-candidate"]);
    expect(jobs.promote.needs).toEqual([
      "prepare",
      "publish-candidate",
      "accept-cli",
      "accept-runtime",
      "compatibility",
    ]);
    expect(jobs.promote.if).toBe("success()");
    expect(jobs.promote.environment).toBeUndefined();

    const publish = jobs["publish-candidate"];
    const publishText = jobText(publish);
    expect(publish.permissions).toEqual({ contents: "write", "id-token": "write" });
    expect(publishText).toContain("pnpm --dir ./packages/cli pack --json");
    expect(publishText).toContain("pnpm validate:cli-package");
    expect(publishText).toContain("pnpm release:channel product");
    expect(publishText).toContain("pnpm release:artifacts validate-product");
    expect(publishText).toContain("pnpm publish");
    expect(publishText).toContain("ACCEPTANCE_DIST_TAG");
    expect(publishText).toContain("gh release create");
    expect(publishText).toContain("--prerelease --latest=false");
    expect(publishText).toContain("--compare-tarball");
    expect(step(publish, "Record accepted candidate identity")?.run).toContain(
      "release-workflow-helpers.ts write-candidate-outputs"
    );
    expect(publish.outputs?.candidate_commit).toBeDefined();
    expect(publishText).not.toContain("desktop-channel.json");
    expect(publishText).not.toContain("Coder-Studio-Setup");
    expect(publishText).not.toContain("desktop-release");
    expect(step(publish, "Upload runtime public key for compatibility acceptance")?.with).toEqual({
      name: "product-compatibility-runtime-public-key-${{ github.run_id }}",
      path: "release/compatibility-key/runtime-public.pem",
      "if-no-files-found": "error",
      "retention-days": 1,
    });

    expect(jobText(jobs["accept-cli"])).toContain("pnpm acceptance:cli:update");
    expect(jobText(jobs["accept-runtime"])).toContain("pnpm acceptance:desktop:installed");
    expect(jobText(jobs["accept-runtime"])).toContain("sha256sum");
    expect(jobText(jobs["accept-runtime"])).toContain("desktop-channel-modern.json");
    expect(jobText(jobs["accept-runtime"])).toContain("modern.yml");
    expect(jobText(jobs["accept-runtime"])).toContain("shell.updaterMetadata");
    expect(jobs["accept-runtime"].strategy?.matrix?.scenario).toEqual([
      "runtime-only",
      "wsl",
      "runtime-health-rollback",
      "interrupted-download",
      "restart-journal-recovery",
      "external-sidecar-browser",
    ]);
    expect(jobText(jobs["accept-runtime"])).toContain("ProductChannelUrl");
    expect(jobText(jobs["accept-runtime"])).toContain("Prepare disposable WSL distribution");
    expect(jobText(jobs["accept-runtime"])).toContain(
      "if ('${{ steps.identity.outputs.components }}')"
    );
    expect(jobText(jobs["accept-runtime"])).toContain(
      "github.event_name == 'workflow_dispatch' && !inputs.windows_signing"
    );
    expect(jobText(jobs["accept-runtime"])).toContain("-SkipAuthenticode");
    expect(jobText(jobs["accept-runtime"])).not.toContain("ACCEPTANCE_TARGET");
    expect(jobs.compatibility.uses).toBe("./.github/workflows/compatibility-acceptance.yml");
    expect(jobs.compatibility.secrets).toBeUndefined();
    expect(jobs.compatibility.with).toMatchObject({
      product_tag: "${{ needs.publish-candidate.outputs.candidate_tag }}",
      product_channel_sha256: "${{ needs.publish-candidate.outputs.product_channel_sha256 }}",
      windows_manifest_sha256: "${{ needs.publish-candidate.outputs.windows_manifest_sha256 }}",
      linux_manifest_sha256: "${{ needs.publish-candidate.outputs.linux_manifest_sha256 }}",
      desktop_tag: "${{ needs.prepare.outputs.desktop_tag }}",
      desktop_channel_sha256: "${{ needs.prepare.outputs.desktop_channel_sha256 }}",
      runtime_public_key_artifact: "product-compatibility-runtime-public-key-${{ github.run_id }}",
    });
    expect(jobs["windows-runtime"].environment).toBe("desktop-production");
    expect(jobs["wsl-runtime"].environment).toBe("desktop-production");
    expect(jobs["publish-candidate"].environment).toBe("desktop-production");
    expect(jobs["accept-runtime"].environment).toBe("desktop-production");
  });

  it("promotes npm before Product release and pointer, verifies, then cleans the temporary tag", () => {
    const workflow = loadWorkflow("product-release.yml");
    const promote = workflow.jobs.promote;
    const steps = promote.steps ?? [];
    const immutableIndex = steps.findIndex(
      (candidate) => candidate.name === "Verify accepted immutable Product bytes"
    );
    const npmIndex = steps.findIndex(
      (candidate) => candidate.name === "Advance final npm dist-tag"
    );
    const releaseIndex = steps.findIndex(
      (candidate) => candidate.name === "Promote Product versioned release"
    );
    const pointerIndex = steps.findIndex(
      (candidate) => candidate.name === "Advance signed Product stable pointer"
    );
    const verifyIndex = steps.findIndex(
      (candidate) => candidate.name === "Verify promoted Product"
    );
    const cleanupIndex = steps.findIndex(
      (candidate) => candidate.name === "Remove temporary npm dist-tag"
    );
    const recordIndex = steps.findIndex(
      (candidate) => candidate.name === "Record Product promotion"
    );

    expect(immutableIndex).toBeGreaterThan(-1);
    expect(step(promote, "Checkout repository")?.uses).toBe("actions/checkout@v4");
    expect(step(promote, "Setup pnpm")?.uses).toBe("pnpm/action-setup@v4");
    expect(step(promote, "Install dependencies")?.run).toBe("pnpm install --frozen-lockfile");
    expect(npmIndex).toBeGreaterThan(immutableIndex);
    expect(releaseIndex).toBeGreaterThan(npmIndex);
    expect(pointerIndex).toBeGreaterThan(releaseIndex);
    expect(verifyIndex).toBeGreaterThan(pointerIndex);
    expect(cleanupIndex).toBeGreaterThan(verifyIndex);
    expect(recordIndex).toBeGreaterThan(cleanupIndex);
    expect(steps[immutableIndex]?.run).toContain("release-workflow-helpers.ts verify-digests");
    expect(steps[immutableIndex]?.run).toContain("--channel product");
    expect(steps[releaseIndex]?.run).toContain("--prerelease=false --latest=false");
    expect(steps[pointerIndex]?.run).toContain("product-stable");
    expect(steps[pointerIndex]?.run).toContain("product-channel.json");
    expect(steps[verifyIndex]?.run).toContain("for attempt in 1 2 3 4 5 6");
    expect(steps[verifyIndex]?.run).toContain("sleep 10");
    expect(steps[cleanupIndex]?.run).toContain("npm dist-tag rm");
    expect(steps[cleanupIndex]?.run).toContain(
      "::warning::Unable to remove temporary npm dist-tag"
    );
    expect(steps[recordIndex]?.run).toContain("promotion.json");
    expect(steps[recordIndex]?.run).toContain(
      "release-workflow-helpers.ts verify-existing-promotion-record"
    );
    expect(steps[recordIndex]?.run).toContain("release-workflow-helpers.ts write-promotion-record");
    expect(steps[recordIndex]?.run).toContain("Existing Product promotion record");
    expect(promote.concurrency).toEqual({
      group: "product-desktop-stable-promotion",
      "cancel-in-progress": false,
    });
    expect(step(promote, "Revalidate accepted Desktop stable pointer")?.run).toContain(
      "Desktop stable pointer changed after compatibility acceptance"
    );
    expect(step(promote, "Revalidate accepted Desktop stable pointer")?.run).toContain(
      "desktop-stable"
    );
    expect(jobText(promote)).not.toMatch(/pnpm (build|dist)/);
    expect(steps.map((candidate) => candidate.run ?? "").join("\n")).not.toMatch(
      /gh release upload[^\n]*(?:runtime|product-channel\.json)[^\n]*--clobber/
    );
  });
});

describe("reusable compatibility acceptance", () => {
  it("requires explicit immutable Product and Desktop identities", () => {
    const workflow = loadWorkflow("compatibility-acceptance.yml");
    const call = workflow.on.workflow_call as {
      inputs: Record<string, { type: string; required: boolean }>;
      secrets?: Record<string, { required: boolean }>;
    };

    expect(call.inputs).toEqual({
      product_tag: { type: "string", required: true },
      product_bundle_artifact: { type: "string", required: false },
      product_channel_sha256: { type: "string", required: true },
      windows_manifest_sha256: { type: "string", required: true },
      linux_manifest_sha256: { type: "string", required: true },
      desktop_tag: { type: "string", required: true },
      desktop_channel_sha256: { type: "string", required: true },
      runtime_public_key_artifact: { type: "string", required: true },
    });
    expect(call.secrets).toBeUndefined();
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.verify.environment).toBe("desktop-production");
  });

  it("downloads only tag-pinned assets, checks digests, and never builds or publishes", () => {
    const workflow = loadWorkflow("compatibility-acceptance.yml");
    const verify = workflow.jobs.verify;
    const text = jobText(verify);
    const downloadProduct = step(verify, "Download immutable Product metadata")?.run;
    const downloadDesktop = step(verify, "Download immutable Desktop metadata")?.run;

    expect(Object.keys(workflow.jobs)).toEqual(["verify"]);
    expect(verify.strategy?.matrix?.target).toEqual(["native", "wsl"]);
    expect(downloadProduct).toContain('gh release download "${PRODUCT_TAG}"');
    expect(downloadDesktop).toContain('gh release download "${DESKTOP_TAG}"');
    expect(downloadDesktop).toContain("desktop-channel-modern.json");
    expect(text).toContain("download-artifact@v4");
    expect(text).toContain("inputs.product_bundle_artifact");
    expect(text).toContain("runtime_public_key_artifact");
    expect(text).toContain("PRODUCT_CHANNEL_SHA256");
    expect(text).toContain("WINDOWS_MANIFEST_SHA256");
    expect(text).toContain("LINUX_MANIFEST_SHA256");
    expect(text).toContain("DESKTOP_CHANNEL_SHA256");
    expect(text).toContain("sha256sum");
    expect(text).toContain("compatibility-report");
    expect(text).toContain("CODER_STUDIO_RUNTIME_PUBLIC_KEY");
    expect(text).toContain("scripts/verify-release-compatibility.ts");
    expect(text).not.toContain("releases/latest");
    expect(text).not.toContain("product-stable");
    expect(text).not.toContain("desktop-stable");
    expect(text).not.toMatch(/pnpm (build|dist|publish)|gh release (create|edit|upload)/);

    const verifierPath = resolve(import.meta.dirname, "verify-release-compatibility.ts");
    const verifier = existsSync(verifierPath) ? readFileSync(verifierPath, "utf8") : "";
    expect(existsSync(verifierPath)).toBe(true);
    expect(verifier).toContain("parseProductChannel");
    expect(verifier).toContain("parseCompatibilityDesktopChannel");
    expect(verifier).toContain("manifestSha256");
  });
});

describe("Desktop publication workflow", () => {
  it("triggers only for Desktop version releases and supports immutable recovery", () => {
    const workflow = loadWorkflow("desktop-release.yml");
    const push = workflow.on.push as { branches: string[]; paths: string[] };
    const dispatch = workflow.on.workflow_dispatch as {
      inputs: Record<string, Record<string, unknown>>;
    };

    expect(push).toEqual({
      branches: ["main"],
      paths: ["packages/desktop/package.json"],
    });
    expect(dispatch.inputs).toEqual({
      candidate_tag: {
        description: "Existing immutable Desktop candidate tag to resume",
        required: false,
        default: "",
        type: "string",
      },
      windows_signing: {
        description: "Require Windows Authenticode signing for workflow_dispatch runs",
        required: false,
        default: true,
        type: "boolean",
      },
    });
    expect(workflow.concurrency).toEqual({
      group: "desktop-production",
      "cancel-in-progress": false,
    });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(JSON.stringify(workflow.on)).not.toContain("run_id");
  });

  it("builds one Shell and Engine candidate from the accepted stable Factory Product", () => {
    const workflow = loadWorkflow("desktop-release.yml");
    const jobs = workflow.jobs;
    expect(Object.keys(jobs)).toEqual([
      "prepare",
      "resolve-factory-product",
      "windows-assets",
      "wsl-engine",
      "publish-candidate",
      "accept-installation",
      "accept-factory",
      "compatibility",
      "promote",
    ]);
    expect(jobs["resolve-factory-product"].needs).toBe("prepare");
    expect(jobs["windows-assets"].needs).toEqual(["prepare", "resolve-factory-product"]);
    expect(jobs["wsl-engine"].needs).toBe("prepare");
    expect(jobs["publish-candidate"].needs).toEqual([
      "prepare",
      "resolve-factory-product",
      "windows-assets",
      "wsl-engine",
    ]);
    expect(jobs["accept-installation"].needs).toEqual(["prepare", "publish-candidate"]);
    expect(jobs["accept-factory"].needs).toEqual([
      "prepare",
      "resolve-factory-product",
      "publish-candidate",
    ]);
    expect(jobs.compatibility.needs).toEqual([
      "prepare",
      "resolve-factory-product",
      "publish-candidate",
    ]);
    expect(jobs.promote.needs).toEqual([
      "prepare",
      "resolve-factory-product",
      "publish-candidate",
      "accept-installation",
      "accept-factory",
      "compatibility",
    ]);
    expect(jobs.promote.if).toBe("success()");

    const factoryText = jobText(jobs["resolve-factory-product"]);
    expect(factoryText).toContain("gh release download product-stable");
    expect(factoryText).toContain("prepare-product-release-bundle.ts");
    expect(factoryText).toContain("product-channel.json");
    expect(factoryText).toContain("pnpm release:artifacts validate-product");
    expect(factoryText).toContain("factory-product.json");
    expect(factoryText).toContain("factory-runtime");
    expect(factoryText).toContain("accepted-product-current-");
    expect(factoryText).toContain("accepted-product-previous-");
    expect(factoryText).not.toMatch(/pnpm (?:build:desktop-runtime|build:wsl-runtime)/);
    expect(jobs["resolve-factory-product"].outputs).toMatchObject({
      current_product_bundle_artifact:
        "${{ steps.identity.outputs.current_product_bundle_artifact }}",
      previous_product_bundle_artifact:
        "${{ steps.identity.outputs.previous_product_bundle_artifact }}",
    });

    const windowsText = jobText(jobs["windows-assets"]);
    expect(windowsText).toContain("CODER_STUDIO_FACTORY_RUNTIME_DIR");
    expect(windowsText).toContain("CODER_STUDIO_FACTORY_PRODUCT_FILE");
    expect(windowsText).toContain("WINDOWS_SIGNING_ENABLED");
    expect(windowsText).toContain("pnpm dist:desktop");
    expect(windowsText).toContain("pnpm release:artifacts stage-desktop");
    expect(windowsText).toContain("--components windows");
    expect(windowsText).not.toContain("build:desktop-runtime");
    const recoverWindows = step(
      jobs["windows-assets"],
      "Build or recover Windows Desktop bytes"
    )?.run;
    expect(recoverWindows).toContain("tar -tzf");
    expect(recoverWindows).toContain(
      "Legacy Desktop candidate evidence contains Factory Runtime bytes"
    );
    expect(recoverWindows).toContain(
      "cp -R release/factory-product/factory-runtime release/desktop-windows/factory-runtime"
    );
    expect(recoverWindows).toContain("windows_signing is enabled");

    const linuxText = jobText(jobs["wsl-engine"]);
    expect(linuxText).toContain("pnpm build:wsl-engine");
    expect(linuxText).toContain("--components wsl-engine");
    expect(linuxText).not.toContain("build:wsl-runtime");

    const publishText = jobText(jobs["publish-candidate"]);
    expect(publishText).toContain("pnpm release:channel desktop");
    expect(publishText).toContain("pnpm release:artifacts validate-desktop");
    expect(publishText).toContain("gh release create");
    expect(publishText).toContain("--prerelease --latest=false");
    expect(publishText).not.toContain("product-channel.json");
    expect(publishText).not.toMatch(/pnpm (?:publish|build:desktop-runtime|build:wsl-runtime)/);
    expect(
      step(jobs["publish-candidate"], "Assemble or recover signed Desktop bundle")?.run
    ).toContain("-C release/desktop-candidate windows-engine");
    expect(
      step(jobs["publish-candidate"], "Assemble or recover signed Desktop bundle")?.run
    ).not.toContain("-C release/desktop-candidate factory-runtime windows-engine");
    expect(
      step(jobs["publish-candidate"], "Upload runtime public key for compatibility acceptance")
        ?.with
    ).toEqual({
      name: "desktop-compatibility-runtime-public-key-${{ github.run_id }}",
      path: "release/compatibility-key/runtime-public.pem",
      "if-no-files-found": "error",
      "retention-days": 1,
    });
  });

  it("accepts installation, Factory fallback, and current and previous Product compatibility", () => {
    const workflow = loadWorkflow("desktop-release.yml");
    const jobs = workflow.jobs;

    expect(jobs["accept-installation"].strategy?.matrix?.scenario).toEqual([
      "fresh-native",
      "fresh-wsl",
      "installed-upgrade",
    ]);
    expect(jobText(jobs["accept-installation"])).toContain("pnpm acceptance:desktop:installed");
    expect(jobText(jobs["accept-installation"])).toContain(
      "needs.publish-candidate.outputs.candidate_tag"
    );
    expect(jobText(jobs["accept-installation"])).toContain("gh release download desktop-stable");
    expect(jobText(jobs["accept-installation"])).toContain("desktop-channel-modern.json");
    expect(jobText(jobs["accept-installation"])).toContain("modern.yml");
    expect(jobText(jobs["accept-installation"])).toContain("shell.updaterMetadata");
    expect(jobText(jobs["accept-installation"])).toContain("-SkipAuthenticode");
    expect(jobs["accept-factory"].strategy?.matrix?.scenario).toEqual([
      "offline-factory",
      "factory-fallback",
    ]);
    expect(jobText(jobs["accept-factory"])).toContain("factory-runtime");
    expect(jobText(jobs["accept-factory"])).toContain("factoryProduct.releaseTag");
    expect(jobText(jobs["accept-factory"])).toContain("pnpm release:artifacts validate-product");
    expect(jobText(jobs["accept-factory"])).toContain("pnpm release:artifacts validate-desktop");
    expect(jobText(jobs["accept-factory"])).toContain("DESKTOP_CHANNEL_SHA256");
    expect(jobText(jobs["accept-factory"])).toContain("PRODUCT_CHANNEL_SHA256");
    expect(jobText(jobs["accept-factory"])).toContain("desktop.stdout.log");
    expect(jobText(jobs["accept-factory"])).toContain("RedirectStandardError");
    expect(jobText(jobs["accept-factory"])).toContain("CODER_STUDIO_RELEASE_BASE_URL");
    expect(jobText(jobs["accept-factory"])).toContain("Desktop process exit code");
    expect(jobText(jobs["accept-factory"])).toContain("Write-AcceptanceReport");
    expect(step(jobs["accept-factory"], "Download accepted Product bundle")?.with).toEqual({
      name: "${{ needs.resolve-factory-product.outputs.current_product_bundle_artifact }}",
      path: "release/factory-acceptance/product",
    });
    expect(jobText(jobs["accept-factory"])).toContain(
      "Packaged Factory Runtime file set differs from accepted Product bytes"
    );
    expect(jobText(jobs["accept-factory"])).not.toContain(
      "--pattern desktop-validation-evidence.tgz"
    );
    expect(jobs.compatibility.strategy?.matrix?.product).toEqual(["current", "previous"]);
    expect(jobs.compatibility.uses).toBe("./.github/workflows/compatibility-acceptance.yml");
    expect(jobs.compatibility.secrets).toBeUndefined();
    expect(jobText(jobs.compatibility)).toContain("current_product_tag");
    expect(jobText(jobs.compatibility)).toContain("previous_product_tag");
    expect(jobText(jobs.compatibility)).toContain("product_bundle_artifact");
    expect(jobs.compatibility.with).toMatchObject({
      desktop_tag: "${{ needs.publish-candidate.outputs.candidate_tag }}",
      desktop_channel_sha256: "${{ needs.publish-candidate.outputs.desktop_channel_sha256 }}",
      runtime_public_key_artifact: "desktop-compatibility-runtime-public-key-${{ github.run_id }}",
    });
    expect(jobs["resolve-factory-product"].environment).toBe("desktop-production");
    expect(jobs["windows-assets"].environment).toBe("desktop-production");
    expect(jobs["wsl-engine"].environment).toBe("desktop-production");
    expect(jobs["publish-candidate"].environment).toBe("desktop-production");
    expect(jobs["publish-candidate"].permissions).toEqual({
      attestations: "write",
      contents: "write",
      "id-token": "write",
    });
    expect(jobs["accept-installation"].environment).toBe("desktop-production");
    expect(jobs["accept-factory"].environment).toBe("desktop-production");
  });

  it("promotes only Desktop release and pointer after acceptance", () => {
    const workflow = loadWorkflow("desktop-release.yml");
    const promote = workflow.jobs.promote;
    const steps = promote.steps ?? [];
    const names = steps.map((candidate) => candidate.name);
    const expectedOrder = [
      "Verify accepted immutable Desktop bytes",
      "Promote Desktop versioned release",
      "Advance signed Desktop stable pointer",
      "Verify promoted Desktop",
      "Record Desktop promotion",
    ];
    let previousIndex = -1;
    for (const name of expectedOrder) {
      const index = names.indexOf(name);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }

    expect(step(promote, "Checkout repository")?.uses).toBe("actions/checkout@v4");
    expect(step(promote, "Setup pnpm")?.uses).toBe("pnpm/action-setup@v4");
    expect(step(promote, "Install dependencies")?.run).toBe("pnpm install --frozen-lockfile");
    expect(step(promote, "Verify accepted immutable Desktop bytes")?.run).toContain(
      "release-workflow-helpers.ts verify-digests"
    );
    expect(step(promote, "Verify accepted immutable Desktop bytes")?.run).toContain(
      "--channel desktop"
    );
    expect(step(promote, "Download accepted current Product bundle")?.with).toEqual({
      name: "${{ needs.resolve-factory-product.outputs.current_product_bundle_artifact }}",
      path: "release/desktop-promotion/current-product",
    });
    expect(step(promote, "Revalidate accepted Product stable pointer")?.run).toContain(
      "current-product/product-channel.json"
    );
    expect(step(promote, "Promote Desktop versioned release")?.run).toContain(
      "--prerelease=false --latest=false"
    );
    expect(step(promote, "Advance signed Desktop stable pointer")?.run).toContain("desktop-stable");
    expect(step(promote, "Advance signed Desktop stable pointer")?.run).toContain(
      "desktop-channel.json"
    );
    expect(step(promote, "Record Desktop promotion")?.run).toContain("promotion.json");
    expect(step(promote, "Record Desktop promotion")?.run).toContain(
      "release-workflow-helpers.ts verify-existing-promotion-record"
    );
    expect(step(promote, "Record Desktop promotion")?.run).toContain(
      "release-workflow-helpers.ts write-promotion-record"
    );
    expect(promote.concurrency).toEqual({
      group: "product-desktop-stable-promotion",
      "cancel-in-progress": false,
    });
    expect(step(promote, "Revalidate accepted Product stable pointer")?.run).toContain(
      "Product stable pointer changed after compatibility acceptance"
    );
    expect(step(promote, "Revalidate accepted Product stable pointer")?.run).toContain(
      "product-stable"
    );
    expect(jobText(promote)).not.toMatch(/pnpm (build|dist|publish)/);
  });
});

describe("legacy Desktop acceptance", () => {
  it("is reserved for the explicit migration bridge", () => {
    const workflow = loadWorkflow("desktop-acceptance.yml");
    const desktopReleaseSource = readFileSync(workflowPath("desktop-release.yml"), "utf8");
    expect(workflow.name).toContain("Legacy bridge");
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(JSON.stringify(workflow.on)).toContain("bridge_candidate_tag");
    expect(jobText(workflow.jobs.accept)).toContain("inputs.bridge_candidate_tag");
    const source = readFileSync(workflowPath("desktop-acceptance.yml"), "utf8");
    expect(source).not.toContain("desktop:channel");
    expect(source).not.toContain("desktop:artifacts");
    expect(source).not.toContain("--release-kind");
    expect(source).not.toContain("--previous-release-directory");
    expect(source).not.toContain("desktop-ci-");
    expect(source).not.toContain("gh release create");
    expect(source).toContain("pnpm acceptance:desktop:installed");
    expect(desktopReleaseSource).not.toContain("desktop-acceptance.yml");
  });
});

describe("bridge candidate preparation workflow", () => {
  it("manually hydrates the one-time bridge candidate and accepted Product bundle", () => {
    expect(existsSync(workflowPath("desktop-bridge-candidate.yml"))).toBe(true);
    const workflow = loadWorkflow("desktop-bridge-candidate.yml");
    const dispatch = workflow.on.workflow_dispatch as {
      inputs: Record<string, Record<string, unknown>>;
    };
    const prepare = workflow.jobs.prepare;
    const text = jobText(prepare);
    const resolveProduct = step(prepare, "Resolve accepted Product tag and signing key");
    const uploadProduct = step(
      prepare,
      "Upload reconstructed Product bundle to its immutable release"
    );
    const uploadCandidate = step(prepare, "Upload hydrated bridge assets to the Desktop candidate");

    expect(dispatch.inputs).toEqual({
      bridge_candidate_tag: {
        description: "Existing immutable Desktop candidate tag to hydrate for bridge promotion",
        required: true,
        type: "string",
      },
    });
    expect(workflow.concurrency).toEqual({
      group: "desktop-bridge-candidate-${{ inputs.bridge_candidate_tag }}",
      "cancel-in-progress": false,
    });
    expect(workflow.permissions).toEqual({ contents: "write" });
    expect(prepare.environment).toBe("desktop-production");
    expect(prepare.env).toHaveProperty("CODER_STUDIO_RUNTIME_PUBLIC_KEY");
    expect(text).toContain("prepare-product-release-bundle.ts");
    expect(text).toContain("prepare-desktop-bridge-candidate.ts");
    expect(text).toContain("pnpm release:artifacts validate-product");
    expect(text).toContain("pnpm release:artifacts validate-desktop");
    expect(text).toContain("desktop-channel-modern.json");
    expect(text).toContain("factory-runtime");
    expect(resolveProduct?.run).toContain("desktop-channel-modern.json");
    expect(resolveProduct?.run).toContain('channel?.channel !== "desktop"');
    expect(uploadProduct?.run).toContain('gh release upload "${PRODUCT_TAG}"');
    expect(uploadCandidate?.run).toContain('gh release upload "${BRIDGE_CANDIDATE_TAG}"');
  });
});

describe("one-time Product and Desktop migration bridge", () => {
  it("is an explicit manual operation with a serialized confirmation", () => {
    expect(existsSync(workflowPath("desktop-bridge-release.yml"))).toBe(true);
    const workflow = loadWorkflow("desktop-bridge-release.yml");
    const dispatch = workflow.on.workflow_dispatch as {
      inputs: Record<string, Record<string, unknown>>;
    };

    expect(dispatch.inputs).toEqual({
      bridge_candidate_tag: {
        description: "Existing immutable bridge candidate tag",
        required: true,
        type: "string",
      },
      confirm_latest: {
        description: "Type PROMOTE_BRIDGE_TO_LATEST to confirm the one-time migration",
        required: true,
        type: "string",
      },
    });
    expect(workflow.concurrency).toEqual({
      group: "product-desktop-migration-bridge",
      "cancel-in-progress": false,
    });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.on.push).toBeUndefined();
  });

  it("wires immutable preparation, both acceptance phases, and final promotion", () => {
    const jobs = loadWorkflow("desktop-bridge-release.yml").jobs;

    expect([...Object.keys(jobs)].sort()).toEqual(
      [
        "prepare",
        "bootstrap-product",
        "accept-legacy-upgrade",
        "bootstrap-desktop",
        "verify-stable-feeds",
        "pin-bridge-latest",
        "accept-independent-feeds",
        "promote-bridge",
      ].sort()
    );
    expect(jobs["bootstrap-product"].needs).toBe("prepare");
    expect(jobs["bootstrap-desktop"].needs).toEqual(["prepare"]);
    expect(jobs["verify-stable-feeds"].needs).toEqual([
      "prepare",
      "bootstrap-product",
      "bootstrap-desktop",
    ]);
    expect(jobs["pin-bridge-latest"].needs).toEqual(["prepare", "verify-stable-feeds"]);
    expect(jobs["accept-legacy-upgrade"].needs).toEqual([
      "prepare",
      "verify-stable-feeds",
      "pin-bridge-latest",
    ]);
    expect(jobs["accept-independent-feeds"].needs).toEqual([
      "prepare",
      "verify-stable-feeds",
      "accept-legacy-upgrade",
    ]);
    expect(jobs["promote-bridge"].needs).toEqual([
      "prepare",
      "pin-bridge-latest",
      "accept-legacy-upgrade",
      "accept-independent-feeds",
    ]);
    expect(jobs["promote-bridge"].if).toBe("success()");
    expect(jobs.prepare.environment).toBe("desktop-production");
    expect(jobs["accept-legacy-upgrade"].environment).toBe("desktop-production");
    expect(jobs["accept-independent-feeds"].environment).toBe("desktop-production");
  });

  it("can recover when the accepted bridge already became repository-wide latest", () => {
    const jobs = loadWorkflow("desktop-bridge-release.yml").jobs;
    const prepare = jobs.prepare;

    expect(prepare.outputs?.legacy_source_tag).toBe(
      "${{ steps.identity.outputs.legacy_source_tag }}"
    );
    expect(prepare.outputs?.already_promoted).toBe(
      "${{ steps.identity.outputs.already_promoted }}"
    );
    expect(step(prepare, "Download existing immutable bridge candidate")?.run).toContain(
      "A normal bridge release is recoverable only when it is repository-wide latest"
    );
    expect(step(prepare, "Record accepted bridge identities")?.run).toContain(
      'echo "legacy_source_tag=${legacy_source_tag}"'
    );
    expect(jobText(jobs["accept-legacy-upgrade"])).toContain(
      "needs.prepare.outputs.legacy_source_tag"
    );
  });

  it("validates an existing immutable candidate without rebuilding or publishing it", () => {
    const prepare = loadWorkflow("desktop-bridge-release.yml").jobs.prepare;
    const text = jobText(prepare);
    const download = step(prepare, "Download existing immutable bridge candidate")?.run;

    expect(text).toContain("bridge_candidate_tag");
    expect(download).toContain('gh release download "${BRIDGE_CANDIDATE_TAG}"');
    expect(text).toContain("product-channel.json");
    expect(text).toContain("desktop-channel.json");
    expect(text).toContain("desktop-channel-modern.json");
    expect(text).toContain("pnpm release:artifacts validate-product");
    expect(text).toContain("pnpm release:artifacts validate-desktop");
    expect(text).toContain("factory-runtime");
    expect(text).toContain("sha256sum");
    expect(step(prepare, "Record accepted bridge identities")?.run).toContain(
      'expected_desktop_tag="desktop-v${desktop_version}"'
    );
    expect(text).not.toMatch(/pnpm (?:build|dist|publish)/);
    expect(text).not.toContain("gh release create");
    expect(text).not.toContain("gh release upload");
  });

  it("bootstraps both signed stable pointers without changing immutable bytes", () => {
    const jobs = loadWorkflow("desktop-bridge-release.yml").jobs;
    const product = jobText(jobs["bootstrap-product"]);
    const desktop = jobText(jobs["bootstrap-desktop"]);

    expect(jobs["bootstrap-product"].permissions).toEqual({ contents: "write" });
    expect(jobs["bootstrap-product"].env?.GH_REPO).toBe("${{ github.repository }}");
    expect(product).toContain("product-stable");
    expect(product).toContain("product-channel.json");
    expect(product).toContain("Immutable Product pointer digest mismatch");
    expect(product).toContain("--latest=false");

    expect(jobs["bootstrap-desktop"].permissions).toEqual({ contents: "write" });
    expect(jobs["bootstrap-desktop"].env?.GH_REPO).toBe("${{ github.repository }}");
    expect(desktop).toContain("desktop-stable");
    expect(desktop).toContain("desktop-channel-modern.json");
    expect(desktop).toContain("desktop-channel.json");
    expect(desktop).toContain("Immutable Desktop pointer digest mismatch");
    expect(desktop).toContain("--latest=false");
  });

  it("accepts legacy installed upgrades before independent-feed upgrades", () => {
    const jobs = loadWorkflow("desktop-bridge-release.yml").jobs;
    const legacy = jobs["accept-legacy-upgrade"];
    const independent = jobs["accept-independent-feeds"];

    expect(legacy.strategy?.matrix?.target).toEqual(["native", "wsl"]);
    expect(jobText(legacy)).toContain("releases/latest");
    expect(jobText(legacy)).toContain("legacy_source_tag");
    expect(jobText(legacy)).toContain("legacy-current");
    expect(jobText(legacy)).toContain("legacy-wsl-current");
    expect(jobText(legacy)).toContain(
      "$previous.runtimes.'win32-x64'.version -ne $candidate.runtimes.'win32-x64'.version"
    );
    expect(jobText(legacy)).toContain("'shell,runtime:win32-x64'");
    expect(jobText(legacy)).toContain("'shell'");
    expect(jobText(legacy)).toContain("pnpm acceptance:desktop:installed");
    expect(jobText(legacy)).toContain("bridge_candidate_tag");
    expect(jobText(legacy)).toContain("-SkipAuthenticode");
    expect(jobText(legacy)).toContain("-PinLegacyShellUpdaterToChannel");

    expect(independent.strategy?.matrix?.target).toEqual(["native", "wsl"]);
    expect(jobText(independent)).toContain("product-stable");
    expect(jobText(independent)).toContain("desktop-stable");
    expect(jobText(independent)).toContain("pnpm acceptance:desktop:installed");
    expect(jobText(independent)).toContain("-SkipAuthenticode");
  });

  it("verifies both stable feeds before making the bridge repository-wide latest", () => {
    const jobs = loadWorkflow("desktop-bridge-release.yml").jobs;
    const verify = jobText(jobs["verify-stable-feeds"]);
    const pin = jobs["pin-bridge-latest"];
    const promote = jobs["promote-bridge"];

    expect(jobs["verify-stable-feeds"].env?.GH_REPO).toBe("${{ github.repository }}");
    expect(verify).toContain("gh release download product-stable");
    expect(verify).toContain("gh release download desktop-stable");
    expect(verify).toContain("product-channel.json");
    expect(verify).toContain("desktop-channel.json");
    expect(verify).toContain("sha256sum");
    expect(pin.env?.GH_REPO).toBe("${{ github.repository }}");
    expect(jobText(pin)).toContain("PROMOTE_BRIDGE_TO_LATEST");
    expect(
      step(pin, "Publish the bridge candidate as the repository-wide latest release")?.run
    ).toBe('gh release edit "${BRIDGE_CANDIDATE_TAG}" --prerelease=false --latest');
    expect(promote.env?.GH_REPO).toBe("${{ github.repository }}");
    expect(jobText(promote)).toContain("PROMOTE_BRIDGE_TO_LATEST");
    expect(step(promote, "Make bridge the final repository-wide latest")?.run).toBe(
      'gh release edit "${BRIDGE_CANDIDATE_TAG}" --prerelease=false --latest'
    );
    expect(step(promote, "Verify bridge is repository-wide latest")?.run).toContain(
      'releases/latest" --jq .tag_name'
    );
  });

  it("keeps repository-wide latest ownership exclusive to the bridge", () => {
    const workflowFiles = readdirSync(workflowsRoot).filter((name) => name.endsWith(".yml"));
    const latestOwners = workflowFiles.filter((name) => {
      const source = readFileSync(workflowPath(name), "utf8");
      return /--latest(?![=]false)/.test(source);
    });

    expect(latestOwners).toEqual(["desktop-bridge-release.yml"]);
    expect(readFileSync(workflowPath("product-release.yml"), "utf8")).toContain("--latest=false");
    expect(readFileSync(workflowPath("desktop-release.yml"), "utf8")).toContain("--latest=false");
  });

  it("documents normal operations, recovery, migration, and compatibility sequencing", () => {
    const runbookPath = resolve(
      import.meta.dirname,
      "../docs/promotion/product-desktop-release-runbook.md"
    );
    expect(existsSync(runbookPath)).toBe(true);
    const runbook = readFileSync(runbookPath, "utf8");

    expect(runbook).toContain("Product release");
    expect(runbook).toContain("Desktop release");
    expect(runbook).toContain("candidate_tag");
    expect(runbook).toContain("immutable-byte mismatch");
    expect(runbook).toContain("product-stable");
    expect(runbook).toContain("desktop-stable");
    expect(runbook).toContain("PROMOTE_BRIDGE_TO_LATEST");
    expect(runbook).toContain("two-release compatibility window");
  });
});
