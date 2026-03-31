import { claudeProviderManifest } from "./manifests/claude.ts";
import { codexProviderManifest } from "./manifests/codex.ts";
import type { ProviderId, ProviderManifest } from "./types.ts";

export const BUILTIN_PROVIDER_MANIFESTS: readonly ProviderManifest[] = [
  claudeProviderManifest,
  codexProviderManifest,
];

const BUILTIN_PROVIDER_MANIFEST_MAP = new Map<string, ProviderManifest>(
  BUILTIN_PROVIDER_MANIFESTS.map((manifest) => [manifest.id, manifest]),
);

export const getProviderManifest = (providerId: string): ProviderManifest | undefined => (
  BUILTIN_PROVIDER_MANIFEST_MAP.get(providerId)
);

export const getProviderPanelId = (providerId: ProviderId | string): string => `provider:${providerId}`;

export const getProviderBadgeLabel = (providerId: ProviderId | string): string => (
  getProviderManifest(providerId)?.badgeLabel ?? `Unknown (${providerId})`
);
