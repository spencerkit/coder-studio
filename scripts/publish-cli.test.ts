import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertCliPublishArtifacts,
  buildPackDryRunArgs,
  buildPublishArgs,
  parsePublishCliArgs,
  runPublishCli,
} from "./publish-cli.js";

describe("publish-cli", () => {
  it("defaults to a safe dry-run release flow", () => {
    expect(parsePublishCliArgs([])).toEqual({
      access: "public",
      allowDirty: false,
      build: true,
      publish: false,
      registry: undefined,
      tag: "latest",
      otp: undefined,
    });
  });

  it("parses explicit publish flags", () => {
    expect(
      parsePublishCliArgs([
        "--",
        "--publish",
        "--no-build",
        "--allow-dirty",
        "--tag",
        "next",
        "--access",
        "restricted",
        "--registry",
        "https://registry.example.test",
        "--otp",
        "123456",
      ])
    ).toEqual({
      access: "restricted",
      allowDirty: true,
      build: false,
      publish: true,
      registry: "https://registry.example.test",
      tag: "next",
      otp: "123456",
    });
  });

  it("builds npm pack and publish command arguments", () => {
    expect(buildPackDryRunArgs("https://registry.example.test")).toEqual([
      "pack",
      "--dry-run",
      "--json",
      "--registry",
      "https://registry.example.test",
    ]);

    expect(
      buildPublishArgs({
        access: "public",
        allowDirty: false,
        build: true,
        publish: true,
        registry: "https://registry.example.test",
        tag: "next",
        otp: "123456",
      })
    ).toEqual([
      "publish",
      "--access",
      "public",
      "--tag",
      "next",
      "--registry",
      "https://registry.example.test",
      "--otp",
      "123456",
    ]);
  });

  it("requires the built CLI artifacts that are included in the package", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coder-studio-publish-"));
    const cliDir = join(dir, "packages", "cli");

    await mkdir(join(cliDir, "dist", "esm", "migrations"), { recursive: true });
    await mkdir(join(cliDir, "dist", "web"), { recursive: true });
    await writeFile(join(cliDir, "dist", "bin.js"), "#!/usr/bin/env node\n");
    await writeFile(join(cliDir, "dist", "esm", "bin.mjs"), "export {};\n");
    await writeFile(join(cliDir, "dist", "esm", "index.mjs"), "export {};\n");
    await writeFile(join(cliDir, "dist", "esm", "server-runner.mjs"), "export {};\n");
    await writeFile(join(cliDir, "dist", "esm", "migrations", "001_init.sql"), "-- init\n");
    await writeFile(join(cliDir, "dist", "web", "index.html"), "<!doctype html>\n");
    await writeFile(
      join(cliDir, "package.json"),
      JSON.stringify({
        name: "@spencer-kit/coder-studio",
        version: "1.2.3",
        bin: { "coder-studio": "./src/bin.ts" },
        files: ["dist"],
        publishConfig: {
          bin: { "coder-studio": "./dist/bin.js" },
          exports: {
            ".": {
              import: "./dist/esm/index.mjs",
            },
          },
        },
        exports: {
          ".": {
            import: "./src/index.ts",
          },
        },
        dependencies: {
          "@xterm/addon-serialize": "^0.14.0",
        },
      })
    );

    await expect(assertCliPublishArtifacts(cliDir)).resolves.toEqual({
      name: "@spencer-kit/coder-studio",
      version: "1.2.3",
    });
  });

  it("rejects built runtime imports that are not declared in the CLI package dependencies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coder-studio-publish-"));
    const cliDir = join(dir, "packages", "cli");

    await mkdir(join(cliDir, "dist", "esm", "migrations"), { recursive: true });
    await mkdir(join(cliDir, "dist", "web"), { recursive: true });
    await writeFile(join(cliDir, "dist", "bin.js"), "#!/usr/bin/env node\n");
    await writeFile(
      join(cliDir, "dist", "esm", "bin.mjs"),
      'import { SerializeAddon } from "@xterm/addon-serialize";\nvoid SerializeAddon;\n'
    );
    await writeFile(join(cliDir, "dist", "esm", "index.mjs"), "export {};\n");
    await writeFile(join(cliDir, "dist", "esm", "server-runner.mjs"), "export {};\n");
    await writeFile(join(cliDir, "dist", "esm", "migrations", "001_init.sql"), "-- init\n");
    await writeFile(join(cliDir, "dist", "web", "index.html"), "<!doctype html>\n");
    await writeFile(
      join(cliDir, "package.json"),
      JSON.stringify({
        name: "@spencer-kit/coder-studio",
        version: "1.2.3",
        bin: { "coder-studio": "./src/bin.ts" },
        files: ["dist"],
        publishConfig: {
          bin: { "coder-studio": "./dist/bin.js" },
          exports: {
            ".": {
              import: "./dist/esm/index.mjs",
            },
          },
        },
        exports: {
          ".": {
            import: "./src/index.ts",
          },
        },
        dependencies: {},
      })
    );

    await expect(assertCliPublishArtifacts(cliDir)).rejects.toThrow("@xterm/addon-serialize");
  });

  it("rejects internal workspace packages in the publishable CLI package manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coder-studio-publish-"));
    const cliDir = join(dir, "packages", "cli");

    await mkdir(join(cliDir, "dist", "esm", "migrations"), { recursive: true });
    await mkdir(join(cliDir, "dist", "web"), { recursive: true });
    await writeFile(join(cliDir, "dist", "bin.js"), "#!/usr/bin/env node\n");
    await writeFile(join(cliDir, "dist", "esm", "bin.mjs"), "export {};\n");
    await writeFile(join(cliDir, "dist", "esm", "index.mjs"), "export {};\n");
    await writeFile(join(cliDir, "dist", "esm", "server-runner.mjs"), "export {};\n");
    await writeFile(join(cliDir, "dist", "esm", "migrations", "001_init.sql"), "-- init\n");
    await writeFile(join(cliDir, "dist", "web", "index.html"), "<!doctype html>\n");
    await writeFile(
      join(cliDir, "package.json"),
      JSON.stringify({
        name: "@spencer-kit/coder-studio",
        version: "1.2.3",
        bin: { "coder-studio": "./src/bin.ts" },
        files: ["dist"],
        publishConfig: {
          bin: { "coder-studio": "./dist/bin.js" },
          exports: {
            ".": {
              import: "./dist/esm/index.mjs",
            },
          },
        },
        exports: {
          ".": {
            import: "./src/index.ts",
          },
        },
        dependencies: {
          "@coder-studio/core": "1.2.3",
          "@xterm/addon-serialize": "^0.14.0",
        },
      })
    );

    await expect(assertCliPublishArtifacts(cliDir)).rejects.toThrow(
      "@coder-studio/core dependency must not be published with the CLI bundle"
    );
  });

  it("rejects a real publish from a dirty worktree unless explicitly allowed", async () => {
    const exec = vi.fn(async () => ({ stdout: " M package.json\n" }));

    await expect(
      runPublishCli({
        cliDir: "/repo/packages/cli",
        exec,
        options: {
          access: "public",
          allowDirty: false,
          build: false,
          publish: true,
          registry: undefined,
          tag: "latest",
          otp: undefined,
        },
      })
    ).rejects.toThrow("Refusing to publish from a dirty git worktree");

    expect(exec).toHaveBeenCalledWith("git", ["status", "--porcelain"], {
      cwd: "/repo",
      stdio: "pipe",
    });
    expect(exec).not.toHaveBeenCalledWith("pnpm", expect.any(Array), expect.any(Object));
  });
});
