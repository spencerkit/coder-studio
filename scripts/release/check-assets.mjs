import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAIN_PACKAGE, PLATFORM_PACKAGES } from '../lib/package-matrix.mjs';

const REQUIRED_ASSETS = [
  {
    label: 'main package README',
    filePath: path.join(MAIN_PACKAGE.sourceDir, 'README.md'),
  },
  {
    label: 'cli entrypoint',
    filePath: path.join(MAIN_PACKAGE.sourceDir, 'src', 'bin', 'coder-studio.mts'),
  },
  ...PLATFORM_PACKAGES.flatMap((entry) => ([
    {
      label: `${entry.slug} template package`,
      filePath: path.join(entry.templateDir, 'package.json'),
    },
    {
      label: `${entry.slug} template README`,
      filePath: path.join(entry.templateDir, 'README.md'),
    },
  ])),
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
