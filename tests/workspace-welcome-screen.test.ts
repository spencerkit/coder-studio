import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWorkbenchState,
} from "../apps/web/src/state/workbench-core.ts";
import {
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
      mode: "local",
      input: "",
      target: { type: "native" },
    },
  });

  assert.equal(normalized.overlay.visible, false);
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
