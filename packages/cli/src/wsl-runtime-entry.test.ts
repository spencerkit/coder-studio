import { describe, expect, it, vi } from "vitest";

const runWslRuntimeEntrypoint = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@coder-studio/runtime", () => ({
  runWslRuntimeEntrypoint,
}));

describe("wsl-runtime-entry", () => {
  it("starts the WSL runtime when imported", async () => {
    await import("./wsl-runtime-entry.js");

    expect(runWslRuntimeEntrypoint).toHaveBeenCalledTimes(1);
  });
});
