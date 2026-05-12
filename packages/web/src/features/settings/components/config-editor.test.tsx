import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { toastsAtom } from "../../notifications/atoms";
import { ConfigEditor } from "./config-editor";

const monacoHostMock = vi.hoisted(() => vi.fn());

vi.mock("../../code-editor/components/monaco-host", () => ({
  MonacoHost: ({
    content,
    onContentChange,
    ...props
  }: {
    content: string;
    onContentChange: (value: string) => void;
  }) => {
    monacoHostMock(props);
    return (
      <div>
        <textarea
          aria-label="Config editor content"
          onChange={(event) => onContentChange(event.target.value)}
          value={content}
        />
        <div data-testid="monaco-host" />
      </div>
    );
  },
}));

function renderConfigEditor(options?: {
  onWriteConfigFile?: () => Promise<{ success: boolean; backupPath: string | null }>;
}) {
  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === "settings.readConfigFile") {
      return {
        configPath: "/home/spencer/.claude/settings.json",
        content: '{\n  "hooks": {}\n}',
        exists: true,
      };
    }
    if (op === "settings.writeConfigFile") {
      return options?.onWriteConfigFile?.() ?? { success: true, backupPath: null };
    }
    return {};
  });

  const store = createStore();
  store.set(localeAtom, "zh");
  store.set(wsClientAtom, {
    sendCommand,
    subscribe: vi.fn(() => () => {}),
  } as never);

  return {
    sendCommand,
    store,
    ...render(
      <Provider store={store}>
        <ConfigEditor configType="claude" fillHeight />
      </Provider>
    ),
  };
}

describe("ConfigEditor", () => {
  it("keeps MonacoHost in standalone syntax-only mode without workspace metadata", async () => {
    monacoHostMock.mockClear();
    renderConfigEditor();

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toBeInTheDocument();
    });

    expect(monacoHostMock).toHaveBeenCalled();
    expect(monacoHostMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRootPath: expect.anything(),
      })
    );
  });

  it("preserves the full config path in the header tooltip when the visible path is truncated", async () => {
    renderConfigEditor();

    const path = await screen.findByText("/home/spencer/.claude/settings.json");

    expect(path).toHaveClass("config-card-path");
    expect(path).toHaveTextContent("/home/spencer/.claude/settings.json");
    expect(path).not.toHaveAttribute("title");

    fireEvent.mouseEnter(path);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("/home/spencer/.claude/settings.json");
    expect(path).toHaveAttribute("aria-describedby", tooltip.getAttribute("id") ?? "");

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toBeInTheDocument();
    });
  });

  it("renders the shared loading shell while the config file request is pending", () => {
    const sendCommand = vi.fn(
      () =>
        new Promise(() => {
          return undefined;
        })
    );

    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <ConfigEditor configType="claude" fillHeight />
      </Provider>
    );

    const loadingMessage = screen.getByText("加载中...");

    expect(loadingMessage).toBeInTheDocument();
    expect(loadingMessage.closest(".config-card-loading")).toBeTruthy();
    expect(container.querySelector(".config-card-loading")).toBeTruthy();
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

  it("renders text-bearing actions with shared button compatibility classes", async () => {
    renderConfigEditor();

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "格式化" })).toHaveClass(
      "btn",
      "btn-secondary",
      "btn-sm"
    );
    expect(screen.getByRole("button", { name: "重置" })).toHaveClass(
      "btn",
      "btn-secondary",
      "btn-sm"
    );
    expect(screen.getByRole("button", { name: "保存" })).toHaveClass(
      "btn",
      "btn-primary",
      "btn-sm"
    );
  });

  it("renders the shared spinner primitive while a save is in flight", async () => {
    const user = userEvent.setup();
    let resolveSave: ((value: { success: boolean; backupPath: string | null }) => void) | undefined;

    const { container } = renderConfigEditor({
      onWriteConfigFile: () =>
        new Promise<{ success: boolean; backupPath: string | null }>((resolve) => {
          resolveSave = resolve;
        }),
    });

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toBeInTheDocument();
    });

    const editor = screen.getByRole("textbox", { name: "Config editor content" });
    fireEvent.change(editor, { target: { value: '{\n  "hooks": {}\n} ' } });

    const saveButton = screen.getByRole("button", { name: "保存" });
    await waitFor(() => {
      expect(saveButton).toBeEnabled();
    });

    await user.click(saveButton);

    const savingButton = await screen.findByRole("button", { name: "保存中..." });
    expect(savingButton).toBeDisabled();

    const footer = container.querySelector(".config-card-actions");
    const footerStatus = footer?.querySelector(".config-status");
    expect(footerStatus).not.toBeNull();

    const spinner = within(footerStatus as HTMLElement).getByRole("status", { name: "保存中..." });
    expect(spinner.tagName).toBe("SPAN");

    resolveSave?.({ success: true, backupPath: null });
  });

  it("preserves the bounded missing-file empty-state copy while still allowing create-via-save", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.readConfigFile") {
        return {
          configPath: "/home/spencer/.claude/settings.json",
          content: "",
          exists: false,
        };
      }

      if (op === "settings.writeConfigFile") {
        return {
          success: true,
          backupPath: null,
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

    const { container } = render(
      <Provider store={store}>
        <ConfigEditor configType="claude" fillHeight />
      </Provider>
    );

    const emptyState = await screen.findByText("配置文件不存在，编辑并保存以创建。");
    const emptyStateRoot = emptyState.closest(".config-empty-state");

    expect(emptyState).toBeInTheDocument();
    expect(emptyStateRoot).not.toBeNull();
    expect(
      within(emptyStateRoot as HTMLElement).getByText("编辑并保存以创建配置文件。")
    ).toBeInTheDocument();
    expect(container.querySelector(".config-empty-state")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Config editor content" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Config editor content" }), {
      target: { value: '{\n  "hooks": {}\n}' },
    });

    const saveButton = screen.getByRole("button", { name: "保存" });
    await waitFor(() => {
      expect(saveButton).toBeEnabled();
    });

    await user.click(saveButton);

    await waitFor(() => {
      expect(sendCommand.mock.calls).toContainEqual([
        "settings.writeConfigFile",
        {
          configType: "claude",
          content: '{\n  "hooks": {}\n}',
        },
        undefined,
      ]);
    });

    await waitFor(() => {
      expect(screen.queryByText("配置文件不存在，编辑并保存以创建。")).not.toBeInTheDocument();
    });
  });

  it("describes source-file updates explicitly when a backup is created during save", async () => {
    const user = userEvent.setup();
    const backupPath = "/home/spencer/.claude/settings.bak.20260509-125019.json";
    const { store } = renderConfigEditor({
      onWriteConfigFile: async () => ({
        success: true,
        backupPath,
      }),
    });

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Config editor content" }), {
      target: { value: '{\n  "hooks": {\n    "enabled": true\n  }\n}' },
    });

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(store.get(toastsAtom)).toHaveLength(1);
    });

    expect(store.get(toastsAtom)[0]).toMatchObject({
      kind: "success",
      title: "配置保存成功",
      body: "已更新 /home/spencer/.claude/settings.json，并创建备份 /home/spencer/.claude/settings.bak.20260509-125019.json",
    });
  });
});
