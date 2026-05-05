import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../atoms/connection";
import { sessionsAtom } from "../../../atoms/sessions";
import { useSessionActions } from "./use-session-actions";

describe("useSessionActions", () => {
  it("removes ended sessions directly without issuing session.stop", async () => {
    const store = createStore();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.remove") {
        return undefined;
      }
      throw new Error(`Unexpected op: ${op}`);
    });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);
    store.set(sessionsAtom, {
      "sess-1": {
        id: "sess-1",
        workspaceId: "ws-1",
        terminalId: "term-1",
        providerId: "codex",
        state: "ended",
        capability: "full",
        startedAt: 1,
        lastActiveAt: 1,
        endedAt: 2,
      },
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { result } = renderHook(() => useSessionActions(), { wrapper });

    await act(async () => {
      await result.current.closeSession("sess-1");
    });

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith("session.remove", { sessionId: "sess-1" });
  });
});
