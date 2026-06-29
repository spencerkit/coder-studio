import { isAbsolute, normalize } from "node:path";

export const RUNTIME_MANIFEST_FILE_NAME = "runtime-manifest.json";

export interface RuntimeManifest {
  schemaVersion: 1;
  version: string;
  entry: string;
  webRoot: string;
}

function isSafeBundleRelativePath(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = normalize(value).replaceAll("\\", "/");
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return false;
  }

  return !isAbsolute(value);
}

export function parseRuntimeManifest(value: unknown): RuntimeManifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Runtime manifest must be an object");
  }

  const manifest = value as Partial<RuntimeManifest>;
  if (manifest.schemaVersion !== 1) {
    throw new Error("Runtime manifest schemaVersion must be 1");
  }
  if (typeof manifest.version !== "string" || manifest.version.trim().length === 0) {
    throw new Error("Runtime manifest version is required");
  }
  if (!isSafeBundleRelativePath(manifest.entry)) {
    throw new Error("Runtime manifest entry must be a safe bundle-relative path");
  }
  if (!isSafeBundleRelativePath(manifest.webRoot)) {
    throw new Error("Runtime manifest webRoot must be a safe bundle-relative path");
  }

  return {
    schemaVersion: 1,
    version: manifest.version.trim(),
    entry: manifest.entry,
    webRoot: manifest.webRoot,
  };
}
