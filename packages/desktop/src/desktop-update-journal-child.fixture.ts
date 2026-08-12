import { DesktopUpdateJournal } from "./desktop-update-journal.js";

const [journalPath, planId] = process.argv.slice(2);
if (!journalPath || !planId) throw new Error("journal path and plan ID are required");

const journal = new DesktopUpdateJournal({ filePath: journalPath });
const ownerId = `${planId}-owner`;

try {
  if (!(await journal.acquireOwner(ownerId))) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, code: "desktop_update_owner_unavailable" })}\n`
    );
    process.exit(0);
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  await journal.write(
    {
      schemaVersion: 1,
      planId,
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
    { expectedPlanId: null, ownerId }
  );
  await journal.releaseOwner(ownerId);
  process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ ok: false, code: (error as NodeJS.ErrnoException).code ?? null })}\n`
  );
}
