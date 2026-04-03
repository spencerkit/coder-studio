import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, '../..');
const testsRoot = path.join(workspaceRoot, 'tests');
const registerScript = path.join(scriptDir, 'register-ts-extensionless.mjs');

function collectTestFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(entryPath));
      continue;
    }
    if (entry.name.endsWith('.test.ts')) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

const explicitTargets = process.argv.slice(2);
const testTargets = explicitTargets.length > 0 ? explicitTargets : collectTestFiles(testsRoot);

if (testTargets.length === 0) {
  process.stderr.write('No .test.ts files found.\n');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--import', registerScript, '--test', ...testTargets],
  {
    cwd: workspaceRoot,
    stdio: 'inherit',
  },
);

process.exit(result.status ?? 1);
