import { describe, expect, it, vi } from "vitest";

import { createTerminalWorkspaceLinkProvider } from "./terminal-link-provider";

interface MockBufferLine {
  isWrapped?: boolean;
  translateToString(trimRight?: boolean): string;
}

interface CapturedLink {
  text: string;
  range: { start: { x: number; y: number }; end: { x: number; y: number } };
  activate(event: MouseEvent, text: string): void;
}

function createBufferLine(text: string, isWrapped = false): MockBufferLine {
  return {
    isWrapped,
    translateToString(trimRight = false) {
      return trimRight ? text.replace(/\s+$/u, "") : text;
    },
  };
}

function createProvider(
  rows: Array<[row: number, line: MockBufferLine]>,
  workspacePath = "/root/workspace/coder-studio"
) {
  const byRow = new Map(rows);
  const openWorkspaceFile = vi.fn();
  const provider = createTerminalWorkspaceLinkProvider({
    terminal: {
      buffer: {
        active: {
          getLine(row: number) {
            return byRow.get(row);
          },
        },
      },
    },
    workspaceId: "ws-1",
    getWorkspacePath: () => workspacePath,
    openWorkspaceFile,
  });

  return { provider, openWorkspaceFile };
}

async function provideLinks(
  provider: ReturnType<typeof createTerminalWorkspaceLinkProvider>,
  row: number
) {
  const links = await new Promise<CapturedLink[] | undefined>((resolve) => {
    provider.provideLinks(row, (nextLinks) => {
      resolve(nextLinks as CapturedLink[] | undefined);
    });
  });

  return links;
}

