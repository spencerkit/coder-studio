import type { RuntimeInstaller } from "./runtime-installer.js";
import type { RuntimeReleaseProvider, RuntimeReleaseTarget } from "./runtime-release-provider.js";

export interface DesktopUpdateBridgeMessage {
  kind: "desktop-update";
  action: "start-install" | "apply-state-patch" | "check-for-updates" | "check-for-updates-result";
  payload: Record<string, unknown>;
}

export interface DesktopUpdateBridgeSidecar {
  send(message: DesktopUpdateBridgeMessage): void;
  stop(timeoutMs?: number): Promise<void>;
}

export interface DesktopUpdateBridgeController {
  handleSidecarMessage(message: unknown): Promise<void>;
}

export interface DesktopUpdateBridgeDeps {
  getSidecar: () => DesktopUpdateBridgeSidecar | null;
  restartSidecar: () => Promise<void>;
  runtimeReleaseProvider: Pick<
    RuntimeReleaseProvider,
    "resolveLatestCompatible" | "resolveVersion"
  >;
  runtimeInstaller: Pick<RuntimeInstaller, "installRelease">;
  releaseTarget: RuntimeReleaseTarget;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DesktopUpdateBridge implements DesktopUpdateBridgeController {
  constructor(private readonly deps: DesktopUpdateBridgeDeps) {}

  async handleSidecarMessage(message: unknown): Promise<void> {
    if (!isRecord(message) || message.kind !== "desktop-update" || !isRecord(message.payload)) {
      return;
    }

    if (message.action === "check-for-updates") {
      await this.handleCheckForUpdates(message.payload);
      return;
    }

    if (message.action !== "start-install") {
      return;
    }

    const targetVersion = message.payload.targetVersion;
    if (typeof targetVersion !== "string" || targetVersion.trim().length === 0) {
      this.sendStatePatch({
        updateStatus: "failed",
        finishedAt: Date.now(),
        errorSummary: "Desktop update request is missing targetVersion",
      });
      return;
    }

    try {
      this.sendStatePatch({
        updateStatus: "installing",
        targetVersion,
        startedAt: Date.now(),
        finishedAt: null,
        errorSummary: null,
      });

      const release = await this.deps.runtimeReleaseProvider.resolveVersion(
        targetVersion,
        this.deps.releaseTarget
      );
      if (!release) {
        throw new Error(`No compatible desktop runtime release found for ${targetVersion}`);
      }

      await this.deps.runtimeInstaller.installRelease(release);

      this.sendStatePatch({
        updateStatus: "restarting",
        targetVersion,
        errorSummary: null,
      });

      await this.deps.restartSidecar();

      this.sendStatePatch({
        currentVersion: targetVersion,
        latestVersion: targetVersion,
        availability: "up_to_date",
        updateStatus: "succeeded",
        targetVersion,
        finishedAt: Date.now(),
        requiresManualStep: false,
        manualCommand: null,
        errorSummary: null,
      });
    } catch (error) {
      this.sendStatePatch({
        updateStatus: "failed",
        finishedAt: Date.now(),
        errorSummary: toErrorMessage(error),
      });
    }
  }

  private async handleCheckForUpdates(payload: Record<string, unknown>): Promise<void> {
    const requestId = typeof payload.requestId === "string" ? payload.requestId : null;
    if (!requestId) {
      return;
    }

    try {
      const release = await this.deps.runtimeReleaseProvider.resolveLatestCompatible(
        this.deps.releaseTarget
      );
      this.sendMessage("check-for-updates-result", {
        requestId,
        latestVersion: release?.version ?? null,
      });
    } catch (error) {
      this.sendMessage("check-for-updates-result", {
        requestId,
        latestVersion: null,
        errorSummary: toErrorMessage(error),
      });
    }
  }

  private sendStatePatch(payload: Record<string, unknown>): void {
    this.sendMessage("apply-state-patch", payload);
  }

  private sendMessage(
    action: DesktopUpdateBridgeMessage["action"],
    payload: Record<string, unknown>
  ): void {
    this.deps.getSidecar()?.send({
      kind: "desktop-update",
      action,
      payload,
    });
  }
}
