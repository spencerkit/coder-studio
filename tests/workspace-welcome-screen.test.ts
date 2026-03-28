import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeWorkbenchState,
} from "../apps/web/src/state/workbench-core.ts";
import {
  applyWorkbenchUiState,
  buildWorkbenchStateFromBootstrap,
} from "../apps/web/src/shared/utils/workspace.ts";
import {
  defaultAppSettings,
} from "../apps/web/src/shared/app/settings.ts";
import {
  browseWorkspaceOverlayDirectory,
} from "../apps/web/src/features/workspace/workspace-overlay-actions.ts";

test("empty workbench state does not auto-open the launch overlay", () => {
  const normalized = normalizeWorkbenchState({
    tabs: [],
    overlay: {
      visible: true,
      mode: "remote",
      input: "ssh://demo",
      target: { type: "wsl", distro: "Ubuntu" },
    },
  });

  assert.equal(normalized.overlay.visible, false);
  assert.equal(normalized.overlay.mode, "remote");
  assert.equal(normalized.overlay.input, "ssh://demo");
  assert.deepEqual(normalized.overlay.target, { type: "wsl", distro: "Ubuntu" });
});

test("bootstrap with zero open workspaces keeps the launch overlay hidden", () => {
  const next = buildWorkbenchStateFromBootstrap(
    {
      tabs: [],
      activeTabId: "",
      layout: {
        leftWidth: 320,
        rightWidth: 320,
        rightSplit: 64,
        showCodePanel: true,
        showTerminalPanel: true,
      },
      overlay: {
        visible: true,
        mode: "remote",
        input: "ssh://demo",
        target: { type: "wsl", distro: "Ubuntu" },
      },
    },
    {
      workspaces: [],
      ui_state: {
        open_workspace_ids: [],
        active_workspace_id: null,
        layout: {
          left_width: 320,
          right_width: 320,
          right_split: 64,
          show_code_panel: true,
          show_terminal_panel: true,
        },
      },
    },
    "en",
    defaultAppSettings(),
  );

  assert.equal(next.tabs.length, 0);
  assert.equal(next.overlay.visible, false);
  assert.equal(next.overlay.mode, "remote");
  assert.equal(next.overlay.input, "ssh://demo");
  assert.deepEqual(next.overlay.target, { type: "wsl", distro: "Ubuntu" });
});

test("ui state with zero open workspaces keeps the launch overlay hidden", () => {
  const next = applyWorkbenchUiState(
    {
      tabs: [],
      activeTabId: "",
      layout: {
        leftWidth: 320,
        rightWidth: 320,
        rightSplit: 64,
        showCodePanel: true,
        showTerminalPanel: true,
      },
      overlay: {
        visible: true,
        mode: "remote",
        input: "ssh://demo",
        target: { type: "wsl", distro: "Ubuntu" },
      },
    },
    {
      open_workspace_ids: [],
      active_workspace_id: null,
      layout: {
        left_width: 320,
        right_width: 320,
        right_split: 64,
        show_code_panel: true,
        show_terminal_panel: true,
      },
    },
  );

  assert.equal(next.tabs.length, 0);
  assert.equal(next.overlay.visible, false);
  assert.equal(next.overlay.mode, "remote");
  assert.equal(next.overlay.input, "ssh://demo");
  assert.deepEqual(next.overlay.target, { type: "wsl", distro: "Ubuntu" });
});

test("workspace screen wires the no-workspace welcome screen", () => {
  const source = readFileSync(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /\bWorkspaceWelcomeScreen\b/);
  assert.match(source, /const showWelcomeScreen = bootstrapReady && state\.tabs\.length === 0 && !state\.overlay\.visible;/);
  assert.match(source, /\bonOpenWorkspacePicker\b/);
  assert.match(source, /\bonOpenHistory\b/);
  assert.match(source, /const workspaceUiReady = bootstrapReady && \(state\.tabs\.length > 0 \|\| state\.overlay\.visible \|\| showWelcomeScreen\);/);
  assert.match(source, /\{showWelcomeScreen \? \(\s*<WorkspaceWelcomeScreen[\s\S]*?\) : \(\s*<WorkspaceShell/);
});

test("workspace launch overlay exposes a close control wired to onClose", () => {
  const source = readFileSync(
    new URL("../apps/web/src/components/WorkspaceLaunchOverlay/WorkspaceLaunchOverlay.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /onClose:\s*\(\)\s*=>\s*void/);
  assert.match(source, /<button[\s\S]*?onClick=\{onClose\}[\s\S]*?data-testid="launch-overlay-close"[\s\S]*?>/);
});

test("runtime validation overlay exposes a close control wired to onClose", () => {
  const source = readFileSync(
    new URL("../apps/web/src/components/RuntimeValidationOverlay/RuntimeValidationOverlay.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /onClose:\s*\(\)\s*=>\s*void/);
  assert.match(source, /<button[\s\S]*?onClick=\{onClose\}[\s\S]*?data-testid="runtime-validation-close"[\s\S]*?>/);
});

test("workspace screen passes the shared close handler into both overlay layers", () => {
  const source = readFileSync(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /<RuntimeValidationOverlay[\s\S]*?onClose=\{onCloseWorkspaceOverlay\}[\s\S]*?\/>/);
  assert.match(source, /<WorkspaceLaunchOverlay[\s\S]*?onClose=\{onCloseWorkspaceOverlay\}[\s\S]*?\/>/);
});

test("overlay browse ignores stale results after close", async () => {
  let shouldApply = true;
  let resolveListing: ((value: {
    current_path: string;
    home_path: string;
    parent_path?: string | null;
    roots: Array<{ name: string; path: string }>;
    entries: Array<{ name: string; path: string; kind: "dir" | "file" }>;
    requested_path?: string | null;
    fallback_reason?: string | null;
  }) => void) | undefined;
  const listingPromise = new Promise<{
    current_path: string;
    home_path: string;
    parent_path?: string | null;
    roots: Array<{ name: string; path: string }>;
    entries: Array<{ name: string; path: string; kind: "dir" | "file" }>;
    requested_path?: string | null;
    fallback_reason?: string | null;
  }>((resolve) => {
    resolveListing = resolve;
  });

  let folderBrowserState = {
    loading: false,
    currentPath: "",
    homePath: "",
    roots: [],
    entries: [],
  };
  let overlayInput = "";

  const browsePromise = browseWorkspaceOverlayDirectory({
    target: { type: "wsl", distro: "Ubuntu" },
    path: "/requested",
    selectCurrent: true,
    locale: "en",
    t: ((key: string) => key) as never,
    setFolderBrowser: (next) => {
      folderBrowserState = typeof next === "function" ? next(folderBrowserState) : next;
    },
    setOverlayCanUseWsl: () => {},
    updateOverlayInput: (value) => {
      overlayInput = value;
    },
    shouldApplyResult: () => shouldApply,
    listFilesystemImpl: () => listingPromise,
  });

  assert.equal(folderBrowserState.loading, true);

  folderBrowserState = {
    loading: false,
    currentPath: "",
    homePath: "",
    roots: [],
    entries: [],
  };
  overlayInput = "";
  shouldApply = false;

  resolveListing?.({
    current_path: "/resolved",
    home_path: "/home/demo",
    parent_path: "/",
    roots: [{ name: "root", path: "/" }],
    entries: [{ name: "project", path: "/resolved/project", kind: "dir" }],
  });

  await browsePromise;

  assert.deepEqual(folderBrowserState, {
    loading: false,
    currentPath: "",
    homePath: "",
    roots: [],
    entries: [],
  });
  assert.equal(overlayInput, "");
});
