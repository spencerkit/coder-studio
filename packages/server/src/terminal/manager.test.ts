// Unit tests for TerminalManager

import type { DomainEvent, Terminal } from "@coder-studio/core";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { EventBus } from "../bus/event-bus";
import { computeColorFgBg, TerminalManager } from "./manager";
import { RingBuffer } from "./ring-buffer";
import * as snapshotBufferModule from "./terminal-snapshot-buffer";
import type { PtyHost, PtyProcess, TerminalDatabase, TerminalSpec } from "./types";

describe("TerminalManager", () => {
  let manager: TerminalManager;
  let mockPtyHost: PtyHost;
  let eventBus: EventBus;
  let mockDb: TerminalDatabase;
  let mockPty: PtyProcess;

  beforeEach(() => {
    // Create mock PTY process
    mockPty = {
      pid: 43210,
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn().mockResolvedValue(undefined),
    };

    // Create mock PTY host
    mockPtyHost = {
      spawn: vi.fn().mockReturnValue(mockPty),
    };

    // Create event bus
    eventBus = new EventBus();

    // Create mock database
    mockDb = {
      insert: vi.fn(),
      markEnded: vi.fn(),
    };

    manager = new TerminalManager({
      ptyHost: mockPtyHost,
      eventBus,
      db: mockDb,
    });
  });

  describe("create", () => {
    it("should create terminal with PTY process", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      const terminal = manager.create(spec);

      expect(terminal.id).toBeDefined();
      expect(terminal.workspaceId).toBe(spec.workspaceId);
      expect(terminal.kind).toBe(spec.kind);
      expect(terminal.pid).toBe(43210);
      expect(terminal.argv).toEqual(spec.argv);
      expect(terminal.cwd).toBe(spec.cwd);
      expect(terminal.alive).toBe(true);

      // Should spawn PTY
      expect(mockPtyHost.spawn).toHaveBeenCalledWith(
        spec.argv,
        expect.objectContaining({
          cwd: spec.cwd,
          cols: 120,
          rows: 30,
        })
      );

      // Should persist to database
      expect(mockDb.insert).toHaveBeenCalledWith(terminal);

      // Should wire up events
      expect(mockPty.onData).toHaveBeenCalled();
      expect(mockPty.onExit).toHaveBeenCalled();
    });

    it("should use custom cols and rows", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
        cols: 80,
        rows: 24,
      };

      manager.create(spec);

      expect(mockPtyHost.spawn).toHaveBeenCalledWith(
        spec.argv,
        expect.objectContaining({
          cols: 80,
          rows: 24,
        })
      );
    });

    it("should merge environment variables", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
        env: {
          MY_VAR: "my_value",
        },
      };

      manager.create(spec);

      const spawnOptions = (mockPtyHost.spawn as Mock).mock.calls[0][1];
      expect(spawnOptions.env.MY_VAR).toBe("my_value");
    });

    it("forces color env vars regardless of parent env", () => {
      vi.stubEnv("TERM", "screen-256color");
      vi.stubEnv("COLORTERM", "");
      vi.stubEnv("FORCE_COLOR", "0");

      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      try {
        manager.create(spec);

        const spawnOptions = (mockPtyHost.spawn as Mock).mock.calls[0][1];
        expect(spawnOptions.env.TERM).toBe("xterm-256color");
        expect(spawnOptions.env.COLORTERM).toBe("truecolor");
        expect(spawnOptions.env.FORCE_COLOR).toBe("3");
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("allows spec.env to override color env vars when explicitly provided", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
        env: {
          TERM: "dumb",
          FORCE_COLOR: "0",
        },
      };

      manager.create(spec);

      const spawnOptions = (mockPtyHost.spawn as Mock).mock.calls[0][1];
      expect(spawnOptions.env.TERM).toBe("dumb");
      expect(spawnOptions.env.COLORTERM).toBe("truecolor");
      expect(spawnOptions.env.FORCE_COLOR).toBe("0");
    });

    it("injects COLORFGBG=0;15 for a light themeBackground", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
        themeBackground: "#fcfffd",
      };

      manager.create(spec);

      const spawnOptions = (mockPtyHost.spawn as Mock).mock.calls[0][1];
      expect(spawnOptions.env.COLORFGBG).toBe("0;15");
    });

    it("injects COLORFGBG=15;0 for a dark themeBackground", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
        themeBackground: "#0b1218",
      };

      manager.create(spec);

      const spawnOptions = (mockPtyHost.spawn as Mock).mock.calls[0][1];
      expect(spawnOptions.env.COLORFGBG).toBe("15;0");
    });

    it("omits COLORFGBG when themeBackground is not provided", () => {
      vi.stubEnv("COLORFGBG", "0;15");

      try {
        const spec: TerminalSpec = {
          workspaceId: "ws-123",
          kind: "shell",
          argv: ["bash"],
          cwd: "/home/user",
        };

        manager.create(spec);

        const spawnOptions = (mockPtyHost.spawn as Mock).mock.calls[0][1];
        expect(spawnOptions.env.COLORFGBG).toBeUndefined();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("omits COLORFGBG when themeBackground is malformed", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
        themeBackground: "not-a-color",
      };

      manager.create(spec);

      const spawnOptions = (mockPtyHost.spawn as Mock).mock.calls[0][1];
      expect(spawnOptions.env.COLORFGBG).toBeUndefined();
    });

    it("lets spec.env override the derived COLORFGBG when explicitly set", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
        themeBackground: "#fcfffd",
        env: {
          COLORFGBG: "7;0",
        },
      };

      manager.create(spec);

      const spawnOptions = (mockPtyHost.spawn as Mock).mock.calls[0][1];
      expect(spawnOptions.env.COLORFGBG).toBe("7;0");
    });
  });

  describe("computeColorFgBg", () => {
    it.each([
      ["#ffffff", "0;15"],
      ["#fcfffd", "0;15"],
      ["#f5f7fa", "0;15"],
      ["#fff", "0;15"],
    ])("returns 0;15 (light bg) for %s", (input, expected) => {
      expect(computeColorFgBg(input)).toBe(expected);
    });

    it.each([
      ["#000000", "15;0"],
      ["#0b1218", "15;0"],
      ["#2e3440", "15;0"],
      ["#000", "15;0"],
    ])("returns 15;0 (dark bg) for %s", (input, expected) => {
      expect(computeColorFgBg(input)).toBe(expected);
    });

    it("accepts #RRGGBBAA and ignores the alpha channel", () => {
      expect(computeColorFgBg("#ffffff80")).toBe("0;15");
      expect(computeColorFgBg("#00000080")).toBe("15;0");
    });

    it("returns undefined for malformed input", () => {
      expect(computeColorFgBg("")).toBeUndefined();
      expect(computeColorFgBg("white")).toBeUndefined();
      expect(computeColorFgBg("#xyz")).toBeUndefined();
      expect(computeColorFgBg("#12")).toBeUndefined();
      expect(computeColorFgBg("rgb(0,0,0)")).toBeUndefined();
    });

    it("should throw error on spawn failure", () => {
      const spawnError = new Error("Command not found");
      mockPtyHost.spawn = vi.fn().mockImplementation(() => {
        throw spawnError;
      });

      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["invalid-command"],
        cwd: "/home/user",
      };

      expect(() => manager.create(spec)).toThrow("Terminal spawn failed");
    });

    it("creates a snapshot buffer for shell and agent terminals", () => {
      const shell = manager.create({
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      });
      const agent = manager.create({
        workspaceId: "ws-123",
        kind: "agent",
        argv: ["node", "agent.js"],
        cwd: "/home/user",
      });

      expect(manager.get(shell.id)?.snapshotBuffer).toBeDefined();
      expect(manager.get(agent.id)?.snapshotBuffer).toBeDefined();
    });

    it("degrades gracefully when the snapshot buffer fails to initialize", async () => {
      const snapshotCtorSpy = vi
        .spyOn(snapshotBufferModule, "HeadlessSnapshotBuffer")
        .mockImplementation(
          class MockHeadlessSnapshotBuffer {
            constructor() {
              throw new Error("headless init failed");
            }
          } as unknown as typeof snapshotBufferModule.HeadlessSnapshotBuffer
        );

      try {
        const terminal = manager.create({
          workspaceId: "ws-123",
          kind: "agent",
          argv: ["node", "agent.js"],
          cwd: "/home/user",
        });

        expect(terminal.alive).toBe(true);
        expect(mockPtyHost.spawn).toHaveBeenCalledTimes(1);
        expect(manager.get(terminal.id)?.snapshotBuffer).toBeUndefined();
        await expect(manager.snapshot(terminal.id)).resolves.toEqual({
          status: "unsupported",
        });
      } finally {
        snapshotCtorSpy.mockRestore();
      }
    });

    it("degrades gracefully when the shell snapshot buffer fails to initialize", async () => {
      const snapshotCtorSpy = vi
        .spyOn(snapshotBufferModule, "HeadlessSnapshotBuffer")
        .mockImplementation(
          class MockHeadlessSnapshotBuffer {
            constructor() {
              throw new Error("headless init failed");
            }
          } as unknown as typeof snapshotBufferModule.HeadlessSnapshotBuffer
        );

      try {
        const terminal = manager.create({
          workspaceId: "ws-123",
          kind: "shell",
          argv: ["bash"],
          cwd: "/home/user",
        });

        expect(terminal.alive).toBe(true);
        expect(mockPtyHost.spawn).toHaveBeenCalledTimes(1);
        expect(manager.get(terminal.id)?.snapshotBuffer).toBeUndefined();
        await expect(manager.snapshot(terminal.id)).resolves.toEqual({
          status: "unsupported",
        });
      } finally {
        snapshotCtorSpy.mockRestore();
      }
    });
  });

  describe("PTY event handling", () => {
    it("should emit terminal.output event on PTY data", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      const terminal = manager.create(spec);

      // Track emitted events
      const emittedEvents: Array<Extract<DomainEvent, { type: "terminal.output" }>> = [];
      eventBus.on("terminal.output", (event) => emittedEvents.push(event));

      // Get the onData callback
      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];

      // Simulate PTY output
      const output = "Hello, world!";
      onDataCallback(output);

      // Should emit terminal.output event
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        type: "terminal.output",
        workspaceId: spec.workspaceId,
        terminalId: terminal.id,
        chunk: Buffer.from(output),
        seq: output.length,
      });
    });

    describe("OSC 11 background injection", () => {
      const originalPlatform = process.platform;

      afterEach(() => {
        Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
      });

      it("injects OSC 11 background response on Windows when themeBackground is set", () => {
        Object.defineProperty(process, "platform", { configurable: true, value: "win32" });

        const spec: TerminalSpec = {
          workspaceId: "ws-123",
          kind: "agent",
          argv: ["gemini"],
          cwd: "/home/user",
          themeBackground: "#fcfffd",
        };

        manager.create(spec);

        const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];
        onDataCallback("\x1b]11;?\x1b\\");

        expect(mockPty.write).toHaveBeenCalledWith("\x1b]11;rgb:fcfc/ffff/fdfd\x1b\\");
      });

      it("does not inject OSC 11 background response on non-Windows platforms", () => {
        Object.defineProperty(process, "platform", { configurable: true, value: "linux" });

        const spec: TerminalSpec = {
          workspaceId: "ws-123",
          kind: "agent",
          argv: ["gemini"],
          cwd: "/home/user",
          themeBackground: "#fcfffd",
        };

        manager.create(spec);

        const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];
        onDataCallback("\x1b]11;?\x1b\\");

        expect(mockPty.write).not.toHaveBeenCalled();
      });

      it("does not inject OSC 11 background response without themeBackground", () => {
        Object.defineProperty(process, "platform", { configurable: true, value: "win32" });

        const spec: TerminalSpec = {
          workspaceId: "ws-123",
          kind: "agent",
          argv: ["gemini"],
          cwd: "/home/user",
        };

        manager.create(spec);

        const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];
        onDataCallback("\x1b]11;?\x1b\\");

        expect(mockPty.write).not.toHaveBeenCalled();
      });

      it("uses updated themeBackground after syncThemeBackgroundForWorkspace", () => {
        Object.defineProperty(process, "platform", { configurable: true, value: "win32" });

        const spec: TerminalSpec = {
          workspaceId: "ws-123",
          kind: "agent",
          argv: ["gemini"],
          cwd: "/home/user",
          themeBackground: "#fcfffd",
        };

        manager.create(spec);
        manager.syncThemeBackgroundForWorkspace("ws-123", "#0b1218");

        const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];
        onDataCallback("\x1b]11;?\x1b\\");

        expect(mockPty.write).toHaveBeenCalledWith("\x1b]11;rgb:0b0b/1212/1818\x1b\\");
      });
    });

    it("should handle PTY exit", async () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      const terminal = manager.create(spec);

      // Track emitted events
      const emittedEvents: Array<Extract<DomainEvent, { type: "terminal.exited" }>> = [];
      eventBus.on("terminal.exited", (event) => emittedEvents.push(event));

      // Get the onExit callback
      const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0];

      // Simulate PTY exit
      onExitCallback({ exitCode: 0 });

      // Should mark terminal as dead
      const activeTerminal = manager.get(terminal.id);
      expect(activeTerminal?.alive).toBe(false);
      expect(activeTerminal?.exitCode).toBe(0);

      // Should emit terminal.exited event
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        type: "terminal.exited",
        workspaceId: spec.workspaceId,
        terminalId: terminal.id,
        exitCode: 0,
      });

      // Should mark as ended in database
      expect(mockDb.markEnded).toHaveBeenCalledWith(terminal.id, expect.any(Number), 0);

      // Wait for cleanup timeout
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be removed from manager
      expect(manager.get(terminal.id)).toBeUndefined();
    });

    it("keeps replay live and marks snapshot unsupported when mirror writes fail", async () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "agent",
        argv: ["node", "agent.js"],
        cwd: "/home/user",
      };

      const terminal = manager.create(spec);
      const activeTerminal = manager.get(terminal.id);
      const emittedEvents: Array<Extract<DomainEvent, { type: "terminal.output" }>> = [];
      eventBus.on("terminal.output", (event) => emittedEvents.push(event));

      vi.spyOn(
        (activeTerminal!.snapshotBuffer! as unknown as { term: { write: () => void } }).term,
        "write"
      ).mockImplementation(() => {
        throw new Error("snapshot mirror exploded");
      });

      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];
      onDataCallback("live output");

      expect(emittedEvents).toHaveLength(1);
      expect(manager.replay(terminal.id, 0)).toMatchObject({
        status: "ok",
        data: Buffer.from("live output"),
        seq: 11,
      });
      await expect(manager.snapshot(terminal.id)).resolves.toEqual({
        status: "unsupported",
      });
    });

    it("keeps shell replay live and marks snapshot unsupported when mirror writes fail", async () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      const terminal = manager.create(spec);
      const activeTerminal = manager.get(terminal.id);
      const emittedEvents: Array<Extract<DomainEvent, { type: "terminal.output" }>> = [];
      eventBus.on("terminal.output", (event) => emittedEvents.push(event));

      vi.spyOn(
        (activeTerminal!.snapshotBuffer! as unknown as { term: { write: () => void } }).term,
        "write"
      ).mockImplementation(() => {
        throw new Error("snapshot mirror exploded");
      });

      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];
      onDataCallback("shell live output");

      expect(emittedEvents).toHaveLength(1);
      expect(manager.replay(terminal.id, 0)).toMatchObject({
        status: "ok",
        data: Buffer.from("shell live output"),
        seq: "shell live output".length,
      });
      await expect(manager.snapshot(terminal.id)).resolves.toEqual({
        status: "unsupported",
      });
    });

    it("keeps agent snapshots available until delayed exit cleanup runs", async () => {
      vi.useFakeTimers();

      try {
        const spec: TerminalSpec = {
          workspaceId: "ws-123",
          kind: "agent",
          argv: ["node", "agent.js"],
          cwd: "/home/user",
        };

        const terminal = manager.create(spec);
        const activeTerminal = manager.get(terminal.id);
        const disposeSpy = vi.spyOn(activeTerminal!.snapshotBuffer!, "dispose");
        const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];
        const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0];

        onDataCallback("snapshot me");
        await vi.runOnlyPendingTimersAsync();
        onExitCallback({ exitCode: 0 });

        await expect(manager.snapshot(terminal.id)).resolves.toMatchObject({
          status: "ok",
          seq: 11,
        });
        expect(disposeSpy).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1000);

        expect(disposeSpy).toHaveBeenCalledTimes(1);
        await expect(manager.snapshot(terminal.id)).resolves.toEqual({
          status: "unsupported",
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps shell snapshots available until delayed exit cleanup runs", async () => {
      vi.useFakeTimers();

      try {
        const spec: TerminalSpec = {
          workspaceId: "ws-123",
          kind: "shell",
          argv: ["bash"],
          cwd: "/home/user",
        };

        const terminal = manager.create(spec);
        const activeTerminal = manager.get(terminal.id);
        const disposeSpy = vi.spyOn(activeTerminal!.snapshotBuffer!, "dispose");
        const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];
        const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0];

        onDataCallback("shell snapshot");
        await vi.runOnlyPendingTimersAsync();
        onExitCallback({ exitCode: 0 });

        await expect(manager.snapshot(terminal.id)).resolves.toMatchObject({
          status: "ok",
          seq: "shell snapshot".length,
        });
        expect(disposeSpy).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1000);

        expect(disposeSpy).toHaveBeenCalledTimes(1);
        await expect(manager.snapshot(terminal.id)).resolves.toEqual({
          status: "unsupported",
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("write", () => {
    it("should write data to PTY", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      const terminal = manager.create(spec);
      const data = Buffer.from("ls -la\n");

      manager.write(terminal.id, data);

      expect(mockPty.write).toHaveBeenCalledWith(data);
    });

    it("should throw error when terminal not found", () => {
      expect(() => manager.write("nonexistent", Buffer.from("test"))).toThrow("Terminal not found");
    });

    it("should throw error when terminal not alive", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      const terminal = manager.create(spec);

      // Kill terminal
      const activeTerminal = manager.get(terminal.id);
      if (activeTerminal) {
        activeTerminal.alive = false;
      }

      expect(() => manager.write(terminal.id, Buffer.from("test"))).toThrow(
        "Terminal is not alive"
      );
    });
  });

  describe("resize", () => {
    it("should resize terminal", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      const terminal = manager.create(spec);

      manager.resize(terminal.id, 100, 40);

      expect(mockPty.resize).toHaveBeenCalledWith(100, 40);
    });

    it("resizes the PTY before resizing the snapshot mirror", () => {
      const terminal = manager.create({
        workspaceId: "ws-123",
        kind: "agent",
        argv: ["node", "agent.js"],
        cwd: "/home/user",
      });

      const snapshotResizeSpy = vi
        .spyOn(manager.get(terminal.id)!.snapshotBuffer!, "resize")
        .mockImplementation(() => {});

      manager.resize(terminal.id, 100, 40);

      const ptyResizeOrder = (mockPty.resize as Mock).mock.invocationCallOrder[0];
      const snapshotResizeOrder = snapshotResizeSpy.mock.invocationCallOrder[0];

      expect(ptyResizeOrder).toBeLessThan(snapshotResizeOrder);
    });

    it("keeps shell snapshots renderable after resize and reports the new dimensions", async () => {
      const terminal = manager.create({
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      });
      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];

      manager.resize(terminal.id, 100, 40);
      onDataCallback("after resize\n");

      await expect(manager.snapshot(terminal.id)).resolves.toMatchObject({
        status: "ok",
        cols: 100,
        rows: 40,
        seq: "after resize\n".length,
      });
      await expect(
        manager.getRenderedSnapshot(terminal.id, { maxLines: 10, maxChars: 1000 })
      ).resolves.toBe("after resize");
    });

    it("should fail silently when terminal not found", () => {
      // Should not throw
      manager.resize("nonexistent", 100, 40);
    });

    it("should fail silently when terminal not alive", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      const terminal = manager.create(spec);

      // Kill terminal
      const activeTerminal = manager.get(terminal.id);
      if (activeTerminal) {
        activeTerminal.alive = false;
      }

      // Should not throw
      manager.resize(terminal.id, 100, 40);
    });
  });

  describe("kill", () => {
    it("should kill terminal process", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      const terminal = manager.create(spec);

      manager.kill(terminal.id);

      expect(mockPty.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("should kill with custom signal", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      const terminal = manager.create(spec);

      manager.kill(terminal.id, "SIGKILL");

      expect(mockPty.kill).toHaveBeenCalledWith("SIGKILL");
    });

    it("should do nothing when terminal not found", () => {
      // Should not throw
      manager.kill("nonexistent");
    });

    it("kills only live terminals that belong to the target workspace", () => {
      const first = manager.create({
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      });
      const second = manager.create({
        workspaceId: "ws-123",
        kind: "agent",
        argv: ["node", "agent.js"],
        cwd: "/home/user",
      });
      manager.create({
        workspaceId: "ws-999",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/other",
      });

      manager.get(second.id)!.alive = false;
      (mockPty.kill as Mock).mockClear();

      manager.killForWorkspace("ws-123");

      expect(mockPty.kill).toHaveBeenCalledTimes(1);
      expect(mockPty.kill).toHaveBeenCalledWith("SIGTERM");
      expect(manager.get(first.id)?.spec.workspaceId).toBe("ws-123");
    });

    it("does not dispose the snapshot buffer before the PTY exit cleanup window", () => {
      const terminal = manager.create({
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      });

      const disposeSpy = vi.spyOn(manager.get(terminal.id)!.snapshotBuffer!, "dispose");

      manager.kill(terminal.id);

      expect(mockPty.kill).toHaveBeenCalledWith("SIGTERM");
      expect(disposeSpy).not.toHaveBeenCalled();
    });

    it("waits for PTY exit before resolving an explicit close", async () => {
      const terminal = manager.create({
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      });

      const closePromise = manager.close(terminal.id);
      let resolved = false;
      void closePromise.then(() => {
        resolved = true;
      });

      await Promise.resolve();

      expect(mockPty.kill).toHaveBeenCalledWith("SIGTERM");
      expect(resolved).toBe(false);

      const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0];
      onExitCallback({ exitCode: 0 });

      await closePromise;

      expect(resolved).toBe(true);
    });

    it("waits for PTY kill cleanup to finish before resolving an explicit close", async () => {
      const terminal = manager.create({
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      });

      let releaseKill: (() => void) | undefined;
      (mockPty.kill as Mock).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseKill = resolve;
          })
      );

      const closePromise = manager.close(terminal.id);
      let resolved = false;
      void closePromise.then(() => {
        resolved = true;
      });

      const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0];
      onExitCallback({ exitCode: 0 });
      await Promise.resolve();

      expect(resolved).toBe(false);

      releaseKill?.();
      await closePromise;

      expect(resolved).toBe(true);
    });

    it("disposes the snapshot buffer and removes the terminal immediately after explicit close exit", async () => {
      vi.useFakeTimers();

      try {
        const terminal = manager.create({
          workspaceId: "ws-123",
          kind: "shell",
          argv: ["bash"],
          cwd: "/home/user",
        });

        const activeTerminal = manager.get(terminal.id)!;
        const disposeSpy = vi.spyOn(activeTerminal.snapshotBuffer!, "dispose");
        const closePromise = manager.close(terminal.id);
        const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0];

        onExitCallback({ exitCode: 0 });
        await closePromise;

        expect(disposeSpy).toHaveBeenCalledTimes(1);
        expect(manager.get(terminal.id)).toBeUndefined();

        await vi.advanceTimersByTimeAsync(1000);

        expect(disposeSpy).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("immediately cleans up an already-exited terminal when explicitly closed during replay grace", async () => {
      vi.useFakeTimers();

      try {
        const terminal = manager.create({
          workspaceId: "ws-123",
          kind: "shell",
          argv: ["bash"],
          cwd: "/home/user",
        });

        const activeTerminal = manager.get(terminal.id)!;
        const disposeSpy = vi.spyOn(activeTerminal.snapshotBuffer!, "dispose");
        const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0];

        onExitCallback({ exitCode: 0 });
        expect(manager.get(terminal.id)).toBeDefined();
        expect(disposeSpy).not.toHaveBeenCalled();

        await manager.close(terminal.id);

        expect(disposeSpy).toHaveBeenCalledTimes(1);
        expect(manager.get(terminal.id)).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not hang the original explicit close when a second close arrives after exit", async () => {
      const terminal = manager.create({
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      });

      let releaseKill: (() => void) | undefined;
      (mockPty.kill as Mock).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseKill = resolve;
          })
      );

      const firstClose = manager.close(terminal.id);
      const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0];
      onExitCallback({ exitCode: 0 });

      const secondClose = manager.close(terminal.id);
      let firstResolved = false;
      void firstClose.then(() => {
        firstResolved = true;
      });
      let secondResolved = false;
      void secondClose.then(() => {
        secondResolved = true;
      });

      await Promise.resolve();
      expect(firstResolved).toBe(false);
      expect(secondResolved).toBe(false);

      releaseKill?.();
      await secondClose;
      await firstClose;

      expect(firstResolved).toBe(true);
      expect(secondResolved).toBe(true);
    });

    it("waits for all matching terminals to finish explicit workspace close", async () => {
      const first = manager.create({
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      });
      const second = manager.create({
        workspaceId: "ws-123",
        kind: "agent",
        argv: ["node", "agent.js"],
        cwd: "/home/user",
      });
      manager.create({
        workspaceId: "ws-999",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/other",
      });

      const closePromise = manager.closeForWorkspace("ws-123");
      let resolved = false;
      void closePromise.then(() => {
        resolved = true;
      });

      await Promise.resolve();

      expect(mockPty.kill).toHaveBeenCalledTimes(2);
      expect(resolved).toBe(false);

      const onExitCallbacks = (mockPty.onExit as Mock).mock.calls.map((call) => call[0]);
      onExitCallbacks[0]({ exitCode: 0 });
      await Promise.resolve();
      expect(resolved).toBe(false);

      onExitCallbacks[1]({ exitCode: 0 });
      await closePromise;

      expect(resolved).toBe(true);
      expect(manager.get(first.id)).toBeUndefined();
      expect(manager.get(second.id)).toBeUndefined();
    });

    it("cleans up already-exited workspace terminals that are still in replay grace", async () => {
      vi.useFakeTimers();

      try {
        const terminal = manager.create({
          workspaceId: "ws-123",
          kind: "agent",
          argv: ["node", "agent.js"],
          cwd: "/home/user",
        });
        const otherWorkspace = manager.create({
          workspaceId: "ws-999",
          kind: "agent",
          argv: ["node", "other.js"],
          cwd: "/home/other",
        });

        const disposeSpy = vi.spyOn(manager.get(terminal.id)!.snapshotBuffer!, "dispose");
        const onExitCallbacks = (mockPty.onExit as Mock).mock.calls.map((call) => call[0]);
        onExitCallbacks[0]({ exitCode: 0 });

        await manager.closeForWorkspace("ws-123");

        expect(disposeSpy).toHaveBeenCalledTimes(1);
        expect(manager.get(terminal.id)).toBeUndefined();
        expect(manager.get(otherWorkspace.id)).toBeDefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("replay", () => {
    it("should replay terminal output", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      const terminal = manager.create(spec);

      // Get the onData callback and simulate output
      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];
      onDataCallback("first output");
      onDataCallback("second output");

      // Replay from seq 0
      const result = manager.replay(terminal.id, 0);

      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.data.toString()).toBe("first outputsecond output");
      }
    });

    it("should return unknown when terminal not found", () => {
      const result = manager.replay("nonexistent", 0);

      expect(result.status).toBe("unknown");
    });

    it("returns unknown after terminal exit cleanup", async () => {
      vi.useFakeTimers();

      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "agent",
        argv: ["node", "agent.js"],
        cwd: "/home/user",
      };

      const terminal = manager.create(spec);
      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];
      const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0];

      try {
        onDataCallback("session output");
        await vi.runOnlyPendingTimersAsync();
        onExitCallback({ exitCode: 0 });

        await vi.advanceTimersByTimeAsync(1000);

        const result = manager.replay(terminal.id, 0);
        expect(result.status).toBe("unknown");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("inspectRecovery", () => {
    it("reports head seq and replay availability for a live terminal", () => {
      const terminal = manager.create({
        workspaceId: "ws-1",
        kind: "shell",
        argv: ["/bin/bash"],
        cwd: "/tmp",
        cols: 80,
        rows: 24,
        title: "bash",
      });

      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];
      onDataCallback("hello");

      expect(manager.inspectRecovery(terminal.id, 0)).toMatchObject({
        status: "ok",
        headSeq: 5,
        replay: { kind: "available", fromSeq: 0 },
        snapshot: { kind: "available" },
        alive: true,
      });
    });

    it("reports replay too old when the requested bytes are no longer recoverable", () => {
      const terminal = manager.create({
        workspaceId: "ws-1",
        kind: "shell",
        argv: ["/bin/bash"],
        cwd: "/tmp",
        cols: 80,
        rows: 24,
        title: "bash",
      });

      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];
      onDataCallback("abcdef");

      const active = manager.get(terminal.id)!;
      vi.spyOn(active.ringBuffer, "replayFrom").mockReturnValue({ status: "too_old" });

      expect(manager.inspectRecovery(terminal.id, 0)).toMatchObject({
        status: "ok",
        headSeq: 6,
        replay: { kind: "too_old" },
      });
    });
  });

  describe("snapshot", () => {
    it("returns a binary snapshot for shell terminals", async () => {
      const terminal = manager.create({
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      });
      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];

      onDataCallback("hello from shell\n");

      await expect(manager.snapshot(terminal.id)).resolves.toMatchObject({
        status: "ok",
        seq: "hello from shell\n".length,
        cols: 120,
        rows: 30,
      });
    });

    it("returns unsupported for unknown terminals", async () => {
      await expect(manager.snapshot("nonexistent")).resolves.toEqual({
        status: "unsupported",
      });
    });

    it("renders a text snapshot for shell terminals", async () => {
      const terminal = manager.create({
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      });
      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];

      onDataCallback("shell \x1b[32moutput\x1b[0m\n");

      await expect(
        manager.getRenderedSnapshot(terminal.id, { maxLines: 10, maxChars: 1000 })
      ).resolves.toBe("shell output");
    });

    it("renders a text snapshot for agent terminals", async () => {
      const terminal = manager.create({
        workspaceId: "ws-123",
        kind: "agent",
        argv: ["node", "agent.js"],
        cwd: "/home/user",
      });
      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];

      onDataCallback("hello \x1b[31mworld\x1b[0m\n");

      await expect(
        manager.getRenderedSnapshot(terminal.id, { maxLines: 10, maxChars: 1000 })
      ).resolves.toBe("hello world");
    });

    it("returns an empty rendered snapshot for unknown terminals", async () => {
      await expect(
        manager.getRenderedSnapshot("nonexistent", { maxLines: 10, maxChars: 1000 })
      ).resolves.toBe("");
    });

    it("returns an empty rendered snapshot when an existing terminal has no snapshot buffer", async () => {
      const snapshotCtorSpy = vi
        .spyOn(snapshotBufferModule, "HeadlessSnapshotBuffer")
        .mockImplementation(
          class MockHeadlessSnapshotBuffer {
            constructor() {
              throw new Error("headless init failed");
            }
          } as unknown as typeof snapshotBufferModule.HeadlessSnapshotBuffer
        );

      try {
        const terminal = manager.create({
          workspaceId: "ws-123",
          kind: "shell",
          argv: ["bash"],
          cwd: "/home/user",
        });

        await expect(
          manager.getRenderedSnapshot(terminal.id, { maxLines: 10, maxChars: 1000 })
        ).resolves.toBe("");
      } finally {
        snapshotCtorSpy.mockRestore();
      }
    });
  });

  describe("get", () => {
    it("should return active terminal by ID", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      const terminal = manager.create(spec);
      const active = manager.get(terminal.id);

      expect(active).toBeDefined();
      expect(active?.id).toBe(terminal.id);
    });

    it("should return undefined for nonexistent terminal", () => {
      const result = manager.get("nonexistent");

      expect(result).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("should return all active terminals", () => {
      const spec1: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      const spec2: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "agent",
        argv: ["node", "agent.js"],
        cwd: "/home/user",
      };

      manager.create(spec1);
      manager.create(spec2);

      const all = manager.getAll();

      expect(all).toHaveLength(2);
    });
  });

  describe("shutdown", () => {
    it("should kill all alive terminals", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      manager.create(spec);
      manager.create(spec);

      manager.shutdown();

      expect(mockPty.kill).toHaveBeenCalledTimes(2);
    });

    it("should clear terminals map", () => {
      const spec: TerminalSpec = {
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      };

      manager.create(spec);
      manager.shutdown();

      expect(manager.getAll()).toHaveLength(0);
    });

    it("disposes shell snapshot buffers during shutdown", () => {
      const terminal = manager.create({
        workspaceId: "ws-123",
        kind: "shell",
        argv: ["bash"],
        cwd: "/home/user",
      });

      const disposeSpy = vi.spyOn(manager.get(terminal.id)!.snapshotBuffer!, "dispose");

      manager.shutdown();

      expect(disposeSpy).toHaveBeenCalledTimes(1);
    });

    it("disposes agent snapshot buffers during shutdown", () => {
      const terminal = manager.create({
        workspaceId: "ws-123",
        kind: "agent",
        argv: ["node", "agent.js"],
        cwd: "/home/user",
      });

      const disposeSpy = vi.spyOn(manager.get(terminal.id)!.snapshotBuffer!, "dispose");

      manager.shutdown();

      expect(disposeSpy).toHaveBeenCalledTimes(1);
    });
  });
});
