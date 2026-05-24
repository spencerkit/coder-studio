import { describe, expect, it } from "vitest";
import { HostCollector } from "../../monitoring/host-collector.js";

type CpuInfo = ReturnType<typeof import("node:os").cpus>[number];

describe("HostCollector", () => {
  it("computes cpu deltas and host pressure", () => {
    const collector = new HostCollector({
      platform: "linux",
      cpus: () =>
        [
          { times: { user: 100, nice: 0, sys: 0, idle: 900, irq: 0 } },
          { times: { user: 100, nice: 0, sys: 0, idle: 900, irq: 0 } },
        ] as CpuInfo[],
      totalmem: () => 1000,
      freemem: () => 300,
      uptime: () => 120,
      loadavg: () => [0.4, 0.3, 0.2],
    });

    collector.collect();
    const summary = collector.collect({
      cpus: [
        { times: { user: 160, nice: 0, sys: 0, idle: 940, irq: 0 } },
        { times: { user: 160, nice: 0, sys: 0, idle: 940, irq: 0 } },
      ] as CpuInfo[],
    });

    expect(summary.cpuPercent).toBe(60);
    expect(summary.memoryUsedBytes).toBe(700);
    expect(summary.pressure).toBe("normal");
  });

  it("marks load average unavailable on windows without failing the snapshot", () => {
    const collector = new HostCollector({
      platform: "win32",
      cpus: () => [{ times: { user: 10, nice: 0, sys: 0, idle: 90, irq: 0 } }] as CpuInfo[],
      totalmem: () => 1000,
      freemem: () => 600,
      uptime: () => 60,
      loadavg: () => [0, 0, 0],
    });

    const summary = collector.collect();

    expect(summary.loadAverage).toBeNull();
    expect(summary.pressure).toBe("unknown");
  });
});
