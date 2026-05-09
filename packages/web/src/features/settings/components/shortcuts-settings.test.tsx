// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../atoms/connection";
import { customShortcutsAtom } from "../../../lib/shortcuts";
import { ShortcutsSettings } from "./shortcuts-settings";

vi.mock("../../../lib/i18n", () => ({
  useTranslation: () => (key: string) => key,
}));

function renderShortcutsSettings(
  sendCommand = vi.fn().mockResolvedValue({}),
  customBindings: Record<string, string> = {}
) {
  const store = createStore();
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(customShortcutsAtom, customBindings);

  render(
    <Provider store={store}>
      <ShortcutsSettings />
    </Provider>
  );

  return { sendCommand, store };
}

describe("ShortcutsSettings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("renders the shortcut capture field with shared input compatibility classes", async () => {
    let focusedElement: HTMLElement | null = null;
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement) {
      focusedElement = this;
    });

    renderShortcutsSettings();

    fireEvent.click(screen.getByText("Ctrl+K"));

    const input = screen.getByRole("textbox", { name: "命令面板" });
    expect(input).toHaveClass("input", "shortcuts-capture");
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveAttribute(
      "aria-describedby",
      "shortcut-description-command-palette.toggle"
    );
    await waitFor(() => {
      expect(focusedElement).toBe(input);
    });
  });

  it("captures a shortcut and saves it through settings.update", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const { store } = renderShortcutsSettings(sendCommand);

    fireEvent.click(screen.getByText("Ctrl+K"));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "命令面板" }), {
      key: "p",
      ctrlKey: true,
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: { shortcuts: { "command-palette.toggle": "Mod+P" } },
        },
        undefined
      );
    });

    expect(store.get(customShortcutsAtom)).toMatchObject({
      "command-palette.toggle": "Mod+P",
    });
    expect(screen.queryByRole("textbox", { name: "命令面板" })).not.toBeInTheDocument();
    expect(screen.getByText("Ctrl+P")).toBeInTheDocument();
  });

  it("cancels editing on blur without changing the binding", async () => {
    const { store } = renderShortcutsSettings(undefined, {
      "command-palette.toggle": "Mod+Shift+K",
    });

    fireEvent.click(screen.getByText("Ctrl+⇧+K"));

    const input = screen.getByRole("textbox", { name: "命令面板" });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "命令面板" })).not.toBeInTheDocument();
    });

    expect(store.get(customShortcutsAtom)).toMatchObject({
      "command-palette.toggle": "Mod+Shift+K",
    });
    expect(screen.getByText("Ctrl+⇧+K")).toBeInTheDocument();
  });
});
