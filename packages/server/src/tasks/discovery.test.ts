import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverTasks } from "./discovery.js";

describe("discoverTasks", () => {
  let root: string;

  beforeEach(async () => {
    root = join(tmpdir(), `coder-studio-task-discovery-${Date.now()}-${Math.random()}`);
    await mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("uses explicit .coder-studio/tasks.json definitions first", async () => {
    await mkdir(join(root, ".coder-studio"), { recursive: true });
    await writeFile(
      join(root, ".coder-studio", "tasks.json"),
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: "verify",
            label: "Verify",
            kind: "verify",
            command: "pnpm",
            args: ["ci:verify"],
            cwdPath: ".",
          },
        ],
      })
    );
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } })
    );

    const result = await discoverTasks({ workspaceId: "ws-1", rootPath: root });

    expect(result.tasks[0]).toEqual({
      id: "verify",
      workspaceId: "ws-1",
      kind: "verify",
      label: "Verify",
      command: "pnpm",
      args: ["ci:verify"],
      cwdPath: ".",
      source: "coder-studio",
      priority: 1000,
    });
    expect(result.tasks.map((task) => task.source)).toContain("package-json");
  });

  it("keeps ci:verify as a verify task and displays the original script body", async () => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          "ci:verify": "pnpm changeset:validate && pnpm ci:lint && pnpm ci:test && pnpm ci:build",
          test: "vitest run",
          lint: "biome lint .",
          build: "tsc -p tsconfig.json",
        },
      })
    );
    await writeFile(join(root, "pnpm-lock.yaml"), "");

    const result = await discoverTasks({ workspaceId: "ws-1", rootPath: root });

    expect(result.tasks[0]).toMatchObject({
      id: "ci:verify",
      kind: "verify",
      label: "ci:verify",
      command: "pnpm",
      args: ["ci:verify"],
      displayCommand: "pnpm changeset:validate && pnpm ci:lint && pnpm ci:test && pnpm ci:build",
      source: "package-json",
    });
    expect(result.tasks.map((task) => task.id)).toEqual(["ci:verify", "test", "lint", "build"]);
  });

  it("discovers every root package.json script without requiring a script-name allowlist", async () => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          dev: "tsx scripts/dev.ts",
          "dev:web": "tsx scripts/dev-web.ts",
          "ci:test": "pnpm ci:test:scripts && pnpm ci:test:workspace",
          "lint:fix": "biome lint --write .",
          "publish:cli": "tsx scripts/publish-cli.ts",
        },
      })
    );
    await writeFile(join(root, "pnpm-lock.yaml"), "");

    const result = await discoverTasks({ workspaceId: "ws-1", rootPath: root });

    expect(
      result.tasks
        .filter((task) => task.source === "package-json")
        .map(({ id, label, kind, command, args, displayCommand }) => ({
          id,
          label,
          kind,
          command,
          args,
          displayCommand,
        }))
    ).toEqual([
      {
        id: "dev",
        label: "dev",
        kind: "dev",
        command: "pnpm",
        args: ["dev"],
        displayCommand: "tsx scripts/dev.ts",
      },
      {
        id: "dev:web",
        label: "dev:web",
        kind: "dev",
        command: "pnpm",
        args: ["dev:web"],
        displayCommand: "tsx scripts/dev-web.ts",
      },
      {
        id: "ci:test",
        label: "ci:test",
        kind: "test",
        command: "pnpm",
        args: ["ci:test"],
        displayCommand: "pnpm ci:test:scripts && pnpm ci:test:workspace",
      },
      {
        id: "lint:fix",
        label: "lint:fix",
        kind: "lint",
        command: "pnpm",
        args: ["lint:fix"],
        displayCommand: "biome lint --write .",
      },
      {
        id: "publish:cli",
        label: "publish:cli",
        kind: "custom",
        command: "pnpm",
        args: ["publish:cli"],
        displayCommand: "tsx scripts/publish-cli.ts",
      },
    ]);
  });

  it("uses package-manager-safe script arguments for npm and bun projects", async () => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          "ci:verify": "npm run lint && npm test",
          lint: "eslint .",
        },
      })
    );

    const npmResult = await discoverTasks({ workspaceId: "ws-1", rootPath: root });

    expect(npmResult.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ci:verify", command: "npm", args: ["run", "ci:verify"] }),
        expect.objectContaining({ id: "lint", command: "npm", args: ["run", "lint"] }),
      ])
    );

    await writeFile(join(root, "bun.lock"), "");
    const bunResult = await discoverTasks({ workspaceId: "ws-1", rootPath: root });

    expect(bunResult.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ci:verify", command: "bun", args: ["run", "ci:verify"] }),
        expect.objectContaining({ id: "lint", command: "bun", args: ["run", "lint"] }),
      ])
    );
  });

  it("deduplicates by task id so task selection remains unambiguous", async () => {
    await mkdir(join(root, ".coder-studio"), { recursive: true });
    await writeFile(
      join(root, ".coder-studio", "tasks.json"),
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: "test",
            label: "Custom Test",
            kind: "custom",
            command: "node",
            args: ["scripts/test.js"],
          },
        ],
      })
    );
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } })
    );

    const result = await discoverTasks({ workspaceId: "ws-1", rootPath: root });

    expect(result.tasks.filter((task) => task.id === "test")).toEqual([
      expect.objectContaining({
        id: "test",
        kind: "custom",
        source: "coder-studio",
      }),
    ]);
  });

  it("discovers ecosystem convention tasks", async () => {
    await writeFile(join(root, "Cargo.toml"), '[package]\nname = "demo"\n');
    await writeFile(join(root, "go.mod"), "module demo\n");
    await writeFile(join(root, "pyproject.toml"), '[project]\nname = "demo"\n');
    await writeFile(join(root, "Makefile"), "verify:\n\tpnpm ci:verify\n");

    const result = await discoverTasks({ workspaceId: "ws-1", rootPath: root });

    expect(result.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "cargo-test", command: "cargo", args: ["test"] }),
        expect.objectContaining({ id: "go-test", command: "go", args: ["test", "./..."] }),
        expect.objectContaining({ id: "python-test", command: "python", args: ["-m", "pytest"] }),
        expect.objectContaining({ id: "make-verify", command: "make", args: ["verify"] }),
      ])
    );
  });

  it("does not treat Makefile variable assignments as targets", async () => {
    await writeFile(
      join(root, "Makefile"),
      "test := pytest\nbuild := go build ./...\nlint:\n\tbiome lint .\n"
    );

    const result = await discoverTasks({ workspaceId: "ws-1", rootPath: root });

    expect(result.tasks.map((task) => task.id)).toEqual(["make-lint"]);
  });

  it("returns warnings for malformed sources without failing all discovery", async () => {
    await writeFile(join(root, "package.json"), "{ broken json");
    await writeFile(join(root, "Makefile"), "test:\n\tpnpm test\n");

    const result = await discoverTasks({ workspaceId: "ws-1", rootPath: root });

    expect(result.warnings).toEqual([
      expect.objectContaining({
        source: "package-json",
        message: expect.stringContaining("package.json"),
      }),
    ]);
    expect(result.tasks).toEqual([
      expect.objectContaining({
        id: "make-test",
        command: "make",
        args: ["test"],
      }),
    ]);
  });
});
