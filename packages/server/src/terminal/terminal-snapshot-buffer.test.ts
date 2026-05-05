import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/headless";
import { describe, expect, it, vi } from "vitest";
import { HeadlessSnapshotBuffer, SnapshotUnsupportedError } from "./terminal-snapshot-buffer";

const TEST_FILE_DIR = dirname(fileURLToPath(import.meta.url));
const SERVER_PACKAGE_DIR = resolve(TEST_FILE_DIR, "../..");
const SNAPSHOT_BUFFER_MODULE_PATH = resolve(
  SERVER_PACKAGE_DIR,
  "src/terminal/terminal-snapshot-buffer.ts"
);

async function serializeAfterReplay(serialized: string, cols = 80, rows = 24) {
  const term = new Terminal({ cols, rows, allowProposedApi: true });
  const addon = new SerializeAddon();
  term.loadAddon(addon);

  await new Promise<void>((resolve) => {
    term.write(serialized, () => resolve());
  });

  return {
    serialized: addon.serialize(),
    cursorX: term.buffer.active.cursorX,
    cursorY: term.buffer.active.cursorY,
  };
}

async function inspectWrittenState(payload: string, cols = 80, rows = 24) {
  const term = new Terminal({ cols, rows, allowProposedApi: true });
  const addon = new SerializeAddon();
  term.loadAddon(addon);

  await new Promise<void>((resolve) => {
    term.write(payload, () => resolve());
  });

  return {
    serialized: addon.serialize(),
    cursorX: term.buffer.active.cursorX,
    cursorY: term.buffer.active.cursorY,
  };
}

describe("HeadlessSnapshotBuffer", () => {
  it("loads under the tsx ESM runtime used by the server entrypoint", () => {
    const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const result = spawnSync(
      pnpmCommand,
      [
        "exec",
        "tsx",
        "--eval",
        `import(${JSON.stringify(SNAPSHOT_BUFFER_MODULE_PATH)}).then((mod) => { console.log(typeof mod.HeadlessSnapshotBuffer) })`,
      ],
      {
        cwd: SERVER_PACKAGE_DIR,
        encoding: "utf8",
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("function");
  });

  it("replays multiline snapshots into an equivalent headless terminal state", async () => {
    const buffer = new HeadlessSnapshotBuffer({ cols: 80, rows: 24 });
    const payload = "first line\nsecond line\nthird line";
    const baseline = await inspectWrittenState(payload);

    buffer.write(Buffer.from(payload, "utf8"), Buffer.byteLength(payload, "utf8"));

    const snapshot = await buffer.snapshot();
    const replayed = await serializeAfterReplay(
      snapshot.data.toString("utf8"),
      snapshot.cols,
      snapshot.rows
    );

    expect(snapshot.data.toString("utf8")).toBe(baseline.serialized);
    expect(replayed.serialized).toBe(baseline.serialized);
    expect(replayed.cursorX).toBe(baseline.cursorX);
    expect(replayed.cursorY).toBe(baseline.cursorY);
  });

  it("captures the final visible state for carriage-return progress updates", async () => {
    const buffer = new HeadlessSnapshotBuffer({ cols: 80, rows: 24 });

    buffer.write(Buffer.from("progress 10%\rprogress 100%\n"), 24);

    const snapshot = await buffer.snapshot();

    expect(snapshot.seq).toBe(24);
    expect(snapshot.cols).toBe(80);
    expect(snapshot.rows).toBe(24);
    expect(snapshot.data.toString("utf8")).toContain("progress 100%");
    expect(snapshot.data.toString("utf8")).not.toContain("progress 10%");
  });

  it("retains the latest seq in lockstep with the serialized snapshot", async () => {
    const buffer = new HeadlessSnapshotBuffer({ cols: 80, rows: 24 });

    buffer.write(Buffer.from("first line\n"), 11);
    buffer.write(Buffer.from("second line\n"), 23);

    const snapshot = await buffer.snapshot();

    expect(snapshot.seq).toBe(23);
    expect(snapshot.data.toString("utf8")).toContain("second line");
  });

  it("only serializes content that remains after a clear-screen reset", async () => {
    const buffer = new HeadlessSnapshotBuffer({ cols: 80, rows: 24 });
    const payload = "before\x1b[2J\x1b[Hafter";

    buffer.write(Buffer.from(payload, "utf8"), Buffer.byteLength(payload, "utf8"));

    const snapshot = await buffer.snapshot();

    expect(snapshot.data.toString("utf8")).toBe("after");
    expect(snapshot.data.toString("utf8")).not.toContain("before");
  });

  it("preserves CJK and wide characters without truncation", async () => {
    const buffer = new HeadlessSnapshotBuffer({ cols: 80, rows: 24 });
    const payload = "中文🙂\n第二行";

    buffer.write(Buffer.from(payload, "utf8"), Buffer.byteLength(payload, "utf8"));

    const snapshot = await buffer.snapshot();
    const replayed = await serializeAfterReplay(
      snapshot.data.toString("utf8"),
      snapshot.cols,
      snapshot.rows
    );

    expect(snapshot.data.toString("utf8")).toContain("中文🙂");
    expect(snapshot.data.toString("utf8")).toContain("第二行");
    expect(replayed.serialized).toBe(snapshot.data.toString("utf8"));
  });

  it("restores alt-screen snapshots when replayed into a fresh headless terminal", async () => {
    const buffer = new HeadlessSnapshotBuffer({ cols: 80, rows: 24 });
    const payload = "main\n\x1b[?1049hALT";

    buffer.write(Buffer.from(payload, "utf8"), Buffer.byteLength(payload, "utf8"));

    const snapshot = await buffer.snapshot();
    const replayed = await serializeAfterReplay(
      snapshot.data.toString("utf8"),
      snapshot.cols,
      snapshot.rows
    );

    expect(snapshot.data.toString("utf8")).toContain("\x1b[?1049h");
    expect(snapshot.data.toString("utf8")).toContain("ALT");
    expect(replayed.serialized).toBe(snapshot.data.toString("utf8"));
  });

  it("disables itself after a write failure and rejects later snapshots", async () => {
    const buffer = new HeadlessSnapshotBuffer({ cols: 80, rows: 24 });
    const term = (buffer as { term: Terminal | null }).term;
    const originalWrite = term?.write;

    vi.spyOn(term as Terminal, "write").mockImplementation(() => {
      throw new Error("write exploded");
    });

    expect(() => buffer.write(Buffer.from("boom", "utf8"), 4)).toThrow("write exploded");
    expect(buffer.disabled).toBe(true);
    await expect(buffer.snapshot()).rejects.toBeInstanceOf(SnapshotUnsupportedError);

    originalWrite?.bind(term);
  });

  it("rejects write and snapshot calls after disposal", async () => {
    const buffer = new HeadlessSnapshotBuffer({ cols: 80, rows: 24 });

    buffer.dispose();

    expect(buffer.disabled).toBe(true);
    expect(() => buffer.write(Buffer.from("after dispose", "utf8"), 13)).toThrow(
      SnapshotUnsupportedError
    );
    await expect(buffer.snapshot()).rejects.toBeInstanceOf(SnapshotUnsupportedError);
  });
});
