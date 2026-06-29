import { describe, expect, it, vi } from "vitest";

const runWslRuntimeEntrypoint = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@coder-studio/server", () => ({
  runWslRuntimeEntrypoint,
}));

describe("wsl-runtime-entry", () => {
  it("exports a callable wrapper without running on import", async () => {
    const module = await import("./wsl-runtime-entry.js");

    expect(runWslRuntimeEntrypoint).not.toHaveBeenCalled();

    await module.runWslRuntimeEntrypoint();

    expect(runWslRuntimeEntrypoint).toHaveBeenCalledTimes(1);
  });
});
