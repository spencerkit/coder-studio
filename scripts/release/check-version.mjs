import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAIN_PACKAGE, PLATFORM_PACKAGES, ROOT } from '../lib/package-matrix.mjs';

function isDirectRun() {
  return process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function readPackageVersionFromCargoToml(source) {
  const packageSectionMatch = source.match(/\[package\]([\s\S]*?)(?:\n\[[^\]]+\]|$)/);
  if (!packageSectionMatch) {
    throw new Error('missing [package] section in src-tauri/Cargo.toml');
  }

  const versionMatch = packageSectionMatch[1].match(/^version = "([^"]+)"$/m);
  if (!versionMatch) {
    throw new Error('missing package version in src-tauri/Cargo.toml');
  }
  return versionMatch[1];
}

export async function collectReleaseVersionState(rootDir = ROOT) {
  const rootPackage = await readJson(path.join(rootDir, 'package.json'));
  const mainPackage = await readJson(path.join(rootDir, 'packages', MAIN_PACKAGE.slug, 'package.json'));
  const platformPackages = await Promise.all(
    PLATFORM_PACKAGES.map(async (entry) => ({
      ...entry,
      packageJson: await readJson(path.join(rootDir, 'packages', entry.slug, 'package.json')),
    })),
  );
  const cargoToml = await fs.readFile(path.join(rootDir, 'src-tauri', 'Cargo.toml'), 'utf8');
  const tauriConfig = await readJson(path.join(rootDir, 'src-tauri', 'tauri.conf.json'));

  return {
    rootVersion: rootPackage.version,
    mainVersion: mainPackage.version,
    cargoVersion: readPackageVersionFromCargoToml(cargoToml),
    tauriVersion: tauriConfig.version,
    optionalDependencies: mainPackage.optionalDependencies ?? {},
    platformPackages,
  };
}

export function validateReleaseVersionState(state) {
  const errors = [];
  const expectedVersion = state.mainVersion;

  if (state.rootVersion !== expectedVersion) {
    errors.push(`root package version ${state.rootVersion} does not match main package version ${expectedVersion}`);
  }
  if (state.cargoVersion !== expectedVersion) {
    errors.push(`Cargo.toml version ${state.cargoVersion} does not match main package version ${expectedVersion}`);
  }
  if (state.tauriVersion !== expectedVersion) {
    errors.push(`tauri.conf.json version ${state.tauriVersion} does not match main package version ${expectedVersion}`);
  }

  const optionalDependencyNames = Object.keys(state.optionalDependencies).sort();
  const expectedOptionalDependencyNames = PLATFORM_PACKAGES.map((entry) => entry.name).sort();
  if (JSON.stringify(optionalDependencyNames) !== JSON.stringify(expectedOptionalDependencyNames)) {
    errors.push(
      `optionalDependencies ${optionalDependencyNames.join(', ')} do not match platform package set ${expectedOptionalDependencyNames.join(', ')}`,
    );
  }

  for (const entry of state.platformPackages) {
    const pkg = entry.packageJson;
    if (pkg.name !== entry.name) {
      errors.push(`${entry.slug} package name ${pkg.name} does not match expected ${entry.name}`);
    }
    if (pkg.version !== expectedVersion) {
      errors.push(`${entry.slug} version ${pkg.version} does not match main package version ${expectedVersion}`);
    }
    if (state.optionalDependencies[entry.name] !== expectedVersion) {
      errors.push(`optional dependency ${entry.name}=${state.optionalDependencies[entry.name]} does not match ${expectedVersion}`);
    }
  }

  return {
    ok: errors.length === 0,
    version: expectedVersion,
    errors,
  };
}

export async function assertVersionConsistency(rootDir = ROOT) {
  const state = await collectReleaseVersionState(rootDir);
  const report = validateReleaseVersionState(state);
  if (!report.ok) {
    throw new Error(report.errors.join('\n'));
  }
  return report;
}

if (isDirectRun()) {
  try {
    const report = await assertVersionConsistency();
    console.log(`release versions are aligned: ${report.version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
