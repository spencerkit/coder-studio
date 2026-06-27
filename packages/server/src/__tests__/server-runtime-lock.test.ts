import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "../server.js";

describe("server runtime lock", () => {
  const createdDirs: string[] = [];
  let servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await server.stop();
    }
    for (const dir of createdDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a second runtime for the same state directory", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "coder-studio-runtime-lock-"));
    createdDirs.push(stateDir);

    const first = await createServer({ stateDir, port: 0, writeRuntimeConfig: false });
    servers.push(first);

    await expect(createServer({ stateDir, port: 0, writeRuntimeConfig: false })).rejects.toThrow(
      /already in use/i
    );
  });
});
