declare const __APP_VERSION__: string | undefined;
declare const __APP_BUILD_PUBLISHED_AT__: string | undefined;

const FALLBACK_VERSION = "dev";
const FALLBACK_PUBLISHED_AT = "--";

const readBuildConstant = (value: string | undefined, fallback: string) => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
};

const padDatePart = (value: number) => String(value).padStart(2, "0");

export const formatBuildPublishedAt = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return readBuildConstant(value, FALLBACK_PUBLISHED_AT);
  }

  return `${parsed.getUTCFullYear()}-${padDatePart(parsed.getUTCMonth() + 1)}-${padDatePart(parsed.getUTCDate())} ${padDatePart(parsed.getUTCHours())}:${padDatePart(parsed.getUTCMinutes())}:${padDatePart(parsed.getUTCSeconds())} UTC`;
};

export type AppBuildMetadata = {
  version: string;
  publishedAtDisplay: string;
};

export const readAppBuildMetadata = (): AppBuildMetadata => {
  const version = readBuildConstant(
    typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : undefined,
    FALLBACK_VERSION,
  );
  const publishedAt = readBuildConstant(
    typeof __APP_BUILD_PUBLISHED_AT__ === "string" ? __APP_BUILD_PUBLISHED_AT__ : undefined,
    "",
  );

  return {
    version,
    publishedAtDisplay: publishedAt ? formatBuildPublishedAt(publishedAt) : FALLBACK_PUBLISHED_AT,
  };
};
