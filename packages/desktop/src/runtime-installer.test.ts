import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import * as tar from "tar";
import { afterEach, describe, expect, it } from "vitest";
import {
  downloadRuntimeArtifact,
  RuntimeInstaller,
  unpackRuntimeArtifact,
} from "./runtime-installer.js";
import { type RuntimeReleaseMetadata } from "./runtime-release-provider.js";

describe("runtime-installer", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function createTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  function createRelease(overrides: Partial<RuntimeReleaseMetadata> = {}): RuntimeReleaseMetadata {
    return {
      version: "0.5.4",
      platform: "win32",
      arch: "x64",
      artifactUrl: "https://example.com/runtime.zip",
      checksumSha256: "sha-ok",
      artifactSize: 2048,
      publishedAt: "2026-06-28T10:00:00.000Z",
      ...overrides,
    };
  }

  it("downloads, validates, and activates a runtime bundle", async () => {
    const userDataDir = await createTempDir("coder-studio-installer-user-data-");
    const bundleDir = await createTempDir("coder-studio-installer-bundle-");
    await mkdir(join(bundleDir, "dist", "esm"), { recursive: true });
    await mkdir(join(bundleDir, "dist", "web"), { recursive: true });
    await writeFile(
      join(bundleDir, "runtime-manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          version: "0.5.4",
          entry: "dist/esm/runtime-launch-entry.mjs",
          webRoot: "dist/web",
        },
        null,
        2
      )
    );
    await writeFile(join(bundleDir, "dist", "esm", "runtime-launch-entry.mjs"), "export {};\n");
    await writeFile(join(bundleDir, "dist", "web", "index.html"), "<html></html>\n");

    const installer = new RuntimeInstaller({
      userDataDir,
      downloadArtifact: async () => ({
        archivePath: join(bundleDir, "runtime.zip"),
        checksumSha256: "sha-ok",
      }),
      unpackArtifact: async () => bundleDir,
      now: () => 1700000000000,
    });

    const activated = await installer.installRelease(createRelease());

    expect(activated).toMatchObject({
      version: "0.5.4",
      checksumSha256: "sha-ok",
      source: "github-release",
    });
  });

  it("fails when the checksum does not match", async () => {
    const userDataDir = await createTempDir("coder-studio-installer-user-data-");
    const installer = new RuntimeInstaller({
      userDataDir,
      downloadArtifact: async () => ({
        archivePath: "/tmp/runtime.zip",
        checksumSha256: "sha-wrong",
      }),
      unpackArtifact: async () => "/tmp/unused",
    });

    await expect(installer.installRelease(createRelease())).rejects.toThrow(/checksum/i);
  });

  it("downloads a runtime artifact and computes its sha256", async () => {
    const userDataDir = await createTempDir("coder-studio-installer-user-data-");
    const archiveBytes = Buffer.from("runtime archive bytes");
    const release = createRelease({
      artifactUrl: "https://example.com/runtime-0.5.4-win32-x64.zip",
      checksumSha256: createHash("sha256").update(archiveBytes).digest("hex"),
      artifactSize: archiveBytes.length,
    });

    const downloaded = await downloadRuntimeArtifact({
      release,
      downloadsDir: join(userDataDir, "runtime-store", "downloads"),
      fetchImpl: async () =>
        new Response(archiveBytes, {
          status: 200,
          headers: {
            "content-length": String(archiveBytes.length),
          },
        }),
    });

    expect(downloaded.archivePath).toBe(
      join(userDataDir, "runtime-store", "downloads", "runtime-0.5.4-win32-x64.zip")
    );
    expect(downloaded.checksumSha256).toBe(release.checksumSha256);
    await expect(readFile(downloaded.archivePath)).resolves.toEqual(archiveBytes);
  });

  it("rejects a downloaded runtime artifact when content length mismatches metadata", async () => {
    const userDataDir = await createTempDir("coder-studio-installer-user-data-");
    const archiveBytes = Buffer.from("runtime archive bytes");
    const release = createRelease({
      artifactSize: archiveBytes.length + 1,
    });

    await expect(
      downloadRuntimeArtifact({
        release,
        downloadsDir: join(userDataDir, "runtime-store", "downloads"),
        fetchImpl: async () =>
          new Response(archiveBytes, {
            status: 200,
            headers: {
              "content-length": String(archiveBytes.length),
            },
          }),
      })
    ).rejects.toThrow(/content length|artifact size/i);
  });

  it("unpacks a zip runtime artifact into staging", async () => {
    const archiveDir = await createTempDir("coder-studio-installer-archive-");
    const stagingDir = await createTempDir("coder-studio-installer-staging-");
    const archivePath = join(archiveDir, "runtime-0.5.4-win32-x64.zip");
    const archiveBytes = zipSync({
      "runtime-manifest.json": Buffer.from(
        JSON.stringify(
          {
            schemaVersion: 1,
            version: "0.5.4",
            entry: "dist/esm/runtime-launch-entry.mjs",
            webRoot: "dist/web",
          },
          null,
          2
        )
      ),
      "dist/esm/runtime-launch-entry.mjs": Buffer.from("export {};\n"),
      "dist/web/index.html": Buffer.from("<html></html>\n"),
    });
    await writeFile(archivePath, archiveBytes);

    const extractedDir = await unpackRuntimeArtifact({
      archivePath,
      release: createRelease(),
      stagingRootDir: stagingDir,
    });

    expect(extractedDir).toBe(join(stagingDir, "0.5.4"));
    await expect(readFile(join(extractedDir, "runtime-manifest.json"), "utf-8")).resolves.toContain(
      '"version": "0.5.4"'
    );
    await expect(
      readFile(join(extractedDir, "dist", "esm", "runtime-launch-entry.mjs"), "utf-8")
    ).resolves.toBe("export {};\n");
  });

  it("unpacks a tar.gz runtime artifact into staging", async () => {
    const archiveDir = await createTempDir("coder-studio-installer-archive-");
    const bundleDir = await createTempDir("coder-studio-installer-bundle-");
    const stagingDir = await createTempDir("coder-studio-installer-staging-");
    const archivePath = join(archiveDir, "runtime-0.5.4-linux-x64.tar.gz");
    const sourceDir = join(bundleDir, "runtime-0.5.4");

    await mkdir(join(sourceDir, "dist", "esm"), { recursive: true });
    await mkdir(join(sourceDir, "dist", "web"), { recursive: true });
    await writeFile(
      join(sourceDir, "runtime-manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          version: "0.5.4",
          entry: "dist/esm/runtime-launch-entry.mjs",
          webRoot: "dist/web",
        },
        null,
        2
      )
    );
    await writeFile(join(sourceDir, "dist", "esm", "runtime-launch-entry.mjs"), "export {};\n");
    await writeFile(join(sourceDir, "dist", "web", "index.html"), "<html></html>\n");

    await tar.create(
      {
        gzip: true,
        cwd: bundleDir,
        file: archivePath,
      },
      ["runtime-0.5.4"]
    );

    const extractedDir = await unpackRuntimeArtifact({
      archivePath,
      release: createRelease({
        platform: "linux",
        artifactUrl: "https://example.com/runtime-0.5.4-linux-x64.tar.gz",
      }),
      stagingRootDir: stagingDir,
    });

    expect(extractedDir.startsWith(join(stagingDir, "0.5.4"))).toBe(true);
    await expect(readFile(join(extractedDir, "runtime-manifest.json"), "utf-8")).resolves.toContain(
      '"version": "0.5.4"'
    );
  });
});
