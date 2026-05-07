import type { GitStatus } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import {
  gitBranchListAtomFamily,
  gitDiffPreviewAtomFamily,
  gitDiffPreviewDismissedAtomFamily,
  gitStateAtomFamily,
} from "../../atoms";
import { GitPanel } from "./git-panel";

describe("GitPanel", () => {
  const status: GitStatus = {
    branch: "feature/ai-agent",
    ahead: 0,
    behind: 0,
    headSha: "abc1234567890",
    headShortSha: "abc1234",
    headSubject: "Refresh git projection",
    staged: [{ path: "src/auth/AuthGate.tsx" }],
    modified: [{ path: "src/app/AppController.tsx" }],
    untracked: [{ path: "tests/supervisor.test.ts" }],
    deleted: [{ path: "src/legacy/deprecated.ts" }],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders git groups from the first git.status response", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("git.status", { workspaceId: "ws-test" }, undefined);
    });

    expect((await screen.findAllByText("Staged")).length).toBeGreaterThan(0);
    expect(screen.getByText("Changes")).toBeInTheDocument();
    expect(screen.getAllByText("Untracked").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Deleted").length).toBeGreaterThan(0);
    expect(screen.getByText("AuthGate.tsx")).toBeInTheDocument();
    expect(screen.getByText("AppController.tsx")).toBeInTheDocument();
    expect(screen.getByText("supervisor.test.ts")).toBeInTheDocument();
    expect(screen.getByText("deprecated.ts")).toBeInTheDocument();
    expect(screen.getByLabelText("Latest Commit")).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
    expect(screen.getByText("Refresh git projection")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter commit message...")).toHaveClass(
      "input",
      "textarea",
      "git-commit-input"
    );
  });

  it("loads branch list on mount", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, _args: unknown) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [
            { name: "feature/ai-agent", isCurrent: true, isRemote: false },
            { name: "main", isCurrent: false, isRemote: false },
          ],
        };
      }

      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.branches",
        { workspaceId: "ws-test" },
        undefined
      );
    });

    expect(store.get(gitBranchListAtomFamily("ws-test")).current).toBe("feature/ai-agent");
  });

  it("requests a diff, updates preview state, and emits an explicit preview-open event only when a row is clicked", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }

      if (op === "git.diff") {
        return {
          diff: `diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx\n${JSON.stringify(args)}`,
        };
      }

      return {};
    });
    const onPreviewOpen = vi.fn();
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" onPreviewOpen={onPreviewOpen} />
      </Provider>
    );

    const row = await screen.findByText("AuthGate.tsx");
    fireEvent.click(row);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.diff",
        {
          workspaceId: "ws-test",
          path: "src/auth/AuthGate.tsx",
          staged: true,
        },
        undefined
      );
    });

    expect(store.get(gitStateAtomFamily("ws-test"))).toEqual(status);
    expect(store.get(gitBranchListAtomFamily("ws-test")).current).toBe("feature/ai-agent");
    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toEqual({
      path: "src/auth/AuthGate.tsx",
      diff: expect.stringContaining("diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx"),
      staged: true,
    });
    expect(onPreviewOpen).toHaveBeenCalledWith({
      path: "src/auth/AuthGate.tsx",
      diff: expect.stringContaining("diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx"),
      staged: true,
    });
    expect(dispatchEventSpy).not.toHaveBeenCalled();
  });

  it("auto-selects the first change from hydrated state without emitting a workspace diff event", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "git.diff") {
        return {
          diff: `diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx\n${JSON.stringify(args)}`,
        };
      }

      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(gitStateAtomFamily("ws-test"), status);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.diff",
        {
          workspaceId: "ws-test",
          path: "src/auth/AuthGate.tsx",
          staged: true,
        },
        undefined
      );
    });

    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toEqual({
      path: "src/auth/AuthGate.tsx",
      diff: expect.stringContaining("diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx"),
      staged: true,
    });
    expect(dispatchEventSpy).not.toHaveBeenCalled();
  });

  it("does not auto-reopen the first diff after the preview is manually dismissed", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "git.diff") {
        return {
          diff: `diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx\n${JSON.stringify(args)}`,
        };
      }

      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(gitStateAtomFamily("ws-test"), status);
    store.set(gitDiffPreviewDismissedAtomFamily("ws-test"), true);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText("AuthGate.tsx")).toBeInTheDocument();
    });

    expect(sendCommand).not.toHaveBeenCalledWith(
      "git.diff",
      expect.objectContaining({
        workspaceId: "ws-test",
      })
    );
    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toBeNull();
  });

  it("retries a refresh request after the in-flight git status load finishes", async () => {
    let resolveFirst: ((value: GitStatus) => void) | null = null;
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "git.status") {
        return new Promise<GitStatus>((resolve) => {
          if (!resolveFirst) {
            resolveFirst = resolve;
            return;
          }

          resolve({
            ...status,
            modified: [],
            untracked: [],
            deleted: [],
          });
        });
      }

      if (op === "git.branches") {
        return Promise.resolve({ current: "feature/ai-agent", branches: [] });
      }

      if (op === "git.diff") {
        return Promise.resolve({
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        });
      }

      return Promise.resolve({});
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    const { rerender } = render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" refreshToken={0} />
      </Provider>
    );

    rerender(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" refreshToken={1} />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("git.status", { workspaceId: "ws-test" }, undefined);
    });

    resolveFirst?.(status);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(3);
    });
  });

  it("requires confirmation before discarding a single file", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const row = (await screen.findByText("AppController.tsx")).closest(".git-row");
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByTitle("放弃"));

    expect(screen.getByText("放弃文件更改")).toBeInTheDocument();
    expect(
      screen.getByText("确定要放弃 “src/app/AppController.tsx” 的更改吗？")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(sendCommand).not.toHaveBeenCalledWith("git.discard", {
      workspaceId: "ws-test",
      paths: ["src/app/AppController.tsx"],
    });
  });

  it("discards a single file only after confirmation", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const row = (await screen.findByText("AppController.tsx")).closest(".git-row");
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByTitle("放弃"));
    const modal = screen.getByText("放弃文件更改").closest(".modal-card");
    expect(modal).not.toBeNull();
    fireEvent.click(within(modal as HTMLElement).getByRole("button", { name: /^放弃$/ }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.discard",
        {
          workspaceId: "ws-test",
          paths: ["src/app/AppController.tsx"],
        },
        undefined
      );
    });
  });

  it("shows a discard-all confirmation with the affected file count", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(await screen.findByTitle("放弃全部"));

    expect(screen.getByText("放弃所有更改")).toBeInTheDocument();
    expect(screen.getByText("确定要放弃 4 个文件的更改吗？")).toBeInTheDocument();

    const modal = screen.getByText("放弃所有更改").closest(".modal-card");
    expect(modal).not.toBeNull();
    fireEvent.click(within(modal as HTMLElement).getByRole("button", { name: /^放弃$/ }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.discard",
        {
          workspaceId: "ws-test",
          paths: [
            "src/auth/AuthGate.tsx",
            "src/app/AppController.tsx",
            "src/legacy/deprecated.ts",
            "tests/supervisor.test.ts",
          ],
        },
        undefined
      );
    });
  });

  it("allows discarding a staged file after confirmation", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const row = (await screen.findByText("AuthGate.tsx")).closest(".git-row");
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByTitle("放弃"));
    const modal = screen.getByText("放弃文件更改").closest(".modal-card");
    expect(modal).not.toBeNull();
    fireEvent.click(within(modal as HTMLElement).getByRole("button", { name: /^放弃$/ }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.discard",
        {
          workspaceId: "ws-test",
          paths: ["src/auth/AuthGate.tsx"],
        },
        undefined
      );
    });
  });

  it("renders translated Chinese panel copy when locale is zh", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    expect(await screen.findAllByText("已暂存")).toHaveLength(2);
    expect(screen.getByText("更改")).toBeInTheDocument();
    expect(screen.getByText("已修改")).toBeInTheDocument();
    expect(screen.getAllByText("未跟踪").length).toBeGreaterThan(0);
    expect(screen.getAllByText("已删除").length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("输入提交信息...")).toBeInTheDocument();
    expect(screen.getByTitle("刷新")).toBeInTheDocument();
    expect(screen.getByTitle("暂存全部")).toBeInTheDocument();
    expect(screen.getByTitle("放弃全部")).toBeInTheDocument();

    const untrackedRow = screen.getByText("supervisor.test.ts").closest(".git-row");
    expect(untrackedRow).not.toBeNull();
    expect(within(untrackedRow as HTMLElement).getByText("未跟踪")).toHaveClass(
      "git-row-status",
      "git-row-status-end"
    );
    expect(within(untrackedRow as HTMLElement).queryByText("tests/")).toHaveClass("git-row-dir");
  });
});
