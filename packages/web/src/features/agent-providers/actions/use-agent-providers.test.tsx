// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../atoms/connection";
import { useAgentProviders } from "./use-agent-providers";

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe("useAgentProviders", () => {
  it("loads provider.list through websocket dispatch", async () => {
    const sendCommand = vi.fn().mockResolvedValue([
      {
        id: "claude",
        displayName: "Claude Code",
        badge: "Claude",
        kind: "built_in",
        capability: "full",
        capabilities: [
          { key: "interactive_session", supported: true, label: "Interactive session" },
          { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
          { key: "idle_detection", supported: true, label: "Idle detection" },
          { key: "context_attach", supported: false, label: "Context attach" },
          { key: "review", supported: false, label: "Review" },
        ],
        requiredCommands: ["claude"],
      },
      {
        id: "codex",
        displayName: "Codex",
        badge: "Codex",
        kind: "built_in",
        capability: "full",
        capabilities: [
          { key: "interactive_session", supported: true, label: "Interactive session" },
          { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
          { key: "idle_detection", supported: true, label: "Idle detection" },
          { key: "context_attach", supported: false, label: "Context attach" },
          { key: "review", supported: false, label: "Review" },
        ],
        requiredCommands: ["codex"],
      },
    ]);

    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    const { result } = renderHook(() => useAgentProviders(), {
      wrapper: wrapperFor(store),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(sendCommand).toHaveBeenCalledWith("provider.list", {}, undefined);
    expect(result.current.error).toBeNull();
    expect(result.current.providers).toEqual([
      expect.objectContaining({
        id: "claude",
        kind: "built_in",
      }),
      expect.objectContaining({
        id: "codex",
        kind: "built_in",
      }),
    ]);
  });
});
