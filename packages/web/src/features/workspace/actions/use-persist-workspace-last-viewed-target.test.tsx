import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { lastViewedTargetAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { CommandResultError } from "../../../ws/client";
import { usePersistWorkspaceLastViewedTarget } from "./use-persist-workspace-last-viewed-target";

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe("usePersistWorkspaceLastViewedTarget", () => {
  it("does not suppress a retry for the same target after a failed write", async () => {
    const store = createStore();
    const sendCommand = vi
      .fn()
      .mockRejectedValueOnce(
        new CommandResultError({
          code: "write_failed",
          message: "failed",
        })
      )
      .mockResolvedValueOnce({
        workspaceId: "ws-2",
        updatedAt: 11,
      });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);
    store.set(lastViewedTargetAtom, null);

    const { result } = renderHook(() => usePersistWorkspaceLastViewedTarget(), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current({ workspaceId: "ws-2" });
    });

    await act(async () => {
      await result.current({ workspaceId: "ws-2" });
    });

    expect(sendCommand).toHaveBeenNthCalledWith(
      1,
      "workspace.lastViewedTarget.set",
      { workspaceId: "ws-2", sessionId: undefined },
      undefined
    );
    expect(sendCommand).toHaveBeenNthCalledWith(
      2,
      "workspace.lastViewedTarget.set",
      { workspaceId: "ws-2", sessionId: undefined },
      undefined
    );
  });
});
