import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../../ws/dispatch.js";
import { dispatch } from "../../ws/dispatch.js";
import "../../commands/monitoring.js";

describe("monitoring commands", () => {
  it("dispatches monitoring.get", async () => {
    const ctx = {
      monitoringService: {
        getResponse: vi.fn(() => ({ snapshot: { sampledAt: 1 } })),
      },
    } as unknown as CommandContext;

    const result = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "monitoring.get",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ snapshot: { sampledAt: 1 } });
  });

  it("dispatches monitoring.recheck", async () => {
    const ctx = {
      monitoringService: {
        recheck: vi.fn(async () => ({ snapshot: { sampledAt: 2 } })),
      },
    } as unknown as CommandContext;

    const result = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "monitoring.recheck",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ snapshot: { sampledAt: 2 } });
  });
});
