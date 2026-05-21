import { describe, expect, it } from "vitest";

import { resolveLspServerKind, wrapLspCommandForWorkspace } from "./server-factory.js";

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

describe("resolveLspServerKind", () => {
  it("maps ts/js/jsx/tsx files to the typescript server kind", () => {
    expect(resolveLspServerKind("src/a.ts")).toBe("typescript");
    expect(resolveLspServerKind("src/a.js")).toBe("typescript");
    expect(resolveLspServerKind("src/a.tsx")).toBe("typescript");
    expect(resolveLspServerKind("src/a.jsx")).toBe("typescript");
  });

  it("returns null for unsupported languages", () => {
    expect(resolveLspServerKind("assets/logo.svg")).toBeNull();
  });
});

describe("wrapLspCommandForWorkspace", () => {
  it("wraps the command in wsl when the workspace targets WSL", () => {
    const spec = wrapLspCommandForWorkspace({
      workspace: {
        ...workspace,
        targetRuntime: "wsl",
        wslDistro: "Ubuntu",
      },
      serverKind: "typescript",
      command: "node",
      args: ["packages/server/src/__tests__/fixtures/fake-lsp-server.js"],
      rootPath: workspace.path,
    });

    expect(spec).toMatchObject({
      serverKind: "typescript",
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

  it("keeps native workspace commands unchanged", () => {
    const spec = wrapLspCommandForWorkspace({
      workspace,
      serverKind: "python",
      command: "pylsp",
      args: [],
      rootPath: workspace.path,
    });

    expect(spec).toEqual({
      serverKind: "python",
      command: "pylsp",
      args: [],
      rootPath: "/repo",
    });
  });
});
