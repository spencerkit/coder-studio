// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { customShortcutsAtom } from "../../../lib/shortcuts";
import { ShortcutsSettings } from "./shortcuts-settings";

function renderShortcutsSettings(
  sendCommand = vi.fn().mockResolvedValue({}),
  customBindings: Record<string, string> = {}
) {
  const store = createStore();
  store.set(localeAtom, "zh");
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
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");
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

  it("shows workspace navigation shortcuts in the 工作区 tab", async () => {
    renderShortcutsSettings();

    fireEvent.click(screen.getByRole("tab", { name: "工作区" }));

    expect(await screen.findByText("切换到左侧会话")).toBeInTheDocument();
    expect(screen.getByText("下一个工作区")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+←")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+⇧+→")).toBeInTheDocument();
  });

  it("captures Ctrl+ArrowDown for session.navigate.left and persists it", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const { store } = renderShortcutsSettings(sendCommand);

    fireEvent.click(screen.getByRole("tab", { name: "工作区" }));
    const shortcutRow = (await screen.findByText("切换到左侧会话")).closest(".shortcuts-item");
    expect(shortcutRow).not.toBeNull();

    fireEvent.click(within(shortcutRow as HTMLElement).getByText("Ctrl+←"));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "切换到左侧会话" }), {
      key: "ArrowDown",
      ctrlKey: true,
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: { shortcuts: { "session.navigate.left": "Ctrl+ArrowDown" } },
        },
        undefined
      );
    });

    expect(store.get(customShortcutsAtom)).toMatchObject({
      "session.navigate.left": "Ctrl+ArrowDown",
    });

    expect(within(shortcutRow as HTMLElement).getByText("Ctrl+↓")).toBeInTheDocument();
  });

  it("stores macOS Ctrl+letter captures as Mod bindings", async () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");

    const sendCommand = vi.fn().mockResolvedValue({});
    const { store } = renderShortcutsSettings(sendCommand);

    fireEvent.click(screen.getByText("⌘+K"));
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
    expect(screen.getByText("⌘+P")).toBeInTheDocument();
  });

  it("does not duplicate Mod when macOS captures Meta+Ctrl+letter", async () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");

    const sendCommand = vi.fn().mockResolvedValue({});
    const { store } = renderShortcutsSettings(sendCommand);

    fireEvent.click(screen.getByText("⌘+K"));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "命令面板" }), {
      key: "p",
      metaKey: true,
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
    expect(screen.getByText("⌘+P")).toBeInTheDocument();
  });

  it("preserves explicit Ctrl for macOS arrow captures only", async () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");

    const sendCommand = vi.fn().mockResolvedValue({});
    const { store } = renderShortcutsSettings(sendCommand);

    fireEvent.click(screen.getByRole("tab", { name: "工作区" }));
    const shortcutRow = (await screen.findByText("切换到左侧会话")).closest(".shortcuts-item");
    expect(shortcutRow).not.toBeNull();

    fireEvent.click(within(shortcutRow as HTMLElement).getByText("Ctrl+←"));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "切换到左侧会话" }), {
      key: "ArrowUp",
      ctrlKey: true,
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: { shortcuts: { "session.navigate.left": "Ctrl+ArrowUp" } },
        },
        undefined
      );
    });

    expect(store.get(customShortcutsAtom)).toMatchObject({
      "session.navigate.left": "Ctrl+ArrowUp",
    });
    expect(within(shortcutRow as HTMLElement).getByText("Ctrl+↑")).toBeInTheDocument();
  });
});
