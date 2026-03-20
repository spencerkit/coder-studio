import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const MAIN_PACKAGE = {
  slug: 'coder-studio',
  name: '@spencer-kit/coder-studio',
};

export const PLATFORM_PACKAGES = [
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

export function resolvePlatformPackageMeta(platform = process.platform, arch = process.arch) {
  return PLATFORM_PACKAGES.find((entry) => entry.key === `${platform}:${arch}`) ?? null;
}
