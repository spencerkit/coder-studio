import type { RuntimeReleaseMetadata, RuntimeReleaseTarget } from "./runtime-release-provider.js";
import type { ActiveRuntimePointer } from "./runtime-store.js";

export interface RuntimeBootstrapResult {
  activeRuntime: ActiveRuntimePointer | null;
  bootstrapApplied: boolean;
}

export interface RuntimeBootstrapError extends Error {
  phase: "resolve_release" | "install_release";
  releaseSource: string;
}

export async function ensureRuntimeReady(input: {
  target: RuntimeReleaseTarget;
  readActiveRuntime: () => Promise<ActiveRuntimePointer | null>;
  resolveLatestCompatible: (target: RuntimeReleaseTarget) => Promise<RuntimeReleaseMetadata | null>;
  installRelease: (release: RuntimeReleaseMetadata) => Promise<ActiveRuntimePointer>;
  validateActiveRuntime?: (
    runtime: ActiveRuntimePointer,
    target: RuntimeReleaseTarget
  ) => Promise<boolean>;
}): Promise<RuntimeBootstrapResult> {
  const activeRuntime = await input.readActiveRuntime();
  if (
    activeRuntime &&
    (await input.validateActiveRuntime?.(activeRuntime, input.target)) !== false
  ) {
    return {
      activeRuntime,
      bootstrapApplied: false,
    };
  }

  let release: RuntimeReleaseMetadata | null;
  try {
    release = await input.resolveLatestCompatible(input.target);
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    (failure as RuntimeBootstrapError).phase = "resolve_release";
    (failure as RuntimeBootstrapError).releaseSource = "github-release";
    throw failure;
  }

  if (!release) {
    const failure = new Error(
      "No compatible runtime release is available"
    ) as RuntimeBootstrapError;
    failure.phase = "resolve_release";
    failure.releaseSource = "github-release";
    throw failure;
  }

  try {
    return {
      activeRuntime: await input.installRelease(release),
      bootstrapApplied: true,
    };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    (failure as RuntimeBootstrapError).phase = "install_release";
    (failure as RuntimeBootstrapError).releaseSource = "github-release";
    throw failure;
  }
}
