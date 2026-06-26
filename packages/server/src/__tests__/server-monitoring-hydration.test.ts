import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "../server.js";
import { SettingsRepo } from "../storage/index.js";

describe("server monitoring hydration", () => {
  let server: Server | undefined;
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "coder-studio-monitoring-state-"));
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("hydrates persisted monitoring settings into the monitoring service on startup", async () => {
    const settingsRepo = new SettingsRepo({
      filePath: join(stateDir, "state", "settings.json"),
    });
    settingsRepo.set("monitoring.enabled", true);
    settingsRepo.set("monitoring.sampleIntervalMs", 5000);

    server = await createServer({
      stateDir,
      host: "127.0.0.1",
      port: 0,
    });

    await vi.waitFor(() => {
      expect(server.__test__?.commandContext.monitoringService?.getResponse().settings).toEqual(
        expect.objectContaining({
          enabled: true,
          sampleIntervalMs: 5000,
        })
      );
    });
  });
});
