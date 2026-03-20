import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const BUILD_ROOT = path.join(ROOT, '.build');
export const WEB_APP_DIR = path.join(ROOT, 'apps', 'web');
export const WEB_DIST_DIR = path.join(BUILD_ROOT, 'web', 'dist');
export const SERVER_APP_DIR = path.join(ROOT, 'apps', 'server');
export const SERVER_TARGET_DIR = path.join(BUILD_ROOT, 'server', 'target');
export const NPM_TEMPLATE_ROOT = path.join(ROOT, 'templates', 'npm', 'platform-packages');
export const NPM_STAGE_ROOT = path.join(BUILD_ROOT, 'stage', 'npm');

export const MAIN_PACKAGE = {
  slug: 'coder-studio',
  name: '@spencer-kit/coder-studio',
  sourceDir: path.join(ROOT, 'packages', 'cli'),
};

const PLATFORM_PACKAGE_DEFS = [
  {
    key: 'linux:x64',
    slug: 'coder-studio-linux-x64',
    name: '@spencer-kit/coder-studio-linux-x64',
    os: 'linux',
    arch: 'x64',
  },
  {
    key: 'darwin:arm64',
    slug: 'coder-studio-darwin-arm64',
    name: '@spencer-kit/coder-studio-darwin-arm64',
    os: 'darwin',
    arch: 'arm64',
  },
  {
    key: 'darwin:x64',
    slug: 'coder-studio-darwin-x64',
    name: '@spencer-kit/coder-studio-darwin-x64',
    os: 'darwin',
    arch: 'x64',
  },
  {
    key: 'win32:x64',
    slug: 'coder-studio-win32-x64',
    name: '@spencer-kit/coder-studio-win32-x64',
    os: 'win32',
    arch: 'x64',
  },
];

export const PLATFORM_PACKAGES = PLATFORM_PACKAGE_DEFS.map((entry) => ({
  ...entry,
  templateDir: path.join(NPM_TEMPLATE_ROOT, entry.slug),
  stageDir: path.join(NPM_STAGE_ROOT, entry.slug),
}));

export function resolvePlatformPackageMeta(platform = process.platform, arch = process.arch) {
  return PLATFORM_PACKAGES.find((entry) => entry.key === `${platform}:${arch}`) ?? null;
}
