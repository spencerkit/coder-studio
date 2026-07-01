import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runWslRuntimeEntrypoint = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@coder-studio/server", () => ({
  runWslRuntimeEntrypoint,
}));

describe("wsl-runtime-entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("exports a callable wrapper without running on import", async () => {
    const module = await import("./wsl-runtime-entry.js");

    expect(runWslRuntimeEntrypoint).not.toHaveBeenCalled();

    await module.runWslRuntimeEntrypoint();

    expect(runWslRuntimeEntrypoint).toHaveBeenCalledTimes(1);
  });

  it("runs the WSL runtime entrypoint when executed directly", async () => {
    const entryPath = fileURLToPath(new URL("./wsl-runtime-entry.ts", import.meta.url));
    const argvSpy = vi.spyOn(process, "argv", "get").mockReturnValue(["node", entryPath]);

    try {
      await import("./wsl-runtime-entry.js");
      expect(runWslRuntimeEntrypoint).toHaveBeenCalledTimes(1);
    } finally {
      argvSpy.mockRestore();
    }
  });
});
