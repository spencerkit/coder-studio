import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SERVER_APP_DIR } from '../lib/package-matrix.mjs';

const REQUIRED_ASSETS = [
  {
    label: 'tauri icon png',
    filePath: path.join(SERVER_APP_DIR, 'icons', 'icon.png'),
  },
  {
    label: 'windows icon',
    filePath: path.join(SERVER_APP_DIR, 'icons', 'icon.ico'),
  },
];

function isDirectRun() {
  return process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
}

async function assertFileExists(label, filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`${label} is missing or empty: ${filePath}`);
  }
}

export async function assertReleaseAssets() {
  for (const asset of REQUIRED_ASSETS) {
    await assertFileExists(asset.label, asset.filePath);
  }
}

if (isDirectRun()) {
  try {
    await assertReleaseAssets();
    console.log('release assets are present');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
