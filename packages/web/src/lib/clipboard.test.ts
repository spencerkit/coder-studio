import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyTextWithFallback } from "./clipboard";

describe("copyTextWithFallback", () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
    });
    document.execCommand = originalExecCommand;
    document.body.innerHTML = "";
  });

  it("prefers navigator.clipboard.writeText", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const createElement = vi.spyOn(document, "createElement");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await copyTextWithFallback("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(createElement).not.toHaveBeenCalled();
  });

  it("falls back to document.execCommand('copy') when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    document.execCommand = execCommand;

    await copyTextWithFallback("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("rethrows the clipboard error when fallback is unavailable", async () => {
    const error = new Error("denied");
    const writeText = vi.fn().mockRejectedValue(error);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    Object.defineProperty(document, "execCommand", {
      value: undefined,
      configurable: true,
    });

    await expect(copyTextWithFallback("hello")).rejects.toThrow(error);
  });
});
