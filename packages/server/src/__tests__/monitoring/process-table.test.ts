import { describe, expect, it } from "vitest";
import {
  parseDarwinPsRows,
  parseLinuxPsRows,
  parseWindowsProcessRows,
} from "../../monitoring/process-table/index.js";

describe("process table adapters", () => {
  it("parses macOS ps output into normalized rows", () => {
    const rows = parseDarwinPsRows(
      "  101   1   6.5  2048   42 /usr/bin/node node server.js\n  202 101   1.5  1024   20 /bin/bash bash"
    );

    expect(rows).toEqual([
      {
        pid: 101,
        ppid: 1,
        cpuPercent: 6.5,
        rssBytes: 2048 * 1024,
        elapsedSec: 42,
        executable: "/usr/bin/node",
        command: "node server.js",
      },
      {
        pid: 202,
        ppid: 101,
        cpuPercent: 1.5,
        rssBytes: 1024 * 1024,
        elapsedSec: 20,
        executable: "/bin/bash",
        command: "bash",
      },
    ]);
  });

  it("parses linux ps output into normalized rows", () => {
    const rows = parseLinuxPsRows(
      "101 1 12.0 8096 99 /usr/bin/node node server.js\n202 101 0.8 2048 12 /usr/bin/python python worker.py"
    );

    expect(rows[0]?.pid).toBe(101);
    expect(rows[0]?.rssBytes).toBe(8096 * 1024);
    expect(rows[1]?.ppid).toBe(101);
  });

  it("parses windows powershell json rows into normalized rows", () => {
    const rows = parseWindowsProcessRows([
      {
        Id: 500,
        ParentProcessId: 1,
        CpuPercent: 4.25,
        WorkingSet64: 4096,
        ElapsedSec: 30,
        Path: "C:\\node.exe",
        CommandLine: "node server.js",
      },
    ]);

    expect(rows).toEqual([
      {
        pid: 500,
        ppid: 1,
        cpuPercent: 4.25,
        rssBytes: 4096,
        elapsedSec: 30,
        executable: "C:\\node.exe",
        command: "node server.js",
      },
    ]);
  });
});
