import type { GitStatus } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { CommandResultError } from "../../../../ws/client";
import { toastsAtom } from "../../../notifications/atoms";
import { gitStateAtomFamily } from "../../atoms";
import { GitStatusBar } from "./git-status-bar";

const baseStatus: GitStatus = {
  branch: "main",
  ahead: 2,
  behind: 3,
  staged: [{ path: "src/app.tsx" }],
  modified: [{ path: "src/main.tsx" }],
  untracked: [],
  deleted: [],
};

function renderStatusBar({
  locale = "en",
  status = baseStatus,
  sendCommand = vi.fn(),
}: {
  locale?: "en" | "zh";
  status?: GitStatus | null;
  sendCommand?: ReturnType<typeof vi.fn>;
} = {}) {
  const store = createStore();
  store.set(localeAtom, locale);
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(gitStateAtomFamily("ws-test"), status);

  render(
    <Provider store={store}>
      <GitStatusBar workspaceId="ws-test" gitState={status} inline />
    </Provider>
  );

  return { store, sendCommand };
}

describe("GitStatusBar", () => {
  it("confirms and pushes local commits from the status bar", async () => {
    let resolvePush: (() => void) | null = null;
    const pushPromise = new Promise<void>((resolve) => {
      resolvePush = resolve;
    });

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.push") {
        await pushPromise;
        return { success: true, message: "Push completed successfully" };
      }

      if (op === "git.branches") {
        return {
          current: "main",
          branches: [{ name: "main", isRemote: false, isCurrent: true }],
        };
      }

      if (op === "git.status") {
        return {
          ...baseStatus,
          ahead: 0,
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    const { store } = renderStatusBar({ sendCommand });

    fireEvent.click(screen.getByRole("button", { name: "Push" }));

    expect(screen.getByText("Push Changes")).toBeInTheDocument();
    expect(
      screen.getByText("Do you want to push 2 local commits to the remote?")
    ).toBeInTheDocument();

    const modal = screen.getByText("Push Changes").closest(".modal-card");
    expect(modal).not.toBeNull();
    fireEvent.click(within(modal as HTMLElement).getByRole("button", { name: "Push" }));

    expect(within(modal as HTMLElement).getByRole("button", { name: "Pushing..." })).toBeDisabled();

    resolvePush?.();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.push",
        { workspaceId: "ws-test" },
        { timeoutMs: 180000 }
      );
      expect(sendCommand).toHaveBeenCalledWith(
        "git.branches",
        { workspaceId: "ws-test" },
        undefined
      );
      expect(sendCommand).toHaveBeenCalledWith("git.status", { workspaceId: "ws-test" }, undefined);
    });

    expect(store.get(gitStateAtomFamily("ws-test"))?.ahead).toBe(0);
    expect(store.get(toastsAtom)[0]?.title).toBe("Push completed");
  });

  it("shows pull confirmation and does not dispatch when cancelled", async () => {
    const sendCommand = vi.fn();

    renderStatusBar({
      locale: "zh",
      status: {
        ...baseStatus,
        ahead: 0,
        behind: 2,
      },
      sendCommand,
    });

    fireEvent.click(screen.getByRole("button", { name: "拉取" }));

    expect(screen.getByText("拉取更改")).toBeInTheDocument();
    expect(screen.getByText("是否从远端拉取 2 个最新提交到本地？")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(sendCommand).not.toHaveBeenCalledWith("git.pull", { workspaceId: "ws-test" });
  });

  it("renders push and pull actions as disabled when commit counts are zero", () => {
    renderStatusBar({
      status: {
        ...baseStatus,
        ahead: 0,
        behind: 0,
      },
    });

    expect(screen.getByRole("button", { name: "Push" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pull" })).toBeDisabled();
  });

  it("keeps hook order stable when git state appears after an empty render", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(gitStateAtomFamily("ws-test"), null);

    const { rerender } = render(
      <Provider store={store}>
        <GitStatusBar workspaceId="ws-test" gitState={null} inline />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: "Push" })).not.toBeInTheDocument();

    store.set(gitStateAtomFamily("ws-test"), baseStatus);
    rerender(
      <Provider store={store}>
        <GitStatusBar workspaceId="ws-test" gitState={baseStatus} inline />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Push" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pull" })).toBeInTheDocument();
  });

  it("opens a credential form and retries push when remote authentication is required", async () => {
    let pushAttempts = 0;
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.push") {
        pushAttempts += 1;
        if (pushAttempts === 1) {
          throw new CommandResultError({
            code: "git_auth_required",
            message: "Authentication is required",
            details: {
              operation: "push",
              remote: "origin",
              remoteLabel: "origin (github.com)",
              host: "github.com",
              reason: "missing_credentials",
              authMode: "username_password",
              canPrompt: true,
              usernameHint: "alice",
            },
          });
        }

        return { success: true, message: "Push completed successfully" };
      }

      if (op === "git.branches") {
        return {
          current: "main",
          branches: [{ name: "main", isRemote: false, isCurrent: true }],
        };
      }

      if (op === "git.status") {
        return {
          ...baseStatus,
          ahead: 0,
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    renderStatusBar({ sendCommand });

    fireEvent.click(screen.getByRole("button", { name: "Push" }));
    const confirmModal = screen.getByText("Push Changes").closest(".modal-card");
    expect(confirmModal).not.toBeNull();
    fireEvent.click(within(confirmModal as HTMLElement).getByRole("button", { name: "Push" }));

    const usernameInput = await screen.findByLabelText("Username");
    expect(usernameInput).toHaveClass("input");
    expect(usernameInput).toHaveValue("alice");
    expect(screen.getByLabelText("Password or token")).toHaveClass("input");

    fireEvent.change(screen.getByLabelText("Password or token"), {
      target: { value: "secret-token" },
    });
    const authModal = screen.getByLabelText("Username").closest(".modal-card");
    expect(authModal).not.toBeNull();
    fireEvent.click(within(authModal as HTMLElement).getByRole("button", { name: "Push" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.push",
        {
          workspaceId: "ws-test",
          auth: {
            username: "alice",
            password: "secret-token",
          },
        },
        { timeoutMs: 180000 }
      );
    });
  });

  it("submits the credential form with Enter", async () => {
    let pushAttempts = 0;
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.push") {
        pushAttempts += 1;
        if (pushAttempts === 1) {
          throw new CommandResultError({
            code: "git_auth_required",
            message: "Authentication is required",
            details: {
              operation: "push",
              remote: "origin",
              remoteLabel: "origin (github.com)",
              host: "github.com",
              reason: "missing_credentials",
              authMode: "username_password",
              canPrompt: true,
              usernameHint: "alice",
            },
          });
        }

        return { success: true, message: "Push completed successfully" };
      }

      if (op === "git.branches") {
        return {
          current: "main",
          branches: [{ name: "main", isRemote: false, isCurrent: true }],
        };
      }

      if (op === "git.status") {
        return {
          ...baseStatus,
          ahead: 0,
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    renderStatusBar({ sendCommand });

    fireEvent.click(screen.getByRole("button", { name: "Push" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Push" })[1] as HTMLElement);

    const passwordInput = await screen.findByLabelText("Password or token");
    expect(passwordInput).toHaveClass("input");

    fireEvent.change(passwordInput, {
      target: { value: "secret-token" },
    });
    fireEvent.submit(passwordInput.closest("form") as HTMLFormElement);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.push",
        {
          workspaceId: "ws-test",
          auth: {
            username: "alice",
            password: "secret-token",
          },
        },
        { timeoutMs: 180000 }
      );
    });
  });

  it("shows unsupported auth guidance when the remote cannot prompt in-app", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.push") {
        throw new CommandResultError({
          code: "git_auth_failed",
          message: "Authentication failed",
          details: {
            operation: "push",
            remote: "origin",
            remoteLabel: "origin (github.com)",
            host: "github.com",
            reason: "missing_credentials",
            authMode: "unsupported",
            canPrompt: false,
          },
        });
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    renderStatusBar({ locale: "zh", sendCommand });

    fireEvent.click(screen.getByRole("button", { name: "推送" }));
    fireEvent.click(screen.getAllByRole("button", { name: "推送" })[1] as HTMLElement);

    expect(
      await screen.findByText(
        "origin (github.com) 认证失败。请先配置 SSH key 或 credential helper，再重试。"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("当前远端不支持应用内认证。请先配置 SSH key 或 credential helper，再重试。")
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("用户名")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("密码或令牌")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "推送" })[1]).toBeDisabled();
  });

  it("keeps the typed username after an invalid credential retry", async () => {
    let pushAttempts = 0;
    const sendCommand = vi.fn().mockImplementation(async (op: string, args?: unknown) => {
      if (op === "git.push") {
        pushAttempts += 1;
        if (pushAttempts <= 2) {
          throw new CommandResultError({
            code: "git_auth_required",
            message: "Credentials rejected",
            details: {
              operation: "push",
              remote: "origin",
              remoteLabel: "origin (github.com)",
              host: "github.com",
              reason: pushAttempts === 1 ? "missing_credentials" : "invalid_credentials",
              authMode: "username_password",
              canPrompt: true,
            },
          });
        }

        return { success: true, message: "Push completed successfully" };
      }

      if (op === "git.branches") {
        return {
          current: "main",
          branches: [{ name: "main", isRemote: false, isCurrent: true }],
        };
      }

      if (op === "git.status") {
        return {
          ...baseStatus,
          ahead: 0,
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    renderStatusBar({ sendCommand });

    fireEvent.click(screen.getByRole("button", { name: "Push" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Push" })[1] as HTMLElement);

    const usernameInput = await screen.findByLabelText("Username");
    fireEvent.change(usernameInput, { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password or token"), {
      target: { value: "bad-token" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Push" })[1] as HTMLElement);

    expect(
      await screen.findByText(
        "Credentials for origin (github.com) were rejected. Enter a valid username and password or personal access token to continue."
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveValue("alice");

    fireEvent.change(screen.getByLabelText("Password or token"), {
      target: { value: "good-token" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Push" })[1] as HTMLElement);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.push",
        {
          workspaceId: "ws-test",
          auth: {
            username: "alice",
            password: "good-token",
          },
        },
        { timeoutMs: 180000 }
      );
    });

    expect(argsIncludesAuth(sendCommand.mock.calls[1]?.[1], "alice", "bad-token")).toBe(true);
  });

  it("keeps the dialog open while push is in progress", async () => {
    let resolvePush: (() => void) | null = null;
    const pushPromise = new Promise<void>((resolve) => {
      resolvePush = resolve;
    });

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.push") {
        await pushPromise;
        return { success: true, message: "Push completed successfully" };
      }

      if (op === "git.branches") {
        return {
          current: "main",
          branches: [{ name: "main", isRemote: false, isCurrent: true }],
        };
      }

      if (op === "git.status") {
        return {
          ...baseStatus,
          ahead: 0,
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    renderStatusBar({ sendCommand });

    fireEvent.click(screen.getByRole("button", { name: "Push" }));
    const modal = screen.getByText("Push Changes").closest(".modal-card");
    expect(modal).not.toBeNull();
    fireEvent.click(within(modal as HTMLElement).getByRole("button", { name: "Push" }));

    const cancelButton = within(modal as HTMLElement).getByRole("button", { name: "Cancel" });
    const closeButton = within(modal as HTMLElement).getByRole("button", { name: "Close" });
    expect(cancelButton).toBeDisabled();
    expect(closeButton).toBeDisabled();

    fireEvent.click(cancelButton);
    expect(screen.getByText("Push Changes")).toBeInTheDocument();

    resolvePush?.();
    await waitFor(() => {
      expect(screen.queryByText("Push Changes")).not.toBeInTheDocument();
    });
  });

  it("returns from auth mode when a credential retry fails for a non-auth reason", async () => {
    let pushAttempts = 0;
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.push") {
        pushAttempts += 1;
        if (pushAttempts === 1) {
          throw new CommandResultError({
            code: "git_auth_required",
            message: "Authentication is required",
            details: {
              operation: "push",
              remote: "origin",
              remoteLabel: "origin (github.com)",
              host: "github.com",
              reason: "missing_credentials",
              authMode: "username_password",
              canPrompt: true,
            },
          });
        }

        throw new CommandResultError({
          code: "command_error",
          message: "non-fast-forward",
        });
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    const { store } = renderStatusBar({ sendCommand });

    fireEvent.click(screen.getByRole("button", { name: "Push" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Push" })[1] as HTMLElement);

    fireEvent.change(await screen.findByLabelText("Username"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Password or token"), {
      target: { value: "secret-token" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Push" })[1] as HTMLElement);

    await waitFor(() => {
      expect(store.get(toastsAtom)[0]?.body).toBe("non-fast-forward");
    });

    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
    expect(
      screen.getByText("Do you want to push 2 local commits to the remote?")
    ).toBeInTheDocument();
  });
});

function argsIncludesAuth(args: unknown, username: string, password: string) {
  return (
    typeof args === "object" &&
    args !== null &&
    "auth" in args &&
    (args as { auth?: { username?: string; password?: string } }).auth?.username === username &&
    (args as { auth?: { username?: string; password?: string } }).auth?.password === password
  );
}
