import type {
  LspDiagnosticsEvent,
  LspDocumentSymbol,
  LspEnsureSessionResult,
  LspHoverResult,
  LspLocation,
  LspSemanticTokens,
  LspToolInstallJobSnapshot,
} from "@coder-studio/core";
import { Topics } from "@coder-studio/core";
import * as monaco from "monaco-editor";
import { detectEditorLanguage } from "../monaco/language";
import { monacoModelRegistry } from "../monaco/model-registry";
import { toWorkspaceFileUri } from "../monaco/uri";
import { createDiagnosticsController } from "./diagnostics";
import { resolveLspServerKind } from "./language-map";
import { createLspProviderRegistry } from "./providers";

type LspBridgeTransport = {
  sendCommand: <T = unknown>(op: string, args: unknown) => Promise<T>;
  subscribe: (topics: string[], handler: (topic: string, payload: unknown) => void) => () => void;
};

type AttachedModel = {
  workspaceId: string;
  workspaceRootPath: string;
  path: string;
  monacoLanguage: string;
  model: monaco.editor.ITextModel;
};

type WorkspaceSubscription = {
  topic: string;
  refCount: number;
  workspaceRootPath: string;
  unsubscribe: () => void;
  handleEvent: (topic: string, payload: unknown) => void;
};

export type LspBridgeState =
  | { kind: "ready" | "unsupported_language" }
  | (Exclude<LspEnsureSessionResult, { kind: "ready" | "unsupported_language" }> & {
      installJob?: LspToolInstallJobSnapshot;
    });

type AttachedModelHandle = (() => void) & {
  install: () => Promise<void>;
  retry: () => Promise<void>;
};

const noopTransport: LspBridgeTransport = {
  sendCommand: async <T>() => null as T,
  subscribe: () => () => {},
};

type InstallableReadiness = Extract<
  LspEnsureSessionResult,
  { kind: "tool_missing" | "installing" | "failed" }
>;

type FileReadTextPayload = {
  kind: "text";
  content: string;
  baseHash: string;
  encoding: "utf-8";
};

function isInstallableReadiness(
  readiness: LspEnsureSessionResult
): readiness is InstallableReadiness {
  return (
    readiness.kind === "tool_missing" ||
    readiness.kind === "installing" ||
    readiness.kind === "failed"
  );
}

