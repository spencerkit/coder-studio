// Unit tests for ActiveTerminal

import { describe, expect, it } from "vitest";
import { ActiveTerminal } from "./active-terminal";
import { RingBuffer } from "./ring-buffer";
import type { PtyProcess, TerminalSpec } from "./types";

describe("ActiveTerminal", () => {
  const mockPty: PtyProcess = {
    onData: () => {},
    onExit: () => {},
    write: () => {},
    resize: () => {},
    kill: async () => {},
  };

  const spec: TerminalSpec = {
    workspaceId: "ws-123",
    kind: "shell",
    argv: ["bash"],
    cwd: "/home/user",
    cols: 120,
    rows: 30,
    title: "Test Terminal",
  };

  it("should create active terminal with correct properties", () => {
    const ringBuffer = new RingBuffer(1024);
    const id = "term-123";
    const createdAt = Date.now();

    const active = new ActiveTerminal(id, spec, mockPty, ringBuffer, createdAt);

    expect(active.id).toBe(id);
    expect(active.spec).toBe(spec);
    expect(active.pty).toBe(mockPty);
    expect(active.ringBuffer).toBe(ringBuffer);
    expect(active.createdAt).toBe(createdAt);
    expect(active.alive).toBe(true);
    expect(active.exitCode).toBeUndefined();
  });

  it("should convert to DTO correctly", () => {
    const ringBuffer = new RingBuffer(1024);
    const id = "term-123";
    const createdAt = Date.now();

    const active = new ActiveTerminal(id, spec, mockPty, ringBuffer, createdAt);
    const dto = active.toDTO();

    expect(dto).toEqual({
      id,
      workspaceId: spec.workspaceId,
      kind: spec.kind,
      title: spec.title,
      cwd: spec.cwd,
      argv: spec.argv,
      cols: spec.cols,
      rows: spec.rows,
      alive: true,
      createdAt,
      endedAt: undefined,
      exitCode: undefined,
    });
  });

  it("should use argv as title when title not provided", () => {
    const specWithoutTitle: TerminalSpec = {
      workspaceId: "ws-123",
      kind: "shell",
      argv: ["bash", "-l"],
      cwd: "/home/user",
    };

    const ringBuffer = new RingBuffer(1024);
    const active = new ActiveTerminal("term-123", specWithoutTitle, mockPty, ringBuffer);

    const dto = active.toDTO();

    expect(dto.title).toBe("bash -l");
  });

  it("should use default cols/rows when not provided", () => {
    const specWithoutSize: TerminalSpec = {
      workspaceId: "ws-123",
      kind: "shell",
      argv: ["bash"],
      cwd: "/home/user",
    };

    const ringBuffer = new RingBuffer(1024);
    const active = new ActiveTerminal("term-123", specWithoutSize, mockPty, ringBuffer);

    const dto = active.toDTO();

    expect(dto.cols).toBe(120);
    expect(dto.rows).toBe(30);
  });

  it("should track alive state", () => {
    const ringBuffer = new RingBuffer(1024);
    const active = new ActiveTerminal("term-123", spec, mockPty, ringBuffer);

    expect(active.alive).toBe(true);

    active.alive = false;
    active.exitCode = 0;

    expect(active.alive).toBe(false);
    expect(active.exitCode).toBe(0);
  });

  it("should convert to database row", () => {
    const ringBuffer = new RingBuffer(1024);
    const id = "term-123";
    const createdAt = Date.now();

    const active = new ActiveTerminal(id, spec, mockPty, ringBuffer, createdAt);
    const row = active.toRow();

    // Should be same as DTO
    expect(row).toEqual(active.toDTO());
  });

  it("should include endedAt when terminal is dead", () => {
    const ringBuffer = new RingBuffer(1024);
    const active = new ActiveTerminal("term-123", spec, mockPty, ringBuffer);

    active.alive = false;
    active.exitCode = 1;

    const dto = active.toDTO();

    expect(dto.alive).toBe(false);
    expect(dto.exitCode).toBe(1);
    expect(dto.endedAt).toBeDefined();
  });
});
