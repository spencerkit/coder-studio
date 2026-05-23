import { existsSync, readFileSync } from "fs";

interface CliPackageManifest {
  name?: string;
  version?: string;
}

export function resolveCliPackageManifestUrl(importMetaUrl: string): URL {
  const manifestUrl = [
    new URL("../package.json", importMetaUrl),
    new URL("../../package.json", importMetaUrl),
  ].find((candidate) => existsSync(candidate));

  if (!manifestUrl) {
    throw new Error("Unable to locate CLI package.json");
  }

  return manifestUrl;
}

export function getCliPackageManifest(importMetaUrl: string): CliPackageManifest {
  return JSON.parse(
    readFileSync(resolveCliPackageManifestUrl(importMetaUrl), "utf-8")
  ) as CliPackageManifest;
}

export function getCliVersion(importMetaUrl: string): string {
  return getCliPackageManifest(importMetaUrl).version ?? "0.0.0";
}

export function getCliPackageName(importMetaUrl: string): string {
  return getCliPackageManifest(importMetaUrl).name ?? "@spencer-kit/coder-studio";
}
