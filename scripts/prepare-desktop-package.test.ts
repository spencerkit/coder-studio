import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  createNodeRuntimeExtractionExecution,
  repairPortableNodeLaunchers,
  stageAcceptedFactoryRuntime,
} from "./prepare-desktop-package.js";

const execFileAsync = promisify(execFile);
const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function createEngineFixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "coder-studio-engine-launcher-test-"));
  cleanupRoots.push(root);
  const targets = {
    "lib/node_modules/corepack/dist/corepack.js": "corepack",
    "lib/node_modules/npm/bin/npm-cli.js": "npm",
    "lib/node_modules/npm/bin/npx-cli.js": "npx",
  };
  await mkdir(resolve(root, "bin"), { recursive: true });
  if (process.platform !== "win32") {
    await symlink(process.execPath, resolve(root, "bin", "node"));
  }
  await Promise.all(
    Object.entries(targets).map(async ([path, name]) => {
      const destination = resolve(root, ...path.split("/"));
      await mkdir(resolve(destination, ".."), { recursive: true });
      await writeFile(destination, `process.stdout.write(${JSON.stringify(name)});\n`);
    })
  );
  return root;
}

async function createFactoryRuntimeFixture(): Promise<{
  provenanceFile: string;
  runtimeRoot: string;
}> {
  const root = await mkdtemp(resolve(tmpdir(), "coder-studio-factory-runtime-test-"));
  cleanupRoots.push(root);
  const runtimeRoot = resolve(root, "accepted-runtime");
  await mkdir(runtimeRoot, { recursive: true });
  const server = Buffer.from("accepted-runtime");
  await writeFile(resolve(runtimeRoot, "server.mjs"), server);
  const manifest = {
    schemaVersion: 2,
    runtimeVersion: "0.6.0",
    publishedAt: "2026-08-08T01:02:03.000Z",
    minShellVersion: "0.1.0",
    requiredEngineVersion: "2",
    requiredNodeVersion: "24.19.0",
    runtimeHostApiVersion: 1,
    apiProtocolVersion: 1,
    dataSchemaVersion: 1,
    platform: "win32",
    arch: "x64",
    entrypoint: "server.mjs",
    files: [
      {
        path: "server.mjs",
        sha256: createHash("sha256").update(server).digest("hex"),
        size: server.byteLength,
      },
    ],
    signature: { algorithm: "ed25519", value: "accepted-signature" },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(resolve(runtimeRoot, "manifest.json"), manifestBytes);
  const provenanceFile = resolve(root, "factory-product.json");
  await writeFile(
    provenanceFile,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        version: "0.6.0",
        releaseTag: "v0.6.0",
        runtimes: {
          "win32-x64": {
            manifest: "coder-studio-runtime-win32-x64.manifest.json",
            manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
          },
          "linux-x64": {
            manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
            manifestSha256: "b".repeat(64),
          },
        },
      },
      null,
      2
    )}\n`
  );
  return { provenanceFile, runtimeRoot };
}

describe("prepare-desktop-package", () => {
  it("includes Factory Product provenance in packaged resources", async () => {
    const builderConfig = await readFile(
      resolve(import.meta.dirname, "../packages/desktop/electron-builder.yml"),
      "utf8"
    );

    expect(builderConfig).toContain("from: dist/factory-product.json");
    expect(builderConfig).toContain("to: factory-product.json");
  });

  it("packages the exact accepted Factory Product identity with its Runtime bytes", async () => {
    const fixture = await createFactoryRuntimeFixture();
    const outputRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-factory-output-test-"));
    cleanupRoots.push(outputRoot);
    const runtimeDestination = resolve(outputRoot, "factory-runtime");
    const provenanceDestination = resolve(outputRoot, "factory-product.json");

    const provenance = await stageAcceptedFactoryRuntime({
      sourceRuntimeDir: fixture.runtimeRoot,
      sourceProvenanceFile: fixture.provenanceFile,
      runtimeDestination,
      provenanceDestination,
      target: "win32-x64",
    });

    expect(provenance).toMatchObject({
      version: "0.6.0",
      releaseTag: "v0.6.0",
      runtimes: {
        "win32-x64": {
          manifest: "coder-studio-runtime-win32-x64.manifest.json",
        },
      },
    });
    await expect(readFile(resolve(runtimeDestination, "server.mjs"), "utf8")).resolves.toBe(
      "accepted-runtime"
    );
    await expect(readFile(provenanceDestination, "utf8").then(JSON.parse)).resolves.toEqual(
      provenance
    );
  });

  it("rejects Factory Runtime bytes whose manifest digest differs from provenance", async () => {
    const fixture = await createFactoryRuntimeFixture();
    const outputRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-factory-output-test-"));
    cleanupRoots.push(outputRoot);
    const provenance = JSON.parse(await readFile(fixture.provenanceFile, "utf8"));
    provenance.runtimes["win32-x64"].manifestSha256 = "c".repeat(64);
    await writeFile(fixture.provenanceFile, `${JSON.stringify(provenance, null, 2)}\n`);

    await expect(
      stageAcceptedFactoryRuntime({
        sourceRuntimeDir: fixture.runtimeRoot,
        sourceProvenanceFile: fixture.provenanceFile,
        runtimeDestination: resolve(outputRoot, "factory-runtime"),
        provenanceDestination: resolve(outputRoot, "factory-product.json"),
        target: "win32-x64",
      })
    ).rejects.toThrow("manifest digest");
  });

  it("replaces dereferenced POSIX package-manager entries with portable launchers", async () => {
    const root = await createEngineFixture();

    await repairPortableNodeLaunchers(root, "linux");

    for (const name of ["corepack", "npm", "npx"]) {
      const launcher = resolve(root, "bin", name);
      const source = await readFile(launcher, "utf8");
      expect(source).toContain("../lib/node_modules/");
      expect(source).toContain('exec "$bin_dir/node"');
      if (process.platform !== "win32") {
        expect((await stat(launcher)).mode & 0o111).not.toBe(0);
        await expect(execFileAsync(launcher)).resolves.toMatchObject({ stdout: name });
      }
    }
  });

  it("does not replace launchers from the Windows Node archive", async () => {
    const root = await createEngineFixture();
    const npmPath = resolve(root, "bin", "npm");
    await writeFile(npmPath, "windows-launcher");

    await repairPortableNodeLaunchers(root, "win32");

    await access(npmPath);
    await expect(readFile(npmPath, "utf8")).resolves.toBe("windows-launcher");
  });
  it("uses workdir-relative tar paths when extracting the Node runtime archive", () => {
    const execution = createNodeRuntimeExtractionExecution(
      "C:\\temp\\coder-studio-node-runtime-123\\node-v24.19.0-win-x64.zip",
      "C:\\temp\\coder-studio-node-runtime-123"
    );

    expect(execution).toEqual({
      cwd: "C:\\temp\\coder-studio-node-runtime-123",
      args: ["-xf", "node-v24.19.0-win-x64.zip", "-C", "."],
    });
  });
});
