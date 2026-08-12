import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseServeWslAcceptanceArgs, startWslAcceptanceServer } from "./serve-wsl-acceptance.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolveClose) => {
          server.close(() => resolveClose());
        })
    )
  );
});

describe("serve-wsl-acceptance", () => {
  it("uses loopback acceptance defaults and parses overrides", () => {
    expect(parseServeWslAcceptanceArgs([]).port).toBe(8787);
    expect(parseServeWslAcceptanceArgs(["--port", "9876", "--directory", "."])).toMatchObject({
      port: 9876,
    });
  });

  it("serves prepared artifacts without caching and blocks traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "coder-studio-wsl-acceptance-server-"));
    await mkdir(root, { recursive: true });
    await Promise.all([
      writeFile(join(root, "coder-studio-engine-linux-x64.manifest.json"), '{"ok":true}\n'),
      writeFile(join(root, "coder-studio-engine-1-linux-x64.tgz"), "archive"),
    ]);
    const started = await startWslAcceptanceServer({ directory: root, port: 0 });
    servers.push(started.server);

    const manifest = await fetch(`${started.url}coder-studio-engine-linux-x64.manifest.json`);
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("cache-control")).toBe("no-store");
    expect(await manifest.json()).toEqual({ ok: true });

    const traversal = await fetch(`${started.url}%2e%2e%2fsecret.txt`);
    expect(traversal.status).toBe(404);
  });

  it("refuses to serve a directory without a WSL Engine channel", async () => {
    const root = await mkdtemp(join(tmpdir(), "coder-studio-empty-acceptance-server-"));
    await expect(startWslAcceptanceServer({ directory: root, port: 0 })).rejects.toThrow(
      "No prepared WSL acceptance artifacts"
    );
  });
});
