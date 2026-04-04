import fs from 'node:fs/promises';
import {
  resolveServiceBundleManifestPath,
  resolveServiceDir,
  resolveServiceLauncherPath,
} from './config.mjs';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

export async function writeServiceLauncher(input) {
  const serviceDir = resolveServiceDir(input.stateDir);
  const launcherPath = resolveServiceLauncherPath(input.stateDir);
  const bundleManifestPath = resolveServiceBundleManifestPath(input.stateDir);
  const manifestPathLiteral = shellQuote(bundleManifestPath);

  await fs.mkdir(serviceDir, { recursive: true });
  await fs.writeFile(
    bundleManifestPath,
    `${JSON.stringify(
      {
        binaryPath: input.binaryPath,
        distDir: input.distDir,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const launcher = `#!/bin/sh
set -eu
BUNDLE_MANIFEST_PATH=${manifestPathLiteral}
export CODER_STUDIO_HOST=${shellQuote(input.host)}
export CODER_STUDIO_PORT=${shellQuote(String(input.port))}
export CODER_STUDIO_DATA_DIR=${shellQuote(input.dataDir)}
bundle_binary_path="$(node --input-type=module -e "import fs from 'node:fs'; const manifest = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); if (!manifest.binaryPath) throw new Error('service bundle manifest missing binaryPath'); process.stdout.write(String(manifest.binaryPath));" "$BUNDLE_MANIFEST_PATH")"
bundle_dist_dir="$(node --input-type=module -e "import fs from 'node:fs'; const manifest = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); if (!manifest.distDir) throw new Error('service bundle manifest missing distDir'); process.stdout.write(String(manifest.distDir));" "$BUNDLE_MANIFEST_PATH")"
export CODER_STUDIO_DIST_DIR="$bundle_dist_dir"
exec "$bundle_binary_path"
`;

  await fs.writeFile(launcherPath, launcher, 'utf8');
  await fs.chmod(launcherPath, 0o755);

  return {
    launcherPath,
    bundleManifestPath,
  };
}
