import { describe, expect, it } from "vitest";
import { ActivationManager } from "../ws/activation.js";
import { type CommandContext, dispatch } from "../ws/dispatch.js";
import "../commands/activation.js";

describe("activation commands", () => {
  it("returns generation data from activation.claim", async () => {
    const ctx = {
      activationMgr: new ActivationManager(),
    } as unknown as CommandContext;

    const result = await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000001",
        op: "activation.claim",
        args: { clientInstanceId: "client-a" },
      },
      ctx,
      "ws-a"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      active: true,
      generation: 1,
      recoveryMode: "fresh",
    });
  });

  it("rejects non-activation commands when activation is missing", async () => {
    const ctx = {
      activationMgr: new ActivationManager(),
    } as unknown as CommandContext;

    const result = await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000002",
        op: "workspace.list",
        args: {},
      },
      ctx,
      "ws-a"
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("activation_required");
  });
});
