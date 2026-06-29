import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { unzipSync } from "fflate";
import * as tar from "tar";
import type { RuntimeReleaseMetadata } from "./runtime-release-provider.js";
import {
  type ActiveRuntimePointer,
  RuntimeStore,
  resolveRuntimeStoreLayout,
} from "./runtime-store.js";

export interface DownloadedRuntimeArtifact {
  archivePath: string;
  checksumSha256: string;
}

export async function downloadRuntimeArtifact(input: {
  release: RuntimeReleaseMetadata;
  downloadsDir: string;
  fetchImpl?: typeof fetch;
}): Promise<DownloadedRuntimeArtifact> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(input.release.artifactUrl, {
    headers: {
      "user-agent": "coder-studio-runtime-installer",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Runtime artifact download failed with ${response.status}`);
  }

  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength !== input.release.artifactSize) {
      throw new Error("Runtime artifact content length does not match release metadata");
    }
  }

  await mkdir(input.downloadsDir, { recursive: true });
  const archiveFileName = basename(new URL(input.release.artifactUrl).pathname);
  const archivePath = join(input.downloadsDir, archiveFileName);
  const chunks: Buffer[] = [];

  for await (const chunk of response.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const archiveBytes = Buffer.concat(chunks);
  if (archiveBytes.byteLength !== input.release.artifactSize) {
    throw new Error("Runtime artifact size does not match release metadata");
  }

  await writeFile(archivePath, archiveBytes);

  return {
    archivePath,
    checksumSha256: createHash("sha256").update(archiveBytes).digest("hex"),
  };
}

function isArchiveEntrySafe(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.includes("../") &&
    !value.includes("..\\")
  );
}

async function unpackZipArchive(input: { archiveBytes: Buffer; targetDir: string }): Promise<void> {
  const archive = unzipSync(new Uint8Array(input.archiveBytes));
  const writes = Object.entries(archive).map(async ([relativePath, bytes]) => {
    if (!isArchiveEntrySafe(relativePath)) {
      throw new Error(`Runtime artifact contains an unsafe path: ${relativePath}`);
    }

    const targetPath = join(input.targetDir, relativePath);
    if (relativePath.endsWith("/")) {
      await mkdir(targetPath, { recursive: true });
      return;
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, Buffer.from(bytes));
  });

  await Promise.all(writes);
}

async function unpackTarArchive(input: { archivePath: string; targetDir: string }): Promise<void> {
  await tar.extract({
    cwd: input.targetDir,
    file: input.archivePath,
    strict: true,
    onentry: (entry) => {
      if (!isArchiveEntrySafe(entry.path)) {
        throw new Error(`Runtime artifact contains an unsafe path: ${entry.path}`);
      }
    },
  });
}

async function resolveExtractedBundleDir(input: { stagingRootDir: string }): Promise<string> {
  try {
    await readFile(join(input.stagingRootDir, "runtime-manifest.json"), "utf-8");
    return input.stagingRootDir;
  } catch {
    const children = await readdir(input.stagingRootDir, { withFileTypes: true });
    for (const child of children) {
      if (!child.isDirectory()) {
        continue;
      }

      const candidateDir = join(input.stagingRootDir, child.name);
      try {
        await readFile(join(candidateDir, "runtime-manifest.json"), "utf-8");
        return candidateDir;
      } catch {
        continue;
      }
    }

    return input.stagingRootDir;
  }
}

export async function unpackRuntimeArtifact(input: {
  archivePath: string;
  release: RuntimeReleaseMetadata;
  stagingRootDir: string;
}): Promise<string> {
  const targetDir = join(input.stagingRootDir, input.release.version);
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  if (input.archivePath.endsWith(".zip")) {
    await unpackZipArchive({
      archiveBytes: await readFile(input.archivePath),
      targetDir,
    });
    return resolveExtractedBundleDir({
      stagingRootDir: targetDir,
    });
  }

  if (input.archivePath.endsWith(".tar.gz") || input.archivePath.endsWith(".tgz")) {
    await unpackTarArchive({
      archivePath: input.archivePath,
      targetDir,
    });
    return resolveExtractedBundleDir({
      stagingRootDir: targetDir,
    });
  }

  throw new Error(`Unsupported runtime artifact format: ${extname(input.archivePath)}`);
}

export class RuntimeInstaller {
  private readonly store: RuntimeStore;
  private readonly downloadArtifact: (
    release: RuntimeReleaseMetadata
  ) => Promise<DownloadedRuntimeArtifact>;
  private readonly unpackArtifact: (input: {
    archivePath: string;
    release: RuntimeReleaseMetadata;
  }) => Promise<string>;

  constructor(input: {
    userDataDir: string;
    downloadArtifact?: (release: RuntimeReleaseMetadata) => Promise<DownloadedRuntimeArtifact>;
    unpackArtifact?: (input: {
      archivePath: string;
      release: RuntimeReleaseMetadata;
    }) => Promise<string>;
    now?: () => number;
  }) {
    this.store = new RuntimeStore({
      userDataDir: input.userDataDir,
      now: input.now,
    });
    const layout = resolveRuntimeStoreLayout(input.userDataDir);
    this.downloadArtifact =
      input.downloadArtifact ??
      ((release) =>
        downloadRuntimeArtifact({
          release,
          downloadsDir: layout.downloadsDir,
        }));
    this.unpackArtifact =
      input.unpackArtifact ??
      ((artifactInput) =>
        unpackRuntimeArtifact({
          ...artifactInput,
          stagingRootDir: layout.stagingDir,
        }));
  }

  async installRelease(release: RuntimeReleaseMetadata): Promise<ActiveRuntimePointer> {
    const downloaded = await this.downloadArtifact(release);
    if (downloaded.checksumSha256 !== release.checksumSha256) {
      throw new Error("Runtime artifact checksum mismatch");
    }

    const stagingDir = await this.unpackArtifact({
      archivePath: downloaded.archivePath,
      release,
    });

    return this.store.activateStagedRuntime({
      stagingDir,
      checksumSha256: downloaded.checksumSha256,
      source: "github-release",
      minAppVersion: release.minAppVersion,
    });
  }
}
