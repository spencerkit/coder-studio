import type { ProviderDefinition, Workspace } from "@coder-studio/core";
import { deleteEntry, readFile, writeFile } from "../fs/file-io.js";
import type { CommandAvailabilityCheck } from "../provider-runtime/command-check.js";
import {
  normalizeAgentInstructionsContent,
  resolveEffectiveAgentInstructions,
} from "./effective.js";

export interface AgentInstructionsPublisherLogger {
  warn?(obj: object, msg: string): void;
}

export interface AgentInstructionsPublishTargetResult {
  providerId: string;
  providerIds: string[];
  path: string;
  action: "written" | "deleted" | "unchanged" | "error";
  error?: string;
}

export interface AgentInstructionsPublishResult {
  workspaceId: string;
  effectiveHash?: string;
  targets: AgentInstructionsPublishTargetResult[];
}

export interface AgentInstructionsPublisherDeps {
  workspaceMgr: {
    get(workspaceId: string): Workspace | undefined;
    list(): Workspace[];
  };
  getProviderRegistry: () => ProviderDefinition[];
  commandExists?: CommandAvailabilityCheck;
  logger?: AgentInstructionsPublisherLogger;
}

export class AgentInstructionsPublisher {
  private workspaceSyncTails = new Map<string, Promise<void>>();

  constructor(private readonly deps: AgentInstructionsPublisherDeps) {}

  async syncWorkspace(workspaceId: string): Promise<AgentInstructionsPublishResult> {
    try {
      return await this.runSerialized(workspaceId, () => this.syncWorkspaceInternal(workspaceId));
    } catch (error) {
      this.deps.logger?.warn?.(
        {
          workspaceId,
          error,
        },
        "Failed to publish agent instructions"
      );

      return {
        workspaceId,
        targets: [],
      };
    }
  }

  scheduleWorkspaceSync(workspaceId: string): void {
    void this.syncWorkspace(workspaceId);
  }

  async syncAllOpenWorkspaces(): Promise<AgentInstructionsPublishResult[]> {
    return Promise.all(
      this.deps.workspaceMgr.list().map((workspace) => this.syncWorkspace(workspace.id))
    );
  }

  private runSerialized<T>(workspaceId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.workspaceSyncTails.get(workspaceId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);

    this.workspaceSyncTails.set(
      workspaceId,
      next.then(
        () => undefined,
        () => undefined
      )
    );

    return next;
  }

  private async syncWorkspaceInternal(
    workspaceId: string
  ): Promise<AgentInstructionsPublishResult> {
    const workspace = this.deps.workspaceMgr.get(workspaceId);
    if (!workspace) {
      return {
        workspaceId,
        targets: [],
      };
    }

    const effective = await resolveEffectiveAgentInstructions(workspace.id, workspace.path);
    const publishTargets = await this.resolvePublishTargets();

    const targets = await Promise.all(
      publishTargets.map((target) =>
        this.syncTarget(
          workspace,
          target.providerIds,
          target.path,
          target.enabled ? effective?.content : undefined
        )
      )
    );

    return {
      workspaceId: workspace.id,
      effectiveHash: effective?.effectiveHash,
      targets,
    };
  }

  private async syncTarget(
    workspace: Workspace,
    providerIds: string[],
    targetPath: string,
    effectiveContent: string | undefined
  ): Promise<AgentInstructionsPublishTargetResult> {
    const providerId = providerIds[0] ?? "unknown";
    const existingContent = await this.readTargetContent(workspace, targetPath);

    if (!effectiveContent) {
      if (existingContent === undefined) {
        return {
          providerId,
          providerIds,
          path: targetPath,
          action: "unchanged",
        };
      }

      try {
        await deleteEntry(workspace.path, targetPath);
        return {
          providerId,
          providerIds,
          path: targetPath,
          action: "deleted",
        };
      } catch (error) {
        if (this.isNotFoundError(error)) {
          return {
            providerId,
            providerIds,
            path: targetPath,
            action: "unchanged",
          };
        }
        return this.failTarget(workspace, providerIds, targetPath, "delete", error);
      }
    }

    if (
      existingContent !== undefined &&
      normalizeAgentInstructionsContent(existingContent) ===
        normalizeAgentInstructionsContent(effectiveContent)
    ) {
      return {
        providerId,
        providerIds,
        path: targetPath,
        action: "unchanged",
      };
    }

    try {
      await writeFile(workspace.path, targetPath, effectiveContent);
      return {
        providerId,
        providerIds,
        path: targetPath,
        action: "written",
      };
    } catch (error) {
      return this.failTarget(workspace, providerIds, targetPath, "write", error);
    }
  }

  private async readTargetContent(
    workspace: Workspace,
    targetPath: string
  ): Promise<string | undefined> {
    try {
      const result = await readFile(workspace.id, workspace.path, targetPath);
      if (result.kind !== "text") {
        return "";
      }
      return result.content;
    } catch {
      return undefined;
    }
  }

  private failTarget(
    workspace: Workspace,
    providerIds: string[],
    targetPath: string,
    action: "write" | "delete",
    error: unknown
  ): AgentInstructionsPublishTargetResult {
    const providerId = providerIds[0] ?? "unknown";
    const message = this.getErrorMessage(error);
    this.deps.logger?.warn?.(
      {
        workspaceId: workspace.id,
        providerId,
        providerIds,
        path: targetPath,
        action,
        error,
      },
      "Failed to publish agent instructions target"
    );

    return {
      providerId,
      providerIds,
      path: targetPath,
      action: "error",
      error: message,
    };
  }

  private getErrorMessage(error: unknown): string {
    if (typeof error === "object" && error !== null) {
      const candidate = error as { message?: string; code?: string };
      if (candidate.message) {
        return candidate.message;
      }
      if (candidate.code) {
        return candidate.code;
      }
    }

    return String(error);
  }

  private isNotFoundError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "not_found"
    );
  }

  private async resolvePublishTargets(): Promise<
    Array<{ providerId: string; providerIds: string[]; path: string; enabled: boolean }>
  > {
    const targetsByPath = new Map<
      string,
      { providerId: string; providerIds: string[]; path: string; enabled: boolean }
    >();

    for (const provider of this.deps.getProviderRegistry()) {
      const rawPath = provider.agentInstructions?.publishTarget?.path;
      const path = typeof rawPath === "string" ? rawPath.trim() : "";
      if (!path) {
        continue;
      }

      const enabled = await this.isProviderInstalled(provider);
      const existing = targetsByPath.get(path);

      if (existing) {
        existing.providerIds.push(provider.id);
        existing.enabled ||= enabled;
        continue;
      }

      targetsByPath.set(path, {
        providerId: provider.id,
        providerIds: [provider.id],
        path,
        enabled,
      });
    }

    return [...targetsByPath.values()];
  }

  private async isProviderInstalled(provider: ProviderDefinition): Promise<boolean> {
    const commandExists = this.deps.commandExists;
    if (!commandExists) {
      return true;
    }

    for (const command of provider.requiredCommands) {
      if (!(await commandExists(command))) {
        return false;
      }
    }

    return true;
  }
}