describe("createTerminalWorkspaceLinkProvider", () => {
  it("invokes the callback synchronously for immediate links", () => {
    const { provider } = createProvider([[0, createBufferLine("Visit https://example.com/docs")]]);
    let synchronouslyResolved = false;

    provider.provideLinks(1, () => {
      synchronouslyResolved = true;
    });

    expect(synchronouslyResolved).toBe(true);
  });

  it("starts a workspace path link at the path instead of adjacent label text", async () => {
    const { provider, openWorkspaceFile } = createProvider([
      [0, createBufferLine("更新文件:.stitch/designs/overlay-editor-header-scope.html")],
    ]);

    const links = await provideLinks(provider, 1);

    expect(links).toHaveLength(1);
    expect(links?.[0]).toMatchObject({
      text: ".stitch/designs/overlay-editor-header-scope.html",
      range: {
        start: { x: 6, y: 1 },
        end: { x: 53, y: 1 },
      },
    });

    links?.[0]?.activate(new MouseEvent("click"), links[0].text);
    expect(openWorkspaceFile).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      path: ".stitch/designs/overlay-editor-header-scope.html",
      line: undefined,
      column: undefined,
      source: "manual",
    });
  });

  it("opens absolute workspace paths that wrap across terminal rows", async () => {
    const { provider, openWorkspaceFile } = createProvider(
      [
        [0, createBufferLine("'/root/.coder-studio/uploads/ws_1779420655702_45iqdg5vv/", false)],
        [1, createBufferLine("2026-06-09/7e4ffb70-image.png' ", true)],
      ],
      "/root/.coder-studio/uploads/ws_1779420655702_45iqdg5vv"
    );

    const firstRowLinks = await provideLinks(provider, 1);
    const secondRowLinks = await provideLinks(provider, 2);

    expect(firstRowLinks).toHaveLength(1);
    expect(firstRowLinks?.[0]).toMatchObject({
      text: "/root/.coder-studio/uploads/ws_1779420655702_45iqdg5vv/2026-06-09/7e4ffb70-image.png",
      range: {
        start: { x: 2, y: 1 },
        end: { x: 29, y: 2 },
      },
    });
    expect(secondRowLinks).toHaveLength(1);
    expect(secondRowLinks?.[0]).toMatchObject({
      text: "/root/.coder-studio/uploads/ws_1779420655702_45iqdg5vv/2026-06-09/7e4ffb70-image.png",
      range: {
        start: { x: 2, y: 1 },
        end: { x: 29, y: 2 },
      },
    });

    secondRowLinks?.[0]?.activate(new MouseEvent("click"), secondRowLinks[0].text);
    expect(openWorkspaceFile).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      path: "2026-06-09/7e4ffb70-image.png",
      line: undefined,
      column: undefined,
      source: "manual",
    });
  });

  it("does not open the wrapped tail of an absolute path outside the workspace", async () => {
    const { provider, openWorkspaceFile } = createProvider([
      [0, createBufferLine("'/root/.coder-studio/uploads/ws_1779420655702_45iqdg5vv/", false)],
      [1, createBufferLine("2026-06-09/7e4ffb70-image.png' ", true)],
    ]);

    await expect(provideLinks(provider, 1)).resolves.toBeUndefined();
    await expect(provideLinks(provider, 2)).resolves.toBeUndefined();
    expect(openWorkspaceFile).not.toHaveBeenCalled();
  });

  it("rejoins wrapped workspace paths across padded terminal rows", async () => {
    const { provider, openWorkspaceFile } = createProvider(
      [
        [
          0,
          createBufferLine(
            "/home/spencer/workspace/coder-studio/packages/web/src/features/terminal-        ",
            false
          ),
        ],
        [1, createBufferLine("panel/links/terminal-link-provider.ts", true)],
      ],
      "/home/spencer/workspace/coder-studio"
    );

    const firstRowLinks = await provideLinks(provider, 1);
    const secondRowLinks = await provideLinks(provider, 2);

    expect(firstRowLinks).toHaveLength(1);
    expect(firstRowLinks?.[0]?.text).toBe(
      "/home/spencer/workspace/coder-studio/packages/web/src/features/terminal-panel/links/terminal-link-provider.ts"
    );
    expect(secondRowLinks).toHaveLength(1);
    expect(secondRowLinks?.[0]?.text).toBe(
      "/home/spencer/workspace/coder-studio/packages/web/src/features/terminal-panel/links/terminal-link-provider.ts"
    );

    secondRowLinks?.[0]?.activate(new MouseEvent("click"), secondRowLinks[0].text);
    expect(openWorkspaceFile).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      path: "packages/web/src/features/terminal-panel/links/terminal-link-provider.ts",
      line: undefined,
      column: undefined,
      source: "manual",
    });
  });

  it("keeps line and column suffixes out of the workspace file path", async () => {
    const { provider, openWorkspaceFile } = createProvider([
      [0, createBufferLine("at /root/workspace/coder-studio/packages/web/src/main.tsx:12:3")],
    ]);

    const links = await provideLinks(provider, 1);

    expect(links).toHaveLength(1);
    expect(links?.[0]?.text).toBe("/root/workspace/coder-studio/packages/web/src/main.tsx:12:3");

    links?.[0]?.activate(new MouseEvent("click"), links[0].text);
    expect(openWorkspaceFile).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      path: "packages/web/src/main.tsx",
      line: 12,
      column: 3,
      source: "manual",
    });
  });

  it("does not link truncated workspace paths on their own", async () => {
    const { provider, openWorkspaceFile } = createProvider(
      [
        [
          0,
          createBufferLine(
            "/home/spencer/workspace/coder-studio/packages/web/src/features/terminal-"
          ),
        ],
      ],
      "/home/spencer/workspace/coder-studio"
    );

    await expect(provideLinks(provider, 1)).resolves.toBeUndefined();
    expect(openWorkspaceFile).not.toHaveBeenCalled();
  });

  it("rejoins workspace paths split across adjacent non-wrapped rows", async () => {
    const { provider, openWorkspaceFile } = createProvider(
      [
        [
          0,
          createBufferLine(
            "/home/spencer/workspace/coder-studio/packages/web/src/features/terminal-"
          ),
        ],
        [1, createBufferLine("panel/links/terminal-link-provider.ts")],
      ],
      "/home/spencer/workspace/coder-studio"
    );

    const firstRowLinks = await provideLinks(provider, 1);
    const secondRowLinks = await provideLinks(provider, 2);

    expect(firstRowLinks).toHaveLength(1);
    expect(firstRowLinks?.[0]?.text).toBe(
      "/home/spencer/workspace/coder-studio/packages/web/src/features/terminal-panel/links/terminal-link-provider.ts"
    );

    expect(secondRowLinks).toHaveLength(1);
    expect(secondRowLinks?.[0]?.text).toBe(
      "/home/spencer/workspace/coder-studio/packages/web/src/features/terminal-panel/links/terminal-link-provider.ts"
    );

    secondRowLinks?.[0]?.activate(new MouseEvent("click"), secondRowLinks[0].text);
    expect(openWorkspaceFile).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      path: "packages/web/src/features/terminal-panel/links/terminal-link-provider.ts",
      line: undefined,
      column: undefined,
      source: "manual",
    });
  });

  it("rejoins workspace paths across padded adjacent rows", async () => {
    const { provider } = createProvider(
      [
        [
          0,
          createBufferLine(
            "/home/spencer/workspace/coder-studio/packages/web/src/features/terminal-        "
          ),
        ],
        [1, createBufferLine("panel/links/terminal-link-provider.ts")],
      ],
      "/home/spencer/workspace/coder-studio"
    );

    const firstRowLinks = await provideLinks(provider, 1);
    expect(firstRowLinks).toHaveLength(1);
    expect(firstRowLinks?.[0]?.text).toBe(
      "/home/spencer/workspace/coder-studio/packages/web/src/features/terminal-panel/links/terminal-link-provider.ts"
    );
  });
});
