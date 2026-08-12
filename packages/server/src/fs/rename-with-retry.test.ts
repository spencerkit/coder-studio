import { describe, expect, it, vi } from "vitest";
import { renameSyncWithRetry, renameWithRetry } from "./rename-with-retry.js";

function fsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe("renameWithRetry", () => {
  it("retries transient async rename failures with backoff", async () => {
    let attempt = 0;
    const rename = vi.fn(async (_source: string, _destination: string) => {
      attempt += 1;
      if (attempt < 3) throw fsError("EPERM");
    });
    const wait = vi.fn(async (_delayMs: number) => undefined);

    await renameWithRetry("source.tmp", "destination", { rename, wait });

    expect(rename).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[10], [20]]);
  });

  it("does not retry non-transient async failures", async () => {
    const rename = vi.fn(async () => {
      throw fsError("ENOENT");
    });
    const wait = vi.fn();

    await expect(renameWithRetry("source.tmp", "destination", { rename, wait })).rejects.toThrow(
      /ENOENT/
    );
    expect(rename).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });
});

describe("renameSyncWithRetry", () => {
  it("retries transient synchronous rename failures with backoff", () => {
    let attempt = 0;
    const rename = vi.fn((_source: string, _destination: string) => {
      attempt += 1;
      if (attempt < 3) throw fsError("EBUSY");
    });
    const wait = vi.fn((_delayMs: number) => undefined);

    renameSyncWithRetry("source.tmp", "destination", { rename, wait });

    expect(rename).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[10], [20]]);
  });

  it("stops after the configured number of attempts", () => {
    const rename = vi.fn(() => {
      throw fsError("EACCES");
    });
    const wait = vi.fn();

    expect(() =>
      renameSyncWithRetry("source.tmp", "destination", { rename, wait, maxAttempts: 3 })
    ).toThrow(/EACCES/);
    expect(rename).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });
});
