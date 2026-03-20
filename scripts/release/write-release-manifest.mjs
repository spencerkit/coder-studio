import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../lib/package-matrix.mjs';

function isDirectRun() {
  return process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
}

async function sha256ForFile(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

export async function createReleaseManifest(targetDir = path.join(ROOT, '.artifacts')) {
  const artifactDir = path.resolve(targetDir);
  const entries = (await fs.readdir(artifactDir))
    .filter((file) => file.endsWith('.tgz'))
    .sort();

  if (entries.length === 0) {
    throw new Error(`no .tgz artifacts found in ${artifactDir}`);
  }

  const artifacts = await Promise.all(
    entries.map(async (file) => {
      const filePath = path.join(artifactDir, file);
      const stat = await fs.stat(filePath);
      const sha256 = await sha256ForFile(filePath);
      return {
        file,
        size: stat.size,
        sha256,
      };
    }),
  );

  const manifest = {
    createdAt: new Date().toISOString(),
    artifactCount: artifacts.length,
    artifacts,
  };

  const manifestPath = path.join(artifactDir, 'release-manifest.json');
  const checksumsPath = path.join(artifactDir, 'SHA256SUMS.txt');

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fs.writeFile(
    checksumsPath,
    `${artifacts.map((entry) => `${entry.sha256}  ${entry.file}`).join('\n')}\n`,
    'utf8',
  );

  return {
    artifactDir,
    manifestPath,
    checksumsPath,
    artifacts,
  };
}

if (isDirectRun()) {
  try {
    const result = await createReleaseManifest(process.argv[2]);
    console.log(`release manifest written: ${path.relative(process.cwd(), result.manifestPath)}`);
    console.log(`checksums written: ${path.relative(process.cwd(), result.checksumsPath)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
