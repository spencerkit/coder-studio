import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MAIN_PACKAGE_PATH = path.join(ROOT, 'packages', 'coder-studio', 'package.json');
const PLATFORM_PACKAGES = [
  'coder-studio-linux-x64',
  'coder-studio-darwin-arm64',
  'coder-studio-darwin-x64',
  'coder-studio-win32-x64'
];

const mainPackage = JSON.parse(await fs.readFile(MAIN_PACKAGE_PATH, 'utf8'));
const version = mainPackage.version;

for (const name of PLATFORM_PACKAGES) {
  const packagePath = path.join(ROOT, 'packages', name, 'package.json');
  const payload = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  payload.version = version;
  await fs.writeFile(packagePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

mainPackage.optionalDependencies = Object.fromEntries(
  Object.keys(mainPackage.optionalDependencies).map((name) => [name, version])
);
await fs.writeFile(MAIN_PACKAGE_PATH, `${JSON.stringify(mainPackage, null, 2)}\n`, 'utf8');

const rootPackagePath = path.join(ROOT, 'package.json');
const rootPackage = JSON.parse(await fs.readFile(rootPackagePath, 'utf8'));
rootPackage.version = version;
await fs.writeFile(rootPackagePath, `${JSON.stringify(rootPackage, null, 2)}\n`, 'utf8');

const cargoTomlPath = path.join(ROOT, 'src-tauri', 'Cargo.toml');
const cargoToml = await fs.readFile(cargoTomlPath, 'utf8');
const nextCargoToml = cargoToml
  .replace(/^name = ".*"$/m, 'name = "coder-studio"')
  .replace(/^version = ".*"$/m, `version = "${version}"`);
await fs.writeFile(cargoTomlPath, nextCargoToml, 'utf8');

const tauriConfigPath = path.join(ROOT, 'src-tauri', 'tauri.conf.json');
const tauriConfig = JSON.parse(await fs.readFile(tauriConfigPath, 'utf8'));

tauriConfig.productName = 'Coder Studio';
tauriConfig.version = version;
tauriConfig.identifier = 'com.spencerkit.coderstudio';
await fs.writeFile(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, 'utf8');

console.log(`synced version ${version}`);
