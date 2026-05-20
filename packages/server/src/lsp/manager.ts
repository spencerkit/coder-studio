import type {
  DomainEvent,
  LspDocumentSymbol,
  LspEnsureSessionResult,
  LspHoverResult,
  LspLocation,
  LspSessionSummary,
  Workspace,
} from "@coder-studio/core";
import { LspToolManager } from "../lsp-tools/manager.js";
import { resolveLspServerKind, wrapLspCommandForWorkspace } from "./server-factory.js";
import { LspSession } from "./session.js";

type LspSessionDeps = ConstructorParameters<typeof LspSession>[0];

interface LspSessionLike {
  start(): Promise<LspSessionSummary>;
  stop(): Promise<void>;
  getSummary(): LspSessionSummary;
  openDocument(input: { path: string; languageId: string; text: string }): Promise<number>;
  changeDocument(path: string, text: string): Promise<number>;
  closeDocument(path: string): Promise<void>;
  definition(input: { path: string; line: number; column: number }): Promise<LspLocation[] | null>;
  declaration(input: { path: string; line: number; column: number }): Promise<LspLocation[] | null>;
  typeDefinition(input: {
    path: string;
    line: number;
    column: number;
  }): Promise<LspLocation[] | null>;
  references(input: { path: string; line: number; column: number }): Promise<LspLocation[] | null>;
  hover(input: { path: string; line: number; column: number }): Promise<LspHoverResult | null>;
  documentSymbols(input: { path: string }): Promise<LspDocumentSymbol[] | null>;
}

interface ManagedSessionEntry {
  session: LspSessionLike;
  idleTimer: NodeJS.Timeout | null;
}

interface SessionLookupResult {
  key: string;
  entry: ManagedSessionEntry;
}

export class LspManager {
  private readonly sessions = new Map<string, ManagedSessionEntry>();

  constructor(
    private readonly deps: {
      workspaceMgr: { get: (workspaceId: string) => Workspace | undefined };
      eventBus: { emit: (event: DomainEvent) => void };
      logger: {
        info: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
      };
      requestTimeoutMs: number;
      idleTtlMs: number;
      restartLimit: number;
      lspToolMgr: LspToolManager;
      createSession?: (deps: LspSessionDeps) => LspSessionLike;
    }
  ) {}

