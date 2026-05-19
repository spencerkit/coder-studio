// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { toastsAtom } from "../../notifications/atoms";
import {
  terminalActiveIdAtomFamily,
  terminalIdsAtomFamily,
  terminalMetaAtomFamily,
} from "../atoms";
import { useCreateShellTerminal } from "./use-create-shell-terminal";

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe("useCreateShellTerminal", () => {
  it("creates a shell terminal, stores it under the workspace, and activates it immediately", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      id: "term_2",
      workspaceId: "ws-test",
      kind: "shell",
      title: "Workspace Shell",
      cwd: "/tmp/ws-test/src",
      argv: ["/bin/bash"],
      cols: 120,
      rows: 30,
      alive: true,
      createdAt: 1,
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(terminalIdsAtomFamily("ws-test"), ["term_1"]);
    store.set(terminalActiveIdAtomFamily("ws-test"), "term_1");

    const { result } = renderHook(() => useCreateShellTerminal("ws-test"), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current.createShellTerminal({ cwdPath: "src" });
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "terminal.create",
      {
        workspaceId: "ws-test",
        cwdPath: "src",
      },
      undefined
    );
    expect(store.get(terminalIdsAtomFamily("ws-test"))).toEqual(["term_1", "term_2"]);
    expect(store.get(terminalActiveIdAtomFamily("ws-test"))).toBe("term_2");
    expect(store.get(terminalMetaAtomFamily("term_2"))).toMatchObject({
      id: "term_2",
      workspaceId: "ws-test",
      kind: "shell",
    });
  });

  it("shows a warning toast and returns null when no workspace is selected", async () => {
    const sendCommand = vi.fn();
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    const { result } = renderHook(() => useCreateShellTerminal(null), {
      wrapper: wrapperFor(store),
    });

    let terminal = "not-null";
    await act(async () => {
      terminal = await result.current.createShellTerminal();
    });

    expect(terminal).toBeNull();
    expect(sendCommand).not.toHaveBeenCalled();
    expect(store.get(toastsAtom)[0]).toMatchObject({
      kind: "warning",
      title: "No workspace selected",
      body: "Open or switch to a workspace before creating a terminal.",
    });
  });

  it("shows an error toast and leaves terminal atoms unchanged when terminal.create fails", async () => {
    const sendCommand = vi.fn().mockRejectedValue(new Error("spawn failed"));

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(terminalIdsAtomFamily("ws-test"), ["term_1"]);
    store.set(terminalActiveIdAtomFamily("ws-test"), "term_1");

    const { result } = renderHook(() => useCreateShellTerminal("ws-test"), {
      wrapper: wrapperFor(store),
    });

    let terminal = "not-null";
    await act(async () => {
      terminal = await result.current.createShellTerminal({ cwdPath: "src" });
    });

    expect(terminal).toBeNull();
    expect(store.get(terminalIdsAtomFamily("ws-test"))).toEqual(["term_1"]);
    expect(store.get(terminalActiveIdAtomFamily("ws-test"))).toBe("term_1");
    expect(store.get(toastsAtom)[0]).toMatchObject({
      kind: "error",
      title: "Could not create terminal",
      body: "spawn failed",
    });
  });
});