export function createLspBridge(initialTransport: Partial<LspBridgeTransport> = {}) {
  let transport: LspBridgeTransport = {
    ...noopTransport,
    ...initialTransport,
  };
  const models = new Map<string, AttachedModel>();
  const diagnostics = createDiagnosticsController();
  const workspaceSubscriptions = new Map<string, WorkspaceSubscription>();
  const changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const installPollTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const providers = createLspProviderRegistry({
    lookupModelMetadata: (model) => {
      const meta = models.get(model.uri.toString());
      if (!meta) {
        return undefined;
      }

      return {
        workspaceId: meta.workspaceId,
        workspaceRootPath: meta.workspaceRootPath,
        path: meta.path,
      };
    },
    requestDefinition: async ({ meta, line, column }) =>
      await transport.sendCommand<LspLocation[] | null>("lsp.definition", {
        workspaceId: meta.workspaceId,
        path: meta.path,
        line,
        column,
      }),
    requestDeclaration: async ({ meta, line, column }) =>
      await transport.sendCommand<LspLocation[] | null>("lsp.declaration", {
        workspaceId: meta.workspaceId,
        path: meta.path,
        line,
        column,
      }),
    requestTypeDefinition: async ({ meta, line, column }) =>
      await transport.sendCommand<LspLocation[] | null>("lsp.typeDefinition", {
        workspaceId: meta.workspaceId,
        path: meta.path,
        line,
        column,
      }),
    requestHover: async ({ meta, line, column }) =>
      await transport.sendCommand<LspHoverResult | null>("lsp.hover", {
        workspaceId: meta.workspaceId,
        path: meta.path,
        line,
        column,
      }),
    requestReferences: async ({ meta, line, column }) =>
      await transport.sendCommand<LspLocation[] | null>("lsp.references", {
        workspaceId: meta.workspaceId,
        path: meta.path,
        line,
        column,
      }),
    requestDocumentSymbols: async ({ meta }) =>
      await transport.sendCommand<LspDocumentSymbol[] | null>("lsp.documentSymbols", {
        workspaceId: meta.workspaceId,
        path: meta.path,
      }),
    requestSemanticTokens: async ({ meta }) =>
      await transport.sendCommand<LspSemanticTokens | null>("lsp.semanticTokens", {
        workspaceId: meta.workspaceId,
        path: meta.path,
      }),
    ensureLocationModel: async ({ meta, location }) => {
      const uri = toWorkspaceFileUri(meta.workspaceRootPath, location.path);
      if (monaco.editor.getModel(uri)) {
        return;
      }

      const result = await transport.sendCommand<FileReadTextPayload | { kind: "image" } | null>(
        "file.read",
        {
          workspaceId: meta.workspaceId,
          path: location.path,
        }
      );

      if (!result || result.kind !== "text") {
        return;
      }

      monacoModelRegistry.getOrCreate({
        workspaceRootPath: meta.workspaceRootPath,
        path: location.path,
        language: detectEditorLanguage(location.path),
        content: result.content,
      });
    },
  });

  function configure(nextTransport: Partial<LspBridgeTransport>): void {
    transport = {
      ...transport,
      ...nextTransport,
    };

    if (!nextTransport.subscribe) {
      return;
    }

    for (const subscription of workspaceSubscriptions.values()) {
      subscription.unsubscribe();
      subscription.unsubscribe = transport.subscribe(
        [subscription.topic],
        subscription.handleEvent
      );
    }
  }

  function attachModel(
    input: AttachedModel,
    onStateChange?: (state: LspBridgeState) => void
  ): AttachedModelHandle {
    const serverKind = resolveLspServerKind(input.path, input.monacoLanguage);
    if (!serverKind) {
      onStateChange?.({ kind: "unsupported_language" });
      const noopHandle = Object.assign(() => {}, {
        install: async () => {},
        retry: async () => {},
      });
      return noopHandle;
    }

    const key = input.model.uri.toString();
    let detached = false;
    let currentJobId: string | undefined;
    models.set(key, input);
    providers.register(resolveMonacoProviderLanguageId(input.monacoLanguage));
    ensureDiagnosticsSubscription(input.workspaceId, input.workspaceRootPath);

    const ensureReady = async (): Promise<void> => {
      const readiness = await transport.sendCommand<LspEnsureSessionResult>("lsp.ensureSession", {
        workspaceId: input.workspaceId,
        path: input.path,
      });

      if (readiness.kind !== "ready") {
        onStateChange?.(readiness);
        if (isInstallableReadiness(readiness) && readiness.installJob) {
          currentJobId = readiness.installJob.jobId;
          schedulePoll();
        }
        return;
      }

      onStateChange?.({ kind: "ready" });

      if (readiness.summary.serverKind !== serverKind || detached || models.get(key) !== input) {
        return;
      }

      await transport.sendCommand("lsp.openDocument", {
        workspaceId: input.workspaceId,
        path: input.path,
        languageId: input.monacoLanguage,
        text: input.model.getValue(),
      });
    };

    const pollInstallJob = async () => {
      if (!currentJobId || detached) {
        return;
      }

      const job = await transport.sendCommand<LspToolInstallJobSnapshot>("lsp.install.get", {
        jobId: currentJobId,
        workspaceId: input.workspaceId,
      });

      if (job.status === "queued" || job.status === "running") {
        onStateChange?.({
          kind: "installing",
          serverKind,
          displayName: `${serverKind} language server`,
          errorCode: "lsp_install_in_progress",
          message: "Install in progress",
          autoInstallSupported: true,
          missingCommands: [],
          missingPrerequisites: [],
          installJob: job,
        });
        schedulePoll();
        return;
      }

      if (job.status === "failed") {
        onStateChange?.({
          kind: "failed",
          serverKind,
          displayName: `${serverKind} language server`,
          errorCode: "lsp_install_failed",
          message: job.failure?.message ?? "Install failed",
          autoInstallSupported: true,
          missingCommands: job.failure?.missingCommands ?? [],
          missingPrerequisites: [],
          installJob: job,
        });
        return;
      }

      currentJobId = undefined;
      await ensureReady().catch(() => null);
    };

    const schedulePoll = () => {
      clearTimeout(installPollTimers.get(key));
      installPollTimers.set(
        key,
        setTimeout(() => {
          void pollInstallJob().catch(() => null);
        }, 1500)
      );
    };

    void ensureReady().catch(() => null);

    const changeDisposable = input.model.onDidChangeContent(() => {
      clearTimeout(changeTimers.get(key));
      changeTimers.set(
        key,
        setTimeout(() => {
          void transport
            .sendCommand("lsp.changeDocument", {
              workspaceId: input.workspaceId,
              path: input.path,
              text: input.model.getValue(),
            })
            .catch(() => null);
        }, 75)
      );
    });

    const detach = () => {
      detached = true;
      clearTimeout(changeTimers.get(key));
      changeTimers.delete(key);
      clearTimeout(installPollTimers.get(key));
      installPollTimers.delete(key);
      models.delete(key);
      diagnostics.clearFile(input.workspaceRootPath, input.path);
      changeDisposable.dispose();
      releaseDiagnosticsSubscription(input.workspaceId);

      void transport
        .sendCommand("lsp.closeDocument", {
          workspaceId: input.workspaceId,
          path: input.path,
        })
        .catch(() => null);
    };

    return Object.assign(detach, {
      install: async () => {
        const job = await transport.sendCommand<LspToolInstallJobSnapshot>("lsp.install.start", {
          workspaceId: input.workspaceId,
          serverKind,
        });
        currentJobId = job.jobId;
        onStateChange?.({
          kind: job.status === "failed" ? "failed" : "installing",
          serverKind,
          displayName: `${serverKind} language server`,
          errorCode: job.status === "failed" ? "lsp_install_failed" : "lsp_install_in_progress",
          message: job.failure?.message ?? "Install in progress",
          autoInstallSupported: true,
          missingCommands: job.failure?.missingCommands ?? [],
          missingPrerequisites: [],
          installJob: job,
        });
        if (job.status === "queued" || job.status === "running") {
          schedulePoll();
          return;
        }
        if (job.status === "succeeded") {
          await ensureReady().catch(() => null);
        }
      },
      retry: async () => {
        await ensureReady().catch(() => null);
      },
    });
  }

  function ensureDiagnosticsSubscription(workspaceId: string, workspaceRootPath: string): void {
    const existing = workspaceSubscriptions.get(workspaceId);
    if (existing) {
      existing.workspaceRootPath = workspaceRootPath;
      existing.refCount += 1;
      return;
    }

    const subscription: WorkspaceSubscription = {
      topic: Topics.workspaceLspDiagnostics(workspaceId),
      refCount: 1,
      workspaceRootPath,
      unsubscribe: () => {},
      handleEvent: (_topic, payload) => {
        diagnostics.apply(subscription.workspaceRootPath, payload as LspDiagnosticsEvent);
      },
    };

    subscription.unsubscribe = transport.subscribe([subscription.topic], subscription.handleEvent);

    workspaceSubscriptions.set(workspaceId, subscription);
  }

  function releaseDiagnosticsSubscription(workspaceId: string): void {
    const existing = workspaceSubscriptions.get(workspaceId);
    if (!existing) {
      return;
    }

    existing.refCount -= 1;
    if (existing.refCount <= 0) {
      existing.unsubscribe();
      workspaceSubscriptions.delete(workspaceId);
    }
  }

  return {
    configure,
    attachModel,
    provideDefinition: providers.provideDefinition,
    provideHover: providers.provideHover,
    provideReferences: providers.provideReferences,
    provideDocumentSymbols: providers.provideDocumentSymbols,
    provideDocumentSemanticTokens: providers.provideDocumentSemanticTokens,
  };
}

export const globalLspBridge = createLspBridge();

function resolveMonacoProviderLanguageId(languageId: string): string {
  if (languageId === "typescriptreact") {
    return "typescript";
  }

  if (languageId === "javascriptreact") {
    return "javascript";
  }

  return languageId;
}
