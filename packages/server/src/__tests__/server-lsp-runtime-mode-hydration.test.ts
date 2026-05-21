import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "../server.js";
import { SettingsRepo } from "../storage/index.js";

describe("server lsp runtime mode hydration", () => {
  let server: Server | undefined;
  let dataDir: string;
  let dbPath: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "coder-studio-data-"));
    dbPath = join(dataDir, "coder-studio.db");
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("hydrates persisted lsp.mode into the lsp manager on startup", async () => {
    const settingsRepo = new SettingsRepo({
      filePath: join(dataDir, "state", "settings.json"),
    });
    settingsRepo.set("lsp.mode", "off");

    server = await createServer({
      dataDir: dbPath,
      host: "127.0.0.1",
      port: 0,
    });

    expect(server.__test__?.commandContext.lspMgr.getRuntimeMode()).toBe("off");
  });
});
