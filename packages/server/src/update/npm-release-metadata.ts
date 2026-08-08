export interface NpmReleaseMetadata {
  version: string;
  currentPublishedAt: string | null;
  latestPublishedAt: string | null;
}

function normalizePublishedAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export async function lookupNpmReleaseMetadata(input: {
  packageName: string;
  currentVersion: string;
  distTag: string;
  registryUrl: string;
  fetch?: typeof fetch;
}): Promise<NpmReleaseMetadata> {
  const registry = new URL(
    input.registryUrl.endsWith("/") ? input.registryUrl : `${input.registryUrl}/`
  );
  const url = new URL(encodeURIComponent(input.packageName), registry);
  if (url.origin !== registry.origin) {
    throw new Error("npm registry package URL changed origin");
  }
  const response = await (input.fetch ?? fetch)(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`npm registry request failed with ${response.status}`);
  }
  const data = (await response.json()) as {
    "dist-tags"?: Record<string, unknown>;
    time?: Record<string, unknown>;
  };
  const version = data["dist-tags"]?.[input.distTag];
  if (typeof version !== "string" || !version.trim()) {
    throw new Error(`npm registry did not return dist-tag ${input.distTag}`);
  }
  const normalizedVersion = version.trim();
  return {
    version: normalizedVersion,
    currentPublishedAt: normalizePublishedAt(data.time?.[input.currentVersion]),
    latestPublishedAt: normalizePublishedAt(data.time?.[normalizedVersion]),
  };
}
