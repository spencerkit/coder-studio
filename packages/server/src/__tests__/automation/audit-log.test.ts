import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationAuditLog } from "../../automation/audit-log.js";

describe("AutomationAuditLog", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes sanitized JSONL audit records", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-audit-"));
    const log = new AutomationAuditLog({
      filePath: join(tempDir, "automation.jsonl"),
      now: () => 1234,
    });

    await log.append({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      providerId: "codex",
      commandName: "terminal.send",
      riskLevel: "write",
      decision: "allowed",
      success: true,
      args: {
        text: "secret-token",
        token: "abc",
      },
    });

    const lines = (await readFile(join(tempDir, "automation.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      timestamp: 1234,
      workspaceId: "ws-1",
      commandName: "terminal.send",
      args: {
        text: "secret-token",
        token: "[redacted]",
      },
    });
  });
});
