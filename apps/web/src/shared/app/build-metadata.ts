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

const formatUtcOffset = (value: Date) => {
  const offsetMinutes = -value.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  return `UTC${sign}${padDatePart(hours)}:${padDatePart(minutes)}`;
};

export const formatBuildPublishedAt = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return readBuildConstant(value, FALLBACK_PUBLISHED_AT);
  }

  return `${parsed.getFullYear()}-${padDatePart(parsed.getMonth() + 1)}-${padDatePart(parsed.getDate())} ${padDatePart(parsed.getHours())}:${padDatePart(parsed.getMinutes())}:${padDatePart(parsed.getSeconds())} ${formatUtcOffset(parsed)}`;
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
