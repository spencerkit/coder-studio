export interface AppearanceAsset {
  assetId: string;
  url: string;
  mime: string;
  size: number;
}

export class AppearanceAssetError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "AppearanceAssetError";
    this.code = code;
  }
}

function resolveErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return fallback;
}

export async function uploadAppearanceAsset(file: File): Promise<AppearanceAsset> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/appearance-assets", {
    method: "POST",
    body: formData,
  });

  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    asset?: AppearanceAsset;
  } | null;

  if (!response.ok || !payload?.ok || !payload.asset) {
    throw new AppearanceAssetError(resolveErrorMessage(payload, "appearance_asset_upload_failed"));
  }

  return payload.asset;
}

export async function deleteAppearanceAsset(assetId: string): Promise<void> {
  const response = await fetch(`/api/appearance-assets/${assetId}`, {
    method: "DELETE",
  });

  if (response.ok) {
    return;
  }

  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;

  throw new AppearanceAssetError(resolveErrorMessage(payload, "appearance_asset_delete_failed"));
}
