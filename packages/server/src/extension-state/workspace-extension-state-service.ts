import type {
  WorkspaceExtensionStateView,
  WorkspaceLogEntryView,
  WorkspaceProgressView,
  WorkspaceQuickActionView,
  WorkspaceStatusPillView,
} from "@coder-studio/core";
import type { EventBus } from "../bus/event-bus.js";
import type { WorkspaceExtensionStateRepo } from "../storage/repositories/workspace-extension-state-repo.js";

export interface WorkspaceExtensionStateServiceOptions {
  repo: WorkspaceExtensionStateRepo;
  eventBus: EventBus;
  now?: () => number;
}

export type SetWorkspaceStatusPillInput = Omit<WorkspaceStatusPillView, "updatedAt"> & {
  workspaceId: string;
};

export interface ClearWorkspaceStatusPillInput {
  workspaceId: string;
  key: string;
}

export type SetWorkspaceProgressInput = Omit<WorkspaceProgressView, "updatedAt"> & {
  workspaceId: string;
};

export interface ClearWorkspaceProgressInput {
  workspaceId: string;
  key: string;
}

export type AppendWorkspaceLogInput = Omit<WorkspaceLogEntryView, "timestamp"> & {
  workspaceId: string;
  timestamp?: number;
};

export interface ClearWorkspaceLogInput {
  workspaceId: string;
  key?: string;
}

export type SetWorkspaceQuickActionInput = WorkspaceQuickActionView & {
  workspaceId: string;
};

export interface ClearWorkspaceQuickActionInput {
  workspaceId: string;
  id: string;
}

function upsertBy<T>(items: T[], predicate: (item: T) => boolean, next: T): T[] {
  const existingIndex = items.findIndex(predicate);
  if (existingIndex === -1) {
    return [...items, next];
  }

  const updated = [...items];
  updated[existingIndex] = next;
  return updated;
}

export class WorkspaceExtensionStateService {
  private readonly repo: WorkspaceExtensionStateRepo;
  private readonly eventBus: EventBus;
  private readonly now: () => number;

  constructor(input: WorkspaceExtensionStateServiceOptions) {
    this.repo = input.repo;
    this.eventBus = input.eventBus;
    this.now = input.now ?? (() => Date.now());
  }

  get(workspaceId: string): WorkspaceExtensionStateView {
    return this.repo.get(workspaceId);
  }

  setStatusPill(input: SetWorkspaceStatusPillInput): WorkspaceExtensionStateView {
    const timestamp = this.now();
    const state = this.repo.get(input.workspaceId);
    const next = this.saveAndEmit({
      ...state,
      statusPills: upsertBy(state.statusPills, (item) => item.key === input.key, {
        key: input.key,
        label: input.label,
        state: input.state,
        detail: input.detail,
        updatedAt: timestamp,
      }),
      updatedAt: timestamp,
    });
    return next;
  }

  clearStatusPill(input: ClearWorkspaceStatusPillInput): WorkspaceExtensionStateView {
    const timestamp = this.now();
    const state = this.repo.get(input.workspaceId);
    return this.saveAndEmit({
      ...state,
      statusPills: state.statusPills.filter((item) => item.key !== input.key),
      updatedAt: timestamp,
    });
  }

  setProgress(input: SetWorkspaceProgressInput): WorkspaceExtensionStateView {
    const timestamp = this.now();
    const state = this.repo.get(input.workspaceId);
    return this.saveAndEmit({
      ...state,
      progress: upsertBy(state.progress, (item) => item.key === input.key, {
        key: input.key,
        label: input.label,
        value: input.value,
        max: input.max,
        detail: input.detail,
        updatedAt: timestamp,
      }),
      updatedAt: timestamp,
    });
  }

  clearProgress(input: ClearWorkspaceProgressInput): WorkspaceExtensionStateView {
    const timestamp = this.now();
    const state = this.repo.get(input.workspaceId);
    return this.saveAndEmit({
      ...state,
      progress: state.progress.filter((item) => item.key !== input.key),
      updatedAt: timestamp,
    });
  }

  appendLog(input: AppendWorkspaceLogInput): WorkspaceExtensionStateView {
    const timestamp = input.timestamp ?? this.now();
    const state = this.repo.get(input.workspaceId);
    return this.saveAndEmit({
      ...state,
      logs: [
        ...state.logs,
        {
          key: input.key,
          level: input.level,
          message: input.message,
          timestamp,
        },
      ],
      updatedAt: timestamp,
    });
  }

  clearLog(input: ClearWorkspaceLogInput): WorkspaceExtensionStateView {
    const timestamp = this.now();
    const state = this.repo.get(input.workspaceId);
    return this.saveAndEmit({
      ...state,
      logs: input.key ? state.logs.filter((item) => item.key !== input.key) : [],
      updatedAt: timestamp,
    });
  }

  setQuickAction(input: SetWorkspaceQuickActionInput): WorkspaceExtensionStateView {
    const timestamp = this.now();
    const state = this.repo.get(input.workspaceId);
    return this.saveAndEmit({
      ...state,
      quickActions: upsertBy(state.quickActions, (item) => item.id === input.id, {
        id: input.id,
        label: input.label,
        command: input.command,
        description: input.description,
      }),
      updatedAt: timestamp,
    });
  }

  clearQuickAction(input: ClearWorkspaceQuickActionInput): WorkspaceExtensionStateView {
    const timestamp = this.now();
    const state = this.repo.get(input.workspaceId);
    return this.saveAndEmit({
      ...state,
      quickActions: state.quickActions.filter((item) => item.id !== input.id),
      updatedAt: timestamp,
    });
  }

  private saveAndEmit(state: WorkspaceExtensionStateView): WorkspaceExtensionStateView {
    const saved = this.repo.save(state);
    this.eventBus.emit({
      type: "workspace.extension_state.changed",
      workspaceId: saved.workspaceId,
      state: saved,
    });
    return saved;
  }
}
