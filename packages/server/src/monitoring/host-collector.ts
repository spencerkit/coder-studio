import os from "node:os";
import type { MonitoringHostSummary } from "@coder-studio/core";

type CpuInfo = ReturnType<typeof os.cpus>[number];
type CpuTimes = Pick<CpuInfo["times"], "user" | "nice" | "sys" | "idle" | "irq">;

function sumCpuTimes(cpus: CpuInfo[]): CpuTimes {
  return cpus.reduce<CpuTimes>(
    (acc, cpu) => ({
      user: acc.user + cpu.times.user,
      nice: acc.nice + cpu.times.nice,
      sys: acc.sys + cpu.times.sys,
      idle: acc.idle + cpu.times.idle,
      irq: acc.irq + cpu.times.irq,
    }),
    { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
  );
}

export class HostCollector {
  private previousCpu: CpuTimes | null = null;

  constructor(
    private readonly deps: {
      platform?: NodeJS.Platform;
      cpus?: () => CpuInfo[];
      totalmem?: () => number;
      freemem?: () => number;
      uptime?: () => number;
      loadavg?: () => number[];
    } = {}
  ) {}

  collect(overrides: { cpus?: CpuInfo[] } = {}): MonitoringHostSummary {
    const cpus = overrides.cpus ?? this.deps.cpus?.() ?? os.cpus();
    const currentCpu = sumCpuTimes(cpus);
    const previousCpu = this.previousCpu;
    this.previousCpu = currentCpu;

    let cpuPercent: number | null = null;
    if (previousCpu) {
      const busyDelta =
        currentCpu.user +
        currentCpu.nice +
        currentCpu.sys +
        currentCpu.irq -
        (previousCpu.user + previousCpu.nice + previousCpu.sys + previousCpu.irq);
      const idleDelta = currentCpu.idle - previousCpu.idle;

      if (busyDelta + idleDelta > 0) {
        cpuPercent = Number(((busyDelta / (busyDelta + idleDelta)) * 100).toFixed(2));
      }
    }

    const memoryTotalBytes = this.deps.totalmem?.() ?? os.totalmem();
    const memoryAvailableBytes = this.deps.freemem?.() ?? os.freemem();
    const memoryUsedBytes = memoryTotalBytes - memoryAvailableBytes;
    const uptimeSec = this.deps.uptime?.() ?? os.uptime();
    const platform = this.deps.platform ?? process.platform;
    const loadAverage =
      platform === "win32"
        ? null
        : ((this.deps.loadavg?.() ?? os.loadavg()).slice(0, 3) as [number, number, number]);

    const memoryRatio = memoryTotalBytes > 0 ? memoryUsedBytes / memoryTotalBytes : null;
    const pressure =
      cpuPercent == null || memoryRatio == null
        ? "unknown"
        : cpuPercent >= 90 || memoryRatio >= 0.9
          ? "hot"
          : cpuPercent >= 70 || memoryRatio >= 0.75
            ? "elevated"
            : "normal";

    return {
      cpuPercent,
      memoryUsedBytes,
      memoryTotalBytes,
      memoryAvailableBytes,
      loadAverage,
      uptimeSec,
      pressure,
    };
  }
}
