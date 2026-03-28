import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultWorkbenchState,
  normalizeWorkbenchState,
} from "../apps/web/src/state/workbench-core.ts";
import {
  applyWorkbenchUiState,
  buildWorkbenchStateFromBootstrap,
} from "../apps/web/src/shared/utils/workspace.ts";
import {
  defaultAppSettings,
} from "../apps/web/src/shared/app/settings.ts";

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

test("default workbench state keeps the launch overlay hidden on startup", () => {
  const initial = createDefaultWorkbenchState();

  assert.equal(initial.tabs.length, 0);
  assert.equal(initial.overlay.visible, false);
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
        visible: false,
        mode: "local",
        input: "",
        target: { type: "native" },
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
});

test("bootstrap with zero open workspaces preserves a user-opened launch overlay", () => {
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
  assert.equal(next.overlay.visible, true);
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
        visible: false,
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

test("ui state with zero open workspaces preserves a user-opened launch overlay", () => {
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
  assert.equal(next.overlay.visible, true);
  assert.equal(next.overlay.mode, "remote");
  assert.equal(next.overlay.input, "ssh://demo");
  assert.deepEqual(next.overlay.target, { type: "wsl", distro: "Ubuntu" });
});
