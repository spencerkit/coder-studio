import { type ChildProcess, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type {
  LspDiagnostic,
  LspDiagnosticsEvent,
  LspDocumentSymbol,
  LspHoverResult,
  LspLocation,
  LspRange,
  LspServerKind,
  LspSessionSummary,
} from "@coder-studio/core";
import { shouldUseShellForCommand } from "@coder-studio/utils";
import { type MessageConnection, NotificationType, RequestType } from "vscode-jsonrpc";
import { DocumentStore } from "./document-store.js";
import type { LspServerSpec } from "./server-factory.js";
import { type BridgeHandle, bridgeTsserverRequests } from "./tsserver-bridge.js";

const require = createRequire(import.meta.url);
type VscodeJsonrpcNode = typeof import("vscode-jsonrpc/node");
const { createMessageConnection, StreamMessageReader, StreamMessageWriter } =
  require("vscode-jsonrpc/node.js") as VscodeJsonrpcNode;

const PublishDiagnosticsNotification = new NotificationType<PublishDiagnosticsParams>(
  "textDocument/publishDiagnostics"
);
const DefinitionRequest = new RequestType<PositionParams, unknown, void>("textDocument/definition");
const DeclarationRequest = new RequestType<PositionParams, unknown, void>(
  "textDocument/declaration"
);
const TypeDefinitionRequest = new RequestType<PositionParams, unknown, void>(
  "textDocument/typeDefinition"
);
const ReferencesRequest = new RequestType<PositionParams, unknown, void>("textDocument/references");
const HoverRequest = new RequestType<PositionParams, unknown, void>("textDocument/hover");
const DocumentSymbolsRequest = new RequestType<TextDocumentParams, unknown, void>(
  "textDocument/documentSymbol"
);
const LSP_REQUEST_TIMEOUT_MESSAGE = "LSP request timed out";

interface SessionDeps {
  workspaceId: string;
  workspacePath: string;
  spec: LspServerSpec;
  onDiagnostics: (event: LspDiagnosticsEvent) => void;
  /**
   * Per-request timeout for semantic queries (hover, definition, references,
   * documentSymbols, …). Keep this short enough that the editor's hover
   * popup doesn't show "loading" forever when the server is wedged.
   */
  requestTimeoutMs: number;
  /**
   * Timeout for the LSP `initialize` request. Some servers (notably
   * rust-analyzer) need to scan Cargo workspaces and load proc-macros on
   * first boot, which can routinely take 20s+ in real projects. Defaults
   * to `requestTimeoutMs * 10` so existing callers don't regress.
   */
  initializeTimeoutMs?: number;
  platform?: NodeJS.Platform;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  spawnProcess?: typeof spawn;
}

interface TextDocumentParams {
  textDocument: {
    uri: string;
  };
}

interface PositionParams extends TextDocumentParams {
  position: {
    line: number;
    character: number;
  };
}

interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: Array<{
    message: string;
    severity?: number;
    code?: string | number;
    source?: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  }>;
}

interface LocationLike {
  uri: string;
  range: RangeLike;
}

interface LocationLinkLike {
  targetUri: string;
  targetRange: RangeLike;
  targetSelectionRange?: RangeLike;
}

interface SymbolLike {
  name: string;
  kind: number;
  range: RangeLike;
  selectionRange: RangeLike;
  children?: SymbolLike[];
}

interface SymbolInformationLike {
  name: string;
  kind: number;
  location: LocationLike;
}

interface RangeLike {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface ChildLink {
  child: ChildProcess;
  connection: MessageConnection;
  label: "primary" | "companion";
}

export class LspSession {
  private readonly documents: DocumentStore;
  private child: ChildProcess | null = null;
  private connection: MessageConnection | null = null;
  private companion: ChildLink | null = null;
  private bridgeHandle: BridgeHandle | null = null;
  private startPromise: Promise<LspSessionSummary> | null = null;
  private summary: LspSessionSummary;

  constructor(private readonly deps: SessionDeps) {
    this.documents = new DocumentStore(deps.workspacePath);
    this.summary = {
      workspaceId: deps.workspaceId,
      serverKind: deps.spec.serverKind,
      status: "starting",
      capabilities: {
        definition: false,
        declaration: false,
        typeDefinition: false,
        references: false,
        hover: false,
        documentSymbols: false,
        diagnostics: true,
      },
    };
  }

