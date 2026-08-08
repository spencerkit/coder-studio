import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { DESKTOP_UPDATE_OWNER_STALE_MS, DesktopUpdateJournal } from "./desktop-update-journal.js";

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("DesktopUpdateJournal", () => {
  it("uses a conservative stale window for the process owner lease", () => {
    expect(DESKTOP_UPDATE_OWNER_STALE_MS).toBeGreaterThanOrEqual(10_000);
  });

  it("round-trips a credential-free ready plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "desktop-update-journal-"));
    tempDirs.push(root);
    const journalPath = join(root, "desktop-update-plan.json");
    const journal = new DesktopUpdateJournal({ filePath: journalPath });
    const ownerId = "round-trip-owner";
    await journal.acquireOwner(ownerId);
    await journal.write(
      {
        schemaVersion: 1,
        planId: "plan-1",
        status: "ready",
        createdAt: "2026-08-08T01:00:00.000Z",
        updatedAt: "2026-08-08T01:02:00.000Z",
        runtimeTarget: "win32-x64",
        environmentId: "native",
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
      },
      { expectedPlanId: null, ownerId }
    );

    const serialized = await readFile(journalPath, "utf8");
    expect(serialized).not.toMatch(/token|secret|password|authorization/i);
    await expect(journal.read()).resolves.toMatchObject({ planId: "plan-1", status: "ready" });
    await journal.releaseOwner(ownerId);
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

  it("allows only one process to claim an unowned shared update plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "desktop-update-journal-"));
    tempDirs.push(root);
    const journalPath = join(root, "desktop-update-plan.json");
    const nativeJournal = new DesktopUpdateJournal({ filePath: journalPath });
    const wslJournal = new DesktopUpdateJournal({ filePath: journalPath });
    const createRecord = (planId: string, environmentId: string) => ({
      schemaVersion: 1 as const,
      planId,
      status: "available" as const,
      createdAt: "2026-08-08T01:00:00.000Z",
      updatedAt: "2026-08-08T01:02:00.000Z",
      runtimeTarget: environmentId === "native" ? ("win32-x64" as const) : ("linux-x64" as const),
      environmentId,
      compatibility: { compatible: true, code: null, summary: null },
      restartIntent: false,
      components: [
        {
          id:
            environmentId === "native"
              ? ("runtime:win32-x64" as const)
              : ("runtime:linux-x64" as const),
          currentVersion: "0.5.0",
          targetVersion: "0.6.0",
          currentPublishedAt: "2026-07-01T00:00:00.000Z",
          targetPublishedAt: "2026-08-08T01:02:03.000Z",
          downloaded: false,
          verified: false,
          installed: false,
          errorSummary: null,
        },
      ],
      lastError: null,
    });

    const claims = await Promise.all([
      nativeJournal.acquireOwner("native-owner"),
      wslJournal.acquireOwner("wsl-owner"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const winner = claims[0]
      ? {
          journal: nativeJournal,
          ownerId: "native-owner",
          planId: "native-plan",
          environmentId: "native",
        }
      : {
          journal: wslJournal,
          ownerId: "wsl-owner",
          planId: "wsl-plan",
          environmentId: "wsl:ubuntu",
        };
    await winner.journal.write(createRecord(winner.planId, winner.environmentId), {
      expectedPlanId: null,
      ownerId: winner.ownerId,
    });
    await expect(nativeJournal.read()).resolves.toMatchObject({
      planId: expect.stringMatching(/^(native|wsl)-plan$/),
      environmentId: expect.stringMatching(/^(native|wsl:ubuntu)$/),
    });
    await winner.journal.releaseOwner(winner.ownerId);
  });

  it("does not reclaim a lock while its owner heartbeat remains active", async () => {
    const root = await mkdtemp(join(tmpdir(), "desktop-update-journal-"));
    tempDirs.push(root);
    const journalPath = join(root, "desktop-update-plan.json");
    const lockPath = `${journalPath}.lock`;
    await mkdir(lockPath);
    const heartbeat = setInterval(() => {
      const now = new Date();
      void utimes(lockPath, now, now);
    }, 500);
    const journal = new DesktopUpdateJournal({ filePath: journalPath });
    try {
      await expect(journal.acquireOwner("contending-owner")).resolves.toBe(false);
      await expect(journal.read()).resolves.toBeNull();
    } finally {
      clearInterval(heartbeat);
    }
  }, 7_000);

  it("recovers an abandoned lock within the same acquisition attempt", async () => {
    const root = await mkdtemp(join(tmpdir(), "desktop-update-journal-"));
    tempDirs.push(root);
    const journalPath = join(root, "desktop-update-plan.json");
    const lockPath = `${journalPath}.lock`;
    await mkdir(lockPath);
    await utimes(lockPath, new Date(0), new Date(0));
    const journal = new DesktopUpdateJournal({ filePath: journalPath });

    const startedAt = Date.now();
    await expect(journal.acquireOwner("recovered-owner")).resolves.toBe(true);
    await journal.write(
      {
        schemaVersion: 1,
        planId: "recovered-plan",
        status: "available",
        createdAt: "2026-08-08T01:00:00.000Z",
        updatedAt: "2026-08-08T01:02:00.000Z",
        runtimeTarget: "win32-x64",
        environmentId: "native",
        compatibility: { compatible: true, code: null, summary: null },
        restartIntent: false,
        components: [
          {
            id: "runtime:win32-x64",
            currentVersion: "0.5.0",
            targetVersion: "0.6.0",
            currentPublishedAt: "2026-07-01T00:00:00.000Z",
            targetPublishedAt: "2026-08-08T01:02:03.000Z",
            downloaded: false,
            verified: false,
            installed: false,
            errorSummary: null,
          },
        ],
        lastError: null,
      },
      { expectedPlanId: null, ownerId: "recovered-owner" }
    );
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    await journal.releaseOwner("recovered-owner");
  }, 7_000);

  it("serializes two real processes racing to recover one stale lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "desktop-update-journal-"));
    tempDirs.push(root);
    const journalPath = join(root, "desktop-update-plan.json");
    const lockPath = `${journalPath}.lock`;
    await mkdir(lockPath);
    await utimes(lockPath, new Date(0), new Date(0));
    const fixture = join(import.meta.dirname, "desktop-update-journal-child.fixture.ts");

    const children = await Promise.all([
      execFileAsync(process.execPath, ["--import", "tsx", fixture, journalPath, "child-a"]),
      execFileAsync(process.execPath, ["--import", "tsx", fixture, journalPath, "child-b"]),
    ]);
    const outcomes = children.map(({ stdout }) => JSON.parse(stdout.trim()) as { ok: boolean });

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    await expect(new DesktopUpdateJournal({ filePath: journalPath }).read()).resolves.toMatchObject(
      {
        planId: expect.stringMatching(/^child-[ab]$/),
      }
    );
  }, 10_000);

  it("keeps an active WSL owner while a Native instance attempts to take over", async () => {
    const root = await mkdtemp(join(tmpdir(), "desktop-update-journal-"));
    tempDirs.push(root);
    const journalPath = join(root, "desktop-update-plan.json");
    const wslJournal = new DesktopUpdateJournal({ filePath: journalPath });
    const nativeJournal = new DesktopUpdateJournal({ filePath: journalPath });
    const wslOwnerId = "wsl-owner-1";
    const nativeOwnerId = "native-owner-1";
    const record = {
      schemaVersion: 1 as const,
      planId: "wsl-plan",
      status: "downloading" as const,
      createdAt: "2026-08-08T01:00:00.000Z",
      updatedAt: "2026-08-08T01:02:00.000Z",
      runtimeTarget: "linux-x64" as const,
      environmentId: "wsl:ubuntu",
      compatibility: { compatible: true, code: null, summary: null },
      restartIntent: false,
      components: [
        {
          id: "runtime:linux-x64" as const,
          currentVersion: "0.5.0",
          targetVersion: "0.6.0",
          currentPublishedAt: "2026-07-01T00:00:00.000Z",
          targetPublishedAt: "2026-08-08T01:02:03.000Z",
          downloaded: false,
          verified: false,
          installed: false,
          errorSummary: null,
        },
      ],
      lastError: null,
    };

    await expect(wslJournal.acquireOwner(wslOwnerId)).resolves.toBe(true);
    await wslJournal.write(record, { expectedPlanId: null, ownerId: wslOwnerId });

    await expect(nativeJournal.acquireOwner(nativeOwnerId)).resolves.toBe(false);
    await expect(
      nativeJournal.write(
        {
          ...record,
          planId: "native-plan",
          runtimeTarget: "win32-x64",
          environmentId: "native",
          components: [
            {
              ...record.components[0]!,
              id: "runtime:win32-x64",
            },
          ],
        },
        { expectedPlanId: "wsl-plan", ownerId: nativeOwnerId }
      )
    ).rejects.toMatchObject({ code: "desktop_update_owner_unavailable" });

    await wslJournal.write(
      {
        ...record,
        status: "ready",
        updatedAt: "2026-08-08T01:03:00.000Z",
        components: record.components.map((component) => ({
          ...component,
          downloaded: true,
          verified: true,
        })),
      },
      { expectedPlanId: "wsl-plan", ownerId: wslOwnerId }
    );
    await expect(nativeJournal.read()).resolves.toMatchObject({
      planId: "wsl-plan",
      environmentId: "wsl:ubuntu",
      status: "ready",
    });

    await wslJournal.releaseOwner(wslOwnerId);
    await expect(nativeJournal.acquireOwner(nativeOwnerId)).resolves.toBe(true);
    await nativeJournal.releaseOwner(nativeOwnerId);
  });
});
