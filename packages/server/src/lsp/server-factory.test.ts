import { describe, expect, it } from "vitest";

import { resolveLspServerSpec } from "./server-factory.js";

const workspace = {
  id: "ws-1",
  path: "/repo",
  targetRuntime: "native" as const,
  openedAt: 1,
  lastActiveAt: 1,
  uiState: {
    leftPanelWidth: 250,
    bottomPanelHeight: 200,
    focusMode: false,
  },
};

describe("resolveLspServerSpec", () => {
  it("maps ts/js/jsx/tsx files to the typescript server kind", () => {
    expect(resolveLspServerSpec({ workspace, path: "src/a.ts" })?.serverKind).toBe("typescript");
    expect(resolveLspServerSpec({ workspace, path: "src/a.js" })?.serverKind).toBe("typescript");
    expect(resolveLspServerSpec({ workspace, path: "src/a.tsx" })?.serverKind).toBe("typescript");
    expect(resolveLspServerSpec({ workspace, path: "src/a.jsx" })?.serverKind).toBe("typescript");
  });

  it("returns null for unsupported languages", () => {
    expect(resolveLspServerSpec({ workspace, path: "assets/logo.svg" })).toBeNull();
  });

  it("supports command overrides for deterministic tests", () => {
    const spec = resolveLspServerSpec({
      workspace,
      path: "src/a.ts",
      env: {
        CODER_STUDIO_LSP_TYPESCRIPT_COMMAND: "node",
        CODER_STUDIO_LSP_TYPESCRIPT_ARGS_JSON:
          '["packages/server/src/__tests__/fixtures/fake-lsp-server.js"]',
      },
    });

    expect(spec).toMatchObject({
      serverKind: "typescript",
      command: "node",
      args: ["packages/server/src/__tests__/fixtures/fake-lsp-server.js"],
    });
  });

  it("wraps the command in wsl when the workspace targets WSL", () => {
    const spec = resolveLspServerSpec({
      workspace: {
        ...workspace,
        targetRuntime: "wsl",
        wslDistro: "Ubuntu",
      },
      path: "src/a.ts",
      env: {
        CODER_STUDIO_LSP_TYPESCRIPT_COMMAND: "node",
        CODER_STUDIO_LSP_TYPESCRIPT_ARGS_JSON:
          '["packages/server/src/__tests__/fixtures/fake-lsp-server.js"]',
      },
    });

    expect(spec).toMatchObject({
      command: "wsl",
      args: [
        "-d",
        "Ubuntu",
        "--",
        "node",
        "packages/server/src/__tests__/fixtures/fake-lsp-server.js",
      ],
    });
  });
});
