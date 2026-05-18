import type {
  LspDiagnosticsEvent,
  LspDocumentSymbol,
  LspHoverResult,
  LspLocation,
  LspSessionSummary,
} from "@coder-studio/core";
import { Topics } from "@coder-studio/core";
import * as monaco from "monaco-editor";
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

const noopTransport: LspBridgeTransport = {
  sendCommand: async () => null,
  subscribe: () => () => {},
};

export function createLspBridge(initialTransport: Partial<LspBridgeTransport> = {}) {
  let transport: LspBridgeTransport = {
    ...noopTransport,
    ...initialTransport,
  };
  const models = new Map<string, AttachedModel>();
  const diagnostics = createDiagnosticsController();
  const workspaceSubscriptions = new Map<string, WorkspaceSubscription>();
  const changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
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

  function attachModel(input: AttachedModel): () => void {
    const serverKind = resolveLspServerKind(input.path, input.monacoLanguage);
    if (!serverKind) {
      return () => {};
    }

    const key = input.model.uri.toString();
    let detached = false;
    models.set(key, input);
    providers.register(input.monacoLanguage);
    ensureDiagnosticsSubscription(input.workspaceId, input.workspaceRootPath);

    void transport
      .sendCommand<LspSessionSummary | null>("lsp.ensureSession", {
        workspaceId: input.workspaceId,
        path: input.path,
      })
      .then((summary) => {
        if (!summary || summary.status !== "ready" || summary.serverKind !== serverKind) {
          return null;
        }

        if (detached || models.get(key) !== input) {
          return null;
        }

        return transport.sendCommand("lsp.openDocument", {
          workspaceId: input.workspaceId,
          path: input.path,
          languageId: input.monacoLanguage,
          text: input.model.getValue(),
        });
      })
      .catch(() => null);

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

    return () => {
      detached = true;
      clearTimeout(changeTimers.get(key));
      changeTimers.delete(key);
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
  };
}

export const globalLspBridge = createLspBridge();
