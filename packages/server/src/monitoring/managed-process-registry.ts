import type { ManagedProcessRoot } from "./types.js";

interface ManagedProcessRegistryOptions {
  now: () => number;
}

interface TerminalRootInput {
  terminalId: string;
  workspaceId: string;
  pid?: number;
  kind: "agent" | "shell";
  title: string;
}

interface TerminalBindingInput {
  sessionId: string;
  providerId?: string;
  label: string;
}

export class ManagedProcessRegistry {
  private readonly now: () => number;
  private readonly roots = new Map<string, ManagedProcessRoot>();

  constructor(options: ManagedProcessRegistryOptions) {
    this.now = options.now;
  }

  registerServerProcess(pid: number): void {
    const ownerId = `server:${pid}`;
    if (this.roots.has(ownerId)) {
      return;
    }

    this.roots.set(ownerId, {
      ownerId,
      rootPid: pid,
      kind: "server",
      label: "Coder Studio server",
      startedAt: this.now(),
    });
  }

  upsertTerminalRoot(input: TerminalRootInput): void {
    if (!input.pid || input.pid <= 0) {
      return;
    }

    const ownerId = `terminal:${input.terminalId}`;
    const existing = this.roots.get(ownerId);

    this.roots.set(ownerId, {
      ownerId,
      rootPid: input.pid,
      kind: "terminal",
      label: input.title,
      workspaceId: input.workspaceId,
      terminalId: input.terminalId,
      startedAt: existing?.startedAt ?? this.now(),
      sessionId: existing?.sessionId,
      providerId: existing?.providerId,
    });
  }

  bindSessionToTerminal(terminalId: string, binding: TerminalBindingInput): void {
    const ownerId = `terminal:${terminalId}`;
    const existing = this.roots.get(ownerId);
    if (!existing) {
      return;
    }

    this.roots.set(ownerId, {
      ...existing,
      sessionId: binding.sessionId,
      providerId: binding.providerId,
      label: binding.label,
    });
  }

  registerBackgroundRoot(root: ManagedProcessRoot): void {
    this.roots.set(root.ownerId, root);
  }

  unregisterByOwner(ownerId: string): void {
    this.roots.delete(ownerId);
  }

  listRoots(): ManagedProcessRoot[] {
    return Array.from(this.roots.values()).sort((a, b) => a.startedAt - b.startedAt);
  }
}
