import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopUpdateJournal } from "./desktop-update-journal.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("DesktopUpdateJournal", () => {
  it("round-trips a credential-free ready plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "desktop-update-journal-"));
    tempDirs.push(root);
    const journalPath = join(root, "desktop-update-plan.json");
    const journal = new DesktopUpdateJournal({ filePath: journalPath });
    await journal.write({
      schemaVersion: 1,
      planId: "plan-1",
      status: "ready",
      createdAt: "2026-08-08T01:00:00.000Z",
      updatedAt: "2026-08-08T01:02:00.000Z",
      runtimeTarget: "win32-x64",
      compatibility: { compatible: true, code: null, summary: null },
      restartIntent: false,
      components: [
        {
          id: "runtime:win32-x64",
          currentVersion: "0.5.0",
          targetVersion: "0.6.0",
          currentPublishedAt: "2026-07-01T00:00:00.000Z",
          targetPublishedAt: "2026-08-08T01:02:03.000Z",
          downloaded: true,
          verified: true,
          installed: false,
          errorSummary: null,
        },
      ],
      lastError: null,
    });

    const serialized = await readFile(journalPath, "utf8");
    expect(serialized).not.toMatch(/token|secret|password|authorization/i);
    await expect(journal.read()).resolves.toMatchObject({ planId: "plan-1", status: "ready" });
  });

  it("ignores malformed records with a warning", async () => {
    const root = await mkdtemp(join(tmpdir(), "desktop-update-journal-"));
    tempDirs.push(root);
    const journalPath = join(root, "desktop-update-plan.json");
    await writeFile(journalPath, '{"schemaVersion":1,"planId":"bad"}', "utf8");
    const warnings: string[] = [];
    const journal = new DesktopUpdateJournal({
      filePath: journalPath,
      onWarning: (value) => warnings.push(value),
    });

    await expect(journal.read()).resolves.toBeNull();
    expect(warnings[0]).toContain("desktop-update-plan.json");
  });
});
