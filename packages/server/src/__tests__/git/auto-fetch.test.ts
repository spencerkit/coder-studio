import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutoFetchScheduler } from "../../git/auto-fetch.js";

describe("AutoFetchScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("fetches immediately for a newly viewed workspace and does not refetch before the period", async () => {
    let now = 1_000;
    const runFetch = vi.fn(async () => {});
    const settingsRepo = {
      get: vi.fn((key: string) => (key === "git.autofetchPeriodSec" ? 180 : undefined)),
    };
    const scheduler = new AutoFetchScheduler({
      workspaceMgr: { get: vi.fn((id: string) => ({ id })) },
      eventBus: {} as never,
      settingsRepo: settingsRepo as never,
      runFetch,
      now: () => now,
      setTimeout,
    });

    scheduler.registerViewer("client-1", "ws-1");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(runFetch).toHaveBeenCalledWith("ws-1");

    now += 179_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runFetch).toHaveBeenCalledTimes(1);

    now += 2_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runFetch).toHaveBeenCalledTimes(2);
  });

  it("backs off after three consecutive failures until the last viewer leaves", async () => {
    let now = 5_000;
    const runFetch = vi.fn(async () => {
      throw new Error("boom");
    });
    const scheduler = new AutoFetchScheduler({
      workspaceMgr: { get: vi.fn((id: string) => ({ id })) },
      eventBus: {} as never,
      settingsRepo: { get: vi.fn(() => 1) } as never,
      runFetch,
      now: () => now,
      setTimeout,
    });

    scheduler.registerViewer("client-1", "ws-1");
    await vi.advanceTimersByTimeAsync(1_100);
    now += 1_100;
    await vi.advanceTimersByTimeAsync(1_100);
    now += 1_100;
    await vi.advanceTimersByTimeAsync(1_100);
    now += 1_100;
    await vi.advanceTimersByTimeAsync(1_100);

    expect(runFetch).toHaveBeenCalledTimes(3);

    scheduler.unregisterViewer("client-1");
    scheduler.registerViewer("client-1", "ws-1");
    now += 1_100;
    await vi.advanceTimersByTimeAsync(1_100);

    expect(runFetch).toHaveBeenCalledTimes(4);
  });

  it("resets the schedule when manual recordFetch is called", async () => {
    let now = 10_000;
    const runFetch = vi.fn(async () => {});
    const scheduler = new AutoFetchScheduler({
      workspaceMgr: { get: vi.fn((id: string) => ({ id })) },
      eventBus: {} as never,
      settingsRepo: { get: vi.fn(() => 2) } as never,
      runFetch,
      now: () => now,
      setTimeout,
    });

    scheduler.registerViewer("client-1", "ws-1");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runFetch).toHaveBeenCalledTimes(1);

    scheduler.recordSuccess("ws-1");
    now += 1_500;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runFetch).toHaveBeenCalledTimes(1);

    now += 1_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runFetch).toHaveBeenCalledTimes(2);
  });

  it("triggers open-time fetch unless the workspace was fetched in the last five minutes", async () => {
    let now = 20_000;
    const runFetch = vi.fn(async () => {});
    const scheduler = new AutoFetchScheduler({
      workspaceMgr: { get: vi.fn((id: string) => ({ id })) },
      eventBus: {} as never,
      settingsRepo: { get: vi.fn(() => 180) } as never,
      runFetch,
      now: () => now,
      setTimeout,
    });

    scheduler.triggerOpenTimeFetch("ws-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(runFetch).toHaveBeenCalledTimes(1);

    scheduler.recordSuccess("ws-1");
    scheduler.triggerOpenTimeFetch("ws-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(runFetch).toHaveBeenCalledTimes(1);

    now += 5 * 60 * 1000 + 1;
    scheduler.triggerOpenTimeFetch("ws-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(runFetch).toHaveBeenCalledTimes(2);
  });

  it("does not run periodic fetches when period is set to 0", async () => {
    let now = 30_000;
    const runFetch = vi.fn(async () => {});
    const scheduler = new AutoFetchScheduler({
      workspaceMgr: { get: vi.fn((id: string) => ({ id })) },
      eventBus: {} as never,
      settingsRepo: { get: vi.fn(() => 0) } as never,
      runFetch,
      now: () => now,
      setTimeout,
    });

    scheduler.registerViewer("client-1", "ws-1");
    now += 10 * 60 * 1000;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(runFetch).not.toHaveBeenCalled();

    scheduler.triggerOpenTimeFetch("ws-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(runFetch).toHaveBeenCalledTimes(1);
  });

  it("serializes background fetch behind a foreground git operation", async () => {
    let now = 40_000;
    let releaseForeground: (() => void) | null = null;
    const runFetch = vi.fn(async () => {});
    const scheduler = new AutoFetchScheduler({
      workspaceMgr: { get: vi.fn((id: string) => ({ id })) },
      eventBus: {} as never,
      settingsRepo: { get: vi.fn(() => 1) } as never,
      runFetch,
      now: () => now,
      setTimeout,
    });

    const foreground = scheduler.runExclusive!("ws-1", async () => {
      await new Promise<void>((resolve) => {
        releaseForeground = resolve;
      });
    });

    scheduler.registerViewer("client-1", "ws-1");
    now += 1_100;
    await vi.advanceTimersByTimeAsync(1_100);
    expect(runFetch).not.toHaveBeenCalled();

    expect(releaseForeground).not.toBeNull();
    releaseForeground!();
    await foreground;
    await vi.advanceTimersByTimeAsync(1_100);

    expect(runFetch).toHaveBeenCalledTimes(1);
  });
});
