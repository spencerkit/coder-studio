import { render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { ConfigEditor } from "./config-editor";

vi.mock("../../code-editor/components/monaco-host", () => ({
  MonacoHost: () => <div data-testid="monaco-host" />,
}));

function renderConfigEditor() {
  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === "settings.readConfigFile") {
      return {
        configPath: "/home/spencer/.claude/settings.json",
        content: '{\n  "hooks": {}\n}',
        exists: true,
      };
    }
    return {};
  });

  const store = createStore();
  store.set(localeAtom, "zh");
  store.set(wsClientAtom, {
    sendCommand,
    subscribe: vi.fn(() => () => {}),
  } as never);

  return render(
    <Provider store={store}>
      <ConfigEditor configType="claude" fillHeight />
    </Provider>
  );
}

describe("ConfigEditor", () => {
  it("preserves the full config path in the header title when the visible path is truncated", async () => {
    renderConfigEditor();

    const path = await screen.findByTitle("/home/spencer/.claude/settings.json");

    expect(path).toHaveClass("config-card-path");
    expect(path).toHaveTextContent("/home/spencer/.claude/settings.json");

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toBeInTheDocument();
    });
  });

  it("shows save status in the footer and removes the footer collapse button", async () => {
    const { container } = renderConfigEditor();

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "折叠" })).not.toBeInTheDocument();

    const footer = container.querySelector(".config-card-actions");
    const footerStatus = footer?.querySelector(".config-status");
    const headerStatus = container.querySelector(".config-card-header .config-status");

    expect(footer).not.toBeNull();
    expect(footerStatus).not.toBeNull();
    expect(footerStatus).toHaveTextContent("已保存");
    expect(headerStatus).toBeNull();
  });
});
