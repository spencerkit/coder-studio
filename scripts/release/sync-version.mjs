import fs from 'node:fs/promises';
import path from 'node:path';
import { MAIN_PACKAGE, PLATFORM_PACKAGES, ROOT, SERVER_APP_DIR } from '../lib/package-matrix.mjs';

const mainPackagePath = path.join(MAIN_PACKAGE.sourceDir, 'package.json');
const mainPackage = JSON.parse(await fs.readFile(mainPackagePath, 'utf8'));
const version = mainPackage.version;

for (const entry of PLATFORM_PACKAGES) {
  const packagePath = path.join(entry.templateDir, 'package.json');
  const payload = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  payload.version = version;
  await fs.writeFile(packagePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

mainPackage.optionalDependencies = Object.fromEntries(
  PLATFORM_PACKAGES.map((entry) => [entry.name, version]),
);
await fs.writeFile(mainPackagePath, `${JSON.stringify(mainPackage, null, 2)}\n`, 'utf8');

const rootPackagePath = path.join(ROOT, 'package.json');
const rootPackage = JSON.parse(await fs.readFile(rootPackagePath, 'utf8'));
rootPackage.version = version;
await fs.writeFile(rootPackagePath, `${JSON.stringify(rootPackage, null, 2)}\n`, 'utf8');

const cargoTomlPath = path.join(SERVER_APP_DIR, 'Cargo.toml');
const cargoToml = await fs.readFile(cargoTomlPath, 'utf8');
const nextCargoToml = cargoToml
  .replace(/^name = ".*"$/m, 'name = "coder-studio"')
  .replace(/^version = ".*"$/m, `version = "${version}"`);
await fs.writeFile(cargoTomlPath, nextCargoToml, 'utf8');

const tauriConfigPath = path.join(SERVER_APP_DIR, 'tauri.conf.json');
const tauriConfig = JSON.parse(await fs.readFile(tauriConfigPath, 'utf8'));
tauriConfig.productName = 'Coder Studio';
tauriConfig.version = version;
tauriConfig.identifier = 'com.spencerkit.coderstudio';
await fs.writeFile(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, 'utf8');

console.log(`synced version ${version}`);