  async start(): Promise<LspSessionSummary> {
    if (this.connection && this.summary.status === "ready") {
      return this.summary;
    }

    if (this.startPromise) {
      return await this.startPromise;
    }

    this.summary = {
      ...this.summary,
      status: "starting",
    };

    const startPromise = this.startConnection();
    this.startPromise = startPromise;

    try {
      return await startPromise;
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = null;
      }
    }
  }

  private async startConnection(): Promise<LspSessionSummary> {
    const platform = this.deps.platform ?? process.platform;
    const spawnProcess = this.deps.spawnProcess ?? spawn;
    const child = spawnProcess(this.deps.spec.command, this.deps.spec.args, {
      cwd: this.deps.spec.rootPath,
      stdio: ["pipe", "pipe", "pipe"],
      shell: shouldUseShellForCommand(this.deps.spec.command, platform),
      windowsHide: true,
    });
    this.child = child;

    if (!child.stdin || !child.stdout) {
      throw new Error("Failed to start LSP process stdio");
    }

    this.attachStderr(child, "primary");

    child.once("exit", () => {
      this.handleChildTermination(child);
    });
    child.once("error", (error) => {
      this.deps.logger.error({ err: error }, "lsp child process error");
      this.handleChildTermination(child);
    });

    this.connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin)
    );

    this.connection.onNotification(PublishDiagnosticsNotification, (params) => {
      const filePath = this.documents.fromUri(params.uri);
      if (!filePath) {
        return;
      }

      const doc = this.documents.get(filePath);

      this.deps.onDiagnostics({
        workspaceId: this.deps.workspaceId,
        serverKind: this.deps.spec.serverKind,
        path: filePath,
        version: doc?.version,
        diagnostics: params.diagnostics.map(toSharedDiagnostic),
      });
    });

    this.connection.listen();

    let companion: ChildLink | null = null;
    if (this.deps.spec.companion) {
      try {
        companion = this.startCompanion(spawnProcess, platform);
      } catch (error) {
        child.kill("SIGTERM");
        throw error;
      }
      this.companion = companion;
    }

    if (companion && this.deps.spec.bridges?.tsserverRequest) {
      this.bridgeHandle = bridgeTsserverRequests(
        {
          primary: this.connection,
          companion: companion.connection,
        },
        {
          timeoutMs: this.deps.requestTimeoutMs,
          logger: this.deps.logger,
        }
      );
    }

    try {
      const initTimeoutMs = this.deps.initializeTimeoutMs ?? this.deps.requestTimeoutMs * 10;
      const [initializeResult] = await Promise.all([
        this.withTimeout(
          this.connection.sendRequest("initialize", {
            processId: process.pid,
            rootUri: pathToFileURL(this.deps.spec.rootPath).toString(),
            capabilities: {},
            initializationOptions: this.deps.spec.initializationOptions,
          }),
          initTimeoutMs
        ),
        companion
          ? this.withTimeout(
              companion.connection.sendRequest("initialize", {
                processId: process.pid,
                rootUri: pathToFileURL(this.deps.spec.rootPath).toString(),
                capabilities: {},
                initializationOptions: this.deps.spec.companion?.initializationOptions,
              }),
              initTimeoutMs
            )
          : Promise.resolve(null),
      ]);

      this.sendNotification("initialized", {});
      if (companion) {
        this.sendNotificationOn(companion.connection, "initialized", {});
      }

      for (const doc of this.documents.listReplayable()) {
        const didOpenParams = {
          textDocument: {
            uri: doc.uri,
            languageId: doc.languageId,
            version: doc.version,
            text: doc.text,
          },
        };
        this.sendNotification("textDocument/didOpen", didOpenParams);
        if (companion) {
          this.sendNotificationOn(companion.connection, "textDocument/didOpen", didOpenParams);
        }
      }

      this.summary = {
        ...this.summary,
        status: "ready",
        capabilities: {
          definition: Boolean(
            (initializeResult as { capabilities?: Record<string, unknown> }).capabilities
              ?.definitionProvider
          ),
          declaration: Boolean(
            (initializeResult as { capabilities?: Record<string, unknown> }).capabilities
              ?.declarationProvider
          ),
          typeDefinition: Boolean(
            (initializeResult as { capabilities?: Record<string, unknown> }).capabilities
              ?.typeDefinitionProvider
          ),
          references: Boolean(
            (initializeResult as { capabilities?: Record<string, unknown> }).capabilities
              ?.referencesProvider
          ),
          hover: Boolean(
            (initializeResult as { capabilities?: Record<string, unknown> }).capabilities
              ?.hoverProvider
          ),
          documentSymbols: Boolean(
            (initializeResult as { capabilities?: Record<string, unknown> }).capabilities
              ?.documentSymbolProvider
          ),
          diagnostics: true,
        },
      };

      return this.summary;
    } catch (error) {
      this.recoverFromRequestFailure(error);
      throw error;
    }
  }

  async openDocument(input: { path: string; languageId: string; text: string }): Promise<number> {
    await this.start();
    const doc = this.documents.open(input);
    const params = {
      textDocument: {
        uri: doc.uri,
        languageId: doc.languageId,
        version: doc.version,
        text: doc.text,
      },
    };
    this.broadcastNotification("textDocument/didOpen", params);
    return doc.version;
  }

  async changeDocument(path: string, text: string): Promise<number> {
    if (!this.documents.get(path)) {
      throw new Error(`LSP document not open: ${path}`);
    }

    await this.start();
    const doc = this.documents.change(path, text);
    this.broadcastNotification("textDocument/didChange", {
      textDocument: {
        uri: doc.uri,
        version: doc.version,
      },
      contentChanges: [{ text: doc.text }],
    });
    return doc.version;
  }

  async closeDocument(path: string): Promise<void> {
    const doc = this.documents.get(path);
    if (!doc) {
      return;
    }

    if (!this.connection) {
      this.documents.close(path);
      return;
    }

    this.broadcastNotification("textDocument/didClose", {
      textDocument: { uri: doc.uri },
    });
    this.documents.close(path);
  }

  async definition(input: {
    path: string;
    line: number;
    column: number;
  }): Promise<LspLocation[] | null> {
    return this.locationsAcrossConnections(DefinitionRequest, "definition", input);
  }

  async references(input: {
    path: string;
    line: number;
    column: number;
  }): Promise<LspLocation[] | null> {
    return this.locationsAcrossConnections(ReferencesRequest, "references", input);
  }

  async declaration(input: {
    path: string;
    line: number;
    column: number;
  }): Promise<LspLocation[] | null> {
    return this.locationsAcrossConnections(DeclarationRequest, "declaration", input);
  }

  async typeDefinition(input: {
    path: string;
    line: number;
    column: number;
  }): Promise<LspLocation[] | null> {
    return this.locationsAcrossConnections(TypeDefinitionRequest, "type definition", input);
  }

  async hover(input: {
    path: string;
    line: number;
    column: number;
  }): Promise<LspHoverResult | null> {
    const doc = this.documents.get(input.path);
    if (!doc) {
      return null;
    }

    try {
      await this.start();
      if (!this.connection) {
        return null;
      }

      // Volar 3.x intentionally delegates TS-semantic hover to a TypeScript
      // server that has @vue/typescript-plugin loaded. Volar itself only
      // returns Vue-specific hovers (template / directives / SFC structure).
      // Fan out to both ends when a companion is configured, then merge.
      const params = {
        textDocument: { uri: doc.uri },
        position: { line: input.line - 1, character: input.column - 1 },
      };

      const targets: Array<{
        label: "primary" | "companion";
        connection: MessageConnection;
      }> = [{ label: "primary", connection: this.connection }];
      if (this.companion) {
        targets.push({ label: "companion", connection: this.companion.connection });
      }

      const results = await Promise.allSettled(
        targets.map(({ connection }) =>
          this.withTimeout(connection.sendRequest(HoverRequest, params))
        )
      );

      const hovers: Array<{ contents: string[]; range?: LspRange }> = [];
      let timedOut = false;
      results.forEach((res, idx) => {
        if (res.status === "rejected") {
          if (res.reason instanceof LspRequestTimeoutError) {
            timedOut = true;
          }
          this.deps.logger.warn(
            { error: res.reason, source: targets[idx]?.label },
            "lsp hover request failed"
          );
          return;
        }
        const value = res.value;
        if (!value) {
          return;
        }
        const contents = toHoverContents((value as { contents?: unknown }).contents);
        const rawRange =
          typeof value === "object" &&
          value !== null &&
          "range" in value &&
          (value as { range?: LocationLike["range"] }).range
            ? (value as { range: LocationLike["range"] }).range
            : null;
        hovers.push({
          contents,
          range: rawRange ? toSharedRange(rawRange) : undefined,
        });
      });

      if (timedOut) {
        // Stay defensive: if any leg timed out we already restarted the session
        // via recoverFromRequestFailure for that leg.
        this.recoverFromRequestFailure(new LspRequestTimeoutError());
      }

      if (hovers.length === 0) {
        return null;
      }
      // Prefer the companion (TS-server) range when present since it's
      // expressed against the SFC source positions, then fall back to whatever
      // we have.
      const mergedContents = hovers
        .flatMap((entry) => entry.contents)
        .filter((value) => value.length > 0);
      const range = hovers.find((entry) => entry.range)?.range;
      if (mergedContents.length === 0) {
        return null;
      }
      return { contents: mergedContents, range, version: doc.version };
    } catch (error) {
      this.recoverFromRequestFailure(error);
      this.deps.logger.warn({ error }, "lsp hover request failed");
      return null;
    }
  }

  async documentSymbols(input: { path: string }): Promise<LspDocumentSymbol[] | null> {
    const doc = this.documents.get(input.path);
    if (!doc) {
      return null;
    }

    try {
      await this.start();
      if (!this.connection) {
        return null;
      }

      const result = await this.withTimeout(
        this.connection.sendRequest(DocumentSymbolsRequest, {
          textDocument: { uri: doc.uri },
        })
      );

      return Array.isArray(result)
        ? result
            .map((item) => toSharedSymbolEntry(item))
            .filter((value): value is LspDocumentSymbol => value !== null)
        : [];
    } catch (error) {
      this.recoverFromRequestFailure(error);
      this.deps.logger.warn({ error }, "lsp document symbols request failed");
      return [];
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    const companionChild = this.companion?.child ?? null;
    this.resetConnectionState();
    child?.kill("SIGTERM");
    companionChild?.kill("SIGTERM");
  }

  getSummary(): LspSessionSummary {
    return this.summary;
  }

  listReplayableDocuments(): Array<{
    path: string;
    uri: string;
    languageId: string;
    text: string;
    version: number;
    open: boolean;
  }> {
    return this.documents.listReplayable();
  }

  private async locationsAcrossConnections(
    type: RequestType<PositionParams, unknown, void>,
    label: string,
    input: { path: string; line: number; column: number }
  ): Promise<LspLocation[] | null> {
    if (!this.documents.get(input.path)) {
      return null;
    }

    try {
      await this.start();
    } catch (error) {
      this.deps.logger.warn({ error, label }, `lsp ${label} start failed`);
      return [];
    }

    const doc = this.documents.get(input.path);
    if (!doc || !this.connection) {
      return [];
    }

    const params = {
      textDocument: { uri: doc.uri },
      position: { line: input.line - 1, character: input.column - 1 },
    };

    const targets: Array<{
      label: "primary" | "companion";
      connection: MessageConnection;
    }> = [{ label: "primary", connection: this.connection }];
    if (this.companion) {
      targets.push({ label: "companion", connection: this.companion.connection });
    }

    const results = await Promise.allSettled(
      targets.map(({ connection }) => this.withTimeout(connection.sendRequest(type, params)))
    );

    const merged: LspLocation[] = [];
    const seen = new Set<string>();
    let timedOut = false;
    results.forEach((res, idx) => {
      if (res.status === "rejected") {
        if (res.reason instanceof LspRequestTimeoutError) {
          timedOut = true;
        }
        this.deps.logger.warn(
          { error: res.reason, label, source: targets[idx]?.label },
          `lsp ${label} request failed`
        );
        return;
      }
      const locations = normalizeLocations(res.value, this.documents) ?? [];
      for (const location of locations) {
        const key = `${location.path}:${location.range.startLine}:${location.range.startColumn}:${location.range.endLine}:${location.range.endColumn}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        merged.push(location);
      }
    });

    if (timedOut) {
      this.recoverFromRequestFailure(new LspRequestTimeoutError());
    }

    return merged;
  }

  private async withTimeout<T>(promise: Promise<T>, overrideMs?: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeoutMs = overrideMs ?? this.deps.requestTimeoutMs;

    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new LspRequestTimeoutError()), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private sendNotification(method: string, params: unknown): void {
    const connection = this.connection;
    if (!connection) {
      return;
    }

    this.sendNotificationOn(connection, method, params);
  }

  private sendNotificationOn(connection: MessageConnection, method: string, params: unknown): void {
    void connection.sendNotification(method, params).catch((error) => {
      this.deps.logger.warn({ error, method }, "lsp notification send failed");
    });
  }

  private broadcastNotification(method: string, params: unknown): void {
    this.sendNotification(method, params);
    const companion = this.companion;
    if (companion) {
      this.sendNotificationOn(companion.connection, method, params);
    }
  }

  private attachStderr(child: ChildProcess, label: ChildLink["label"]): void {
    child.stderr?.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (!message) {
        return;
      }

      this.deps.logger.warn(
        {
          serverKind: this.deps.spec.serverKind,
          companion: label === "companion" ? true : undefined,
          stderr: message,
        },
        "lsp child stderr"
      );
    });
  }

  private startCompanion(spawnProcess: typeof spawn, platform: NodeJS.Platform): ChildLink {
    const companionSpec = this.deps.spec.companion;
    if (!companionSpec) {
      throw new Error("startCompanion called without companion spec");
    }

    const companionChild = spawnProcess(companionSpec.command, companionSpec.args, {
      cwd: this.deps.spec.rootPath,
      stdio: ["pipe", "pipe", "pipe"],
      shell: shouldUseShellForCommand(companionSpec.command, platform),
      windowsHide: true,
    });

    if (!companionChild.stdin || !companionChild.stdout) {
      throw new Error("Failed to start LSP companion stdio");
    }

    this.attachStderr(companionChild, "companion");

    companionChild.once("exit", () => {
      this.handleChildTermination(companionChild);
    });
    companionChild.once("error", (error) => {
      this.deps.logger.error({ err: error }, "lsp companion process error");
      this.handleChildTermination(companionChild);
    });

    const companionConnection = createMessageConnection(
      new StreamMessageReader(companionChild.stdout),
      new StreamMessageWriter(companionChild.stdin)
    );
    companionConnection.listen();

    return { child: companionChild, connection: companionConnection, label: "companion" };
  }

  private handleChildTermination(child: ChildProcess): void {
    if (this.child !== child && this.companion?.child !== child) {
      return;
    }

    this.resetConnectionState();
  }

  private resetConnectionState(): void {
    this.bridgeHandle?.dispose();
    this.bridgeHandle = null;
    this.connection = null;
    this.child = null;
    const companion = this.companion;
    this.companion = null;
    companion?.child.kill("SIGTERM");
    this.summary = {
      ...this.summary,
      status: "stopped",
    };
  }

  private recoverFromRequestFailure(error: unknown): void {
    if (!(error instanceof LspRequestTimeoutError)) {
      return;
    }

    const child = this.child;
    const companionChild = this.companion?.child ?? null;
    this.resetConnectionState();
    child?.kill("SIGTERM");
    companionChild?.kill("SIGTERM");
  }
}

class LspRequestTimeoutError extends Error {
  constructor() {
    super(LSP_REQUEST_TIMEOUT_MESSAGE);
    this.name = "LspRequestTimeoutError";
  }
}

function toSharedRange(range: RangeLike): LspRange {
  return {
    startLine: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLine: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

function toSharedDiagnostic(input: PublishDiagnosticsParams["diagnostics"][number]): LspDiagnostic {
  return {
    message: input.message,
    severity:
      input.severity === 1
        ? "error"
        : input.severity === 2
          ? "warning"
          : input.severity === 3
            ? "info"
            : "hint",
    code: input.code === undefined ? undefined : String(input.code),
    source: input.source,
    range: toSharedRange(input.range),
  };
}

function toHoverContents(contents: unknown): string[] {
  if (!contents) {
    return [];
  }

  if (Array.isArray(contents)) {
    return contents.flatMap((item) => toHoverContents(item));
  }

  if (typeof contents === "string") {
    return [contents];
  }

  if (typeof contents === "object" && contents !== null && "value" in contents) {
    const value = (contents as { value?: unknown }).value;
    return typeof value === "string" ? [value] : [];
  }

  return [];
}

function normalizeLocations(result: unknown, documents: DocumentStore): LspLocation[] | null {
  const items = Array.isArray(result) ? result : result ? [result] : [];

  if (items.length === 0) {
    return Array.isArray(result) ? [] : null;
  }

  return items
    .map((item) => toSharedLocation(item, documents))
    .filter((value): value is LspLocation => value !== null);
}

function toSharedLocation(input: unknown, documents: DocumentStore): LspLocation | null {
  if (isLocationLike(input)) {
    const filePath = documents.fromUri(input.uri);
    if (!filePath) {
      return null;
    }

    return {
      path: filePath,
      range: toSharedRange(input.range),
    };
  }

  if (isLocationLinkLike(input)) {
    const filePath = documents.fromUri(input.targetUri);
    if (!filePath) {
      return null;
    }

    return {
      path: filePath,
      range: toSharedRange(input.targetSelectionRange ?? input.targetRange),
    };
  }

  return null;
}

function toSharedSymbol(input: SymbolLike): LspDocumentSymbol {
  return {
    name: input.name,
    kind: input.kind,
    range: toSharedRange(input.range),
    selectionRange: toSharedRange(input.selectionRange),
    children: Array.isArray(input.children)
      ? input.children.map((child) => toSharedSymbol(child))
      : undefined,
  };
}

function toSharedSymbolEntry(input: unknown): LspDocumentSymbol | null {
  if (isDocumentSymbolLike(input)) {
    return toSharedSymbol(input);
  }

  if (isSymbolInformationLike(input)) {
    return {
      name: input.name,
      kind: input.kind,
      range: toSharedRange(input.location.range),
      selectionRange: toSharedRange(input.location.range),
    };
  }

  return null;
}

function isRangeLike(input: unknown): input is RangeLike {
  return typeof input === "object" && input !== null && "start" in input && "end" in input;
}

function isLocationLike(input: unknown): input is LocationLike {
  return (
    typeof input === "object" &&
    input !== null &&
    "uri" in input &&
    typeof (input as { uri?: unknown }).uri === "string" &&
    "range" in input &&
    isRangeLike((input as { range?: unknown }).range)
  );
}

function isLocationLinkLike(input: unknown): input is LocationLinkLike {
  return (
    typeof input === "object" &&
    input !== null &&
    "targetUri" in input &&
    typeof (input as { targetUri?: unknown }).targetUri === "string" &&
    "targetRange" in input &&
    isRangeLike((input as { targetRange?: unknown }).targetRange)
  );
}

function isDocumentSymbolLike(input: unknown): input is SymbolLike {
  return (
    typeof input === "object" &&
    input !== null &&
    "name" in input &&
    typeof (input as { name?: unknown }).name === "string" &&
    "kind" in input &&
    typeof (input as { kind?: unknown }).kind === "number" &&
    "range" in input &&
    isRangeLike((input as { range?: unknown }).range) &&
    "selectionRange" in input &&
    isRangeLike((input as { selectionRange?: unknown }).selectionRange)
  );
}

function isSymbolInformationLike(input: unknown): input is SymbolInformationLike {
  return (
    typeof input === "object" &&
    input !== null &&
    "name" in input &&
    typeof (input as { name?: unknown }).name === "string" &&
    "kind" in input &&
    typeof (input as { kind?: unknown }).kind === "number" &&
    "location" in input &&
    isLocationLike((input as { location?: unknown }).location)
  );
}
