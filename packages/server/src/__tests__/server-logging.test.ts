import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCodexConfigAuditApi,
  logCodexConfigFindings,
  type ServerWarnLogger,
} from "../server.js";

describe("server startup logging", () => {
  const logger: ServerWarnLogger = {
    warn: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(logger.warn).mockReset();
  });

  it("logs codex audit findings through the structured logger", async () => {
    const auditApi = {
      audit: vi.fn().mockReturnValue({
        codex: {
          configPath: "/tmp/config.toml",
          findings: [{ startLine: 12, message: "remove notify override" }],
        },
      }),
    };

    await logCodexConfigFindings(auditApi, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      {
        configPath: "/tmp/config.toml",
        startLine: 12,
        findingMessage: "remove notify override",
      },
      "Codex config finding"
    );
  });

  it("logs audit failures as non-fatal warnings", async () => {
    const auditApi = {
      audit: vi.fn(() => {
        throw new Error("boom");
      }),
    };

    await logCodexConfigFindings(auditApi, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
      }),
      "Codex config audit failed (non-fatal)"
    );
  });

  it("creates an audit api wired to the codex config helpers", () => {
    const auditApi = createCodexConfigAuditApi();
    expect(typeof auditApi.audit).toBe("function");
    expect(typeof auditApi.cleanup).toBe("function");
  });
});