  async ensureSession(input: {
    workspaceId: string;
    path: string;
  }): Promise<LspEnsureSessionResult> {
    const workspace = this.deps.workspaceMgr.get(input.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${input.workspaceId}`);
    }

    const serverKind = resolveLspServerKind(input.path);
    if (!serverKind) {
      return { kind: "unsupported_language" };
    }

    const resolution = await this.deps.lspToolMgr.resolve({
      workspace,
      serverKind,
    });
    if (resolution.kind !== "ready") {
      return {
        kind: "tool_missing",
        serverKind: resolution.serverKind,
        displayName: resolution.displayName,
        errorCode: resolution.errorCode,
        message: resolution.message,
        autoInstallSupported: resolution.autoInstallSupported,
        missingCommands: resolution.missingCommands,
        missingPrerequisites: resolution.missingPrerequisites,
      };
    }

    const spec = wrapLspCommandForWorkspace({
      workspace,
      serverKind,
      command: resolution.command,
      args: resolution.args,
      rootPath: workspace.path,
    });

    const key = this.keyFor(input.workspaceId, spec.serverKind);
    const existing = this.sessions.get(key);
    if (existing) {
      try {
        const summary = await existing.session.start();
        this.bumpActivity(key);
        return {
          kind: "ready",
          summary,
          displayName: resolution.displayName,
          source: resolution.source,
        };
      } catch (error) {
        await this.disposeKey(key).catch(() => {});
        return {
          kind: "failed",
          serverKind,
          displayName: resolution.displayName,
          errorCode: "lsp_start_failed",
          message: error instanceof Error ? error.message : "Failed to start language server",
          autoInstallSupported: false,
          missingCommands: [],
          missingPrerequisites: [],
        };
      }
    }

    const session = this.createSession({
      workspaceId: input.workspaceId,
      workspacePath: workspace.path,
      spec,
      requestTimeoutMs: this.deps.requestTimeoutMs,
      logger: this.deps.logger,
      onDiagnostics: (payload) =>
        this.deps.eventBus.emit({
          type: "lsp.diagnostics.updated",
          ...payload,
        }),
    });

    this.sessions.set(key, { session, idleTimer: null });

    try {
      const summary = await session.start();
      this.bumpActivity(key);
      return {
        kind: "ready",
        summary,
        displayName: resolution.displayName,
        source: resolution.source,
      };
    } catch (error) {
      await this.disposeKey(key).catch(() => {});
      return {
        kind: "failed",
        serverKind,
        displayName: resolution.displayName,
        errorCode: "lsp_start_failed",
        message: error instanceof Error ? error.message : "Failed to start language server",
        autoInstallSupported: false,
        missingCommands: [],
        missingPrerequisites: [],
      };
    }
  }

  async openDocument(input: {
    workspaceId: string;
    path: string;
    languageId: string;
    text: string;
  }): Promise<number | null> {
    const session = await this.getSessionForPath(input.workspaceId, input.path);
    return session ? await session.openDocument(input) : null;
  }

  async changeDocument(input: {
    workspaceId: string;
    path: string;
    text: string;
  }): Promise<number | null> {
    const session = await this.getSessionForPath(input.workspaceId, input.path);
    return session ? await session.changeDocument(input.path, input.text) : null;
  }

  async closeDocument(input: { workspaceId: string; path: string }): Promise<void> {
    const existing = this.getExistingSessionForPath(input.workspaceId, input.path);
    if (!existing) {
      return;
    }

    await existing.entry.session.closeDocument(input.path);
    this.bumpActivity(existing.key);
  }

  async definition(input: {
    workspaceId: string;
    path: string;
    line: number;
    column: number;
  }): Promise<LspLocation[] | null> {
    const session = await this.getSessionForPath(input.workspaceId, input.path);
    return session ? await session.definition(input) : null;
  }

  async references(input: {
    workspaceId: string;
    path: string;
    line: number;
    column: number;
  }): Promise<LspLocation[] | null> {
    const session = await this.getSessionForPath(input.workspaceId, input.path);
    return session ? await session.references(input) : null;
  }

  async declaration(input: {
    workspaceId: string;
    path: string;
    line: number;
    column: number;
  }): Promise<LspLocation[] | null> {
    const session = await this.getSessionForPath(input.workspaceId, input.path);
    return session ? await session.declaration(input) : null;
  }

  async typeDefinition(input: {
    workspaceId: string;
    path: string;
    line: number;
    column: number;
  }): Promise<LspLocation[] | null> {
    const session = await this.getSessionForPath(input.workspaceId, input.path);
    return session ? await session.typeDefinition(input) : null;
  }

  async hover(input: { workspaceId: string; path: string; line: number; column: number }) {
    const session = await this.getSessionForPath(input.workspaceId, input.path);
    return session ? await session.hover(input) : null;
  }

  async documentSymbols(input: { workspaceId: string; path: string }) {
    const session = await this.getSessionForPath(input.workspaceId, input.path);
    return session ? await session.documentSymbols(input) : null;
  }

  async disposeWorkspace(workspaceId: string): Promise<void> {
    const keys = Array.from(this.sessions.keys()).filter((key) =>
      key.startsWith(`${workspaceId}::`)
    );

    for (const key of keys) {
      await this.disposeKey(key);
    }
  }

  async disposeAll(): Promise<void> {
    for (const key of Array.from(this.sessions.keys())) {
      await this.disposeKey(key);
    }
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  private createSession(deps: LspSessionDeps): LspSessionLike {
    return this.deps.createSession ? this.deps.createSession(deps) : new LspSession(deps);
  }

  private async getSessionForPath(
    workspaceId: string,
    path: string
  ): Promise<LspSessionLike | null> {
    const readiness = await this.ensureSession({ workspaceId, path });
    if (readiness.kind !== "ready") {
      return null;
    }

    const key = this.keyFor(workspaceId, readiness.summary.serverKind);
    this.bumpActivity(key);
    return this.sessions.get(key)?.session ?? null;
  }

  private getExistingSessionForPath(workspaceId: string, path: string): SessionLookupResult | null {
    const workspace = this.deps.workspaceMgr.get(workspaceId);
    if (!workspace) {
      return null;
    }

    const serverKind = resolveLspServerKind(path);
    if (!serverKind) {
      return null;
    }

    const key = this.keyFor(workspaceId, serverKind);
    const entry = this.sessions.get(key);
    if (!entry) {
      return null;
    }

    return { key, entry };
  }

  private bumpActivity(key: string): void {
    const entry = this.sessions.get(key);
    if (!entry) {
      return;
    }

    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
    }

    const timer = setTimeout(() => {
      void this.disposeKey(key).catch((error) => {
        this.deps.logger.warn({ err: error, key }, "failed to dispose idle lsp session");
      });
    }, this.deps.idleTtlMs);
    timer.unref?.();
    entry.idleTimer = timer;
  }

  private async disposeKey(key: string): Promise<void> {
    const entry = this.sessions.get(key);
    if (!entry) {
      return;
    }

    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
    }

    this.sessions.delete(key);
    await entry.session.stop();
  }

  private keyFor(workspaceId: string, serverKind: string): string {
    return `${workspaceId}::${serverKind}`;
  }
}
