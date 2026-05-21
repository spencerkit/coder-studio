export type AppearanceViewport = "desktop" | "mobile";
export type AppearanceBackgroundMode = "none" | "image";
export type AppearanceBackgroundFit = "cover" | "contain";

export interface AppearancePersonalizationCommon {
  backgroundMode: AppearanceBackgroundMode;
  backgroundAssetId: string | null;
  backgroundFit: AppearanceBackgroundFit;
  backgroundDimness: number;
  backgroundBlur: number;
  glassEnabled: boolean;
  glassIntensity: number;
  surfaceOpacity: number;
}

export interface AppearancePersonalizationOverrides {
  backgroundAssetId?: string | null;
  backgroundDimness?: number;
  backgroundBlur?: number;
  glassEnabled?: boolean;
  glassIntensity?: number;
  surfaceOpacity?: number;
}

export interface AppearancePersonalization {
  version: 1;
  common: AppearancePersonalizationCommon;
  desktop: AppearancePersonalizationOverrides;
  mobile: AppearancePersonalizationOverrides;
}

export const DEFAULT_APPEARANCE_PERSONALIZATION: AppearancePersonalization = {
  version: 1,
  common: {
    backgroundMode: "none",
    backgroundAssetId: null,
    backgroundFit: "cover",
    backgroundDimness: 24,
    backgroundBlur: 0,
    glassEnabled: false,
    glassIntensity: 24,
    surfaceOpacity: 96,
  },
  desktop: {},
  mobile: {},
};

const APPEARANCE_PERSONALIZATION_PREFIX = "appearance.personalization";
const OVERRIDE_FIELDS = [
  "backgroundAssetId",
  "backgroundDimness",
  "backgroundBlur",
  "glassEnabled",
  "glassIntensity",
  "surfaceOpacity",
] as const;

type AppearanceOverrideField = (typeof OVERRIDE_FIELDS)[number];

function resolveEnumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function resolveNullableString(value: unknown, fallback: string | null): string | null {
  if (value === null) {
    return null;
  }

  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function resolveNumberInRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

function resolveOptionalNumberInRange(
  value: unknown,
  min: number,
  max: number
): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : undefined;
}

function resolveOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function resolveOptionalNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resolveOverrideField(
  field: AppearanceOverrideField,
  value: unknown
): string | number | boolean | null | undefined {
  switch (field) {
    case "backgroundAssetId":
      return resolveOptionalNullableString(value);
    case "backgroundDimness":
    case "glassIntensity":
    case "surfaceOpacity":
      return resolveOptionalNumberInRange(value, 0, 100);
    case "backgroundBlur":
      return resolveOptionalNumberInRange(value, 0, 40);
    case "glassEnabled":
      return resolveOptionalBoolean(value);
  }
}

export function resolveAppearancePersonalizationSetting(
  settings: Record<string, unknown>
): AppearancePersonalization {
  const commonDefaults = DEFAULT_APPEARANCE_PERSONALIZATION.common;

  const common: AppearancePersonalizationCommon = {
    backgroundMode: resolveEnumValue(
      settings[`${APPEARANCE_PERSONALIZATION_PREFIX}.common.backgroundMode`],
      ["none", "image"],
      commonDefaults.backgroundMode
    ),
    backgroundAssetId: resolveNullableString(
      settings[`${APPEARANCE_PERSONALIZATION_PREFIX}.common.backgroundAssetId`],
      commonDefaults.backgroundAssetId
    ),
    backgroundFit: resolveEnumValue(
      settings[`${APPEARANCE_PERSONALIZATION_PREFIX}.common.backgroundFit`],
      ["cover", "contain"],
      commonDefaults.backgroundFit
    ),
    backgroundDimness: resolveNumberInRange(
      settings[`${APPEARANCE_PERSONALIZATION_PREFIX}.common.backgroundDimness`],
      0,
      100,
      commonDefaults.backgroundDimness
    ),
    backgroundBlur: resolveNumberInRange(
      settings[`${APPEARANCE_PERSONALIZATION_PREFIX}.common.backgroundBlur`],
      0,
      40,
      commonDefaults.backgroundBlur
    ),
    glassEnabled:
      typeof settings[`${APPEARANCE_PERSONALIZATION_PREFIX}.common.glassEnabled`] === "boolean"
        ? (settings[`${APPEARANCE_PERSONALIZATION_PREFIX}.common.glassEnabled`] as boolean)
        : commonDefaults.glassEnabled,
    glassIntensity: resolveNumberInRange(
      settings[`${APPEARANCE_PERSONALIZATION_PREFIX}.common.glassIntensity`],
      0,
      100,
      commonDefaults.glassIntensity
    ),
    surfaceOpacity: resolveNumberInRange(
      settings[`${APPEARANCE_PERSONALIZATION_PREFIX}.common.surfaceOpacity`],
      0,
      100,
      commonDefaults.surfaceOpacity
    ),
  };

  const desktop: AppearancePersonalizationOverrides = {};
  const mobile: AppearancePersonalizationOverrides = {};

  for (const field of OVERRIDE_FIELDS) {
    const desktopValue = resolveOverrideField(
      field,
      settings[`${APPEARANCE_PERSONALIZATION_PREFIX}.desktop.${field}`]
    );
    if (desktopValue !== undefined) {
      if (field === "backgroundAssetId") {
        desktop.backgroundAssetId = desktopValue;
      } else if (field === "backgroundDimness") {
        desktop.backgroundDimness = desktopValue;
      } else if (field === "backgroundBlur") {
        desktop.backgroundBlur = desktopValue;
      } else if (field === "glassEnabled") {
        desktop.glassEnabled = desktopValue;
      } else if (field === "glassIntensity") {
        desktop.glassIntensity = desktopValue;
      } else if (field === "surfaceOpacity") {
        desktop.surfaceOpacity = desktopValue;
      }
    }

    const mobileValue = resolveOverrideField(
      field,
      settings[`${APPEARANCE_PERSONALIZATION_PREFIX}.mobile.${field}`]
    );
    if (mobileValue !== undefined) {
      if (field === "backgroundAssetId") {
        mobile.backgroundAssetId = mobileValue;
      } else if (field === "backgroundDimness") {
        mobile.backgroundDimness = mobileValue;
      } else if (field === "backgroundBlur") {
        mobile.backgroundBlur = mobileValue;
      } else if (field === "glassEnabled") {
        mobile.glassEnabled = mobileValue;
      } else if (field === "glassIntensity") {
        mobile.glassIntensity = mobileValue;
      } else if (field === "surfaceOpacity") {
        mobile.surfaceOpacity = mobileValue;
      }
    }
  }

  return {
    version: 1,
    common,
    desktop,
    mobile,
  };
}

export function resolveAppearancePersonalizationForViewport(
  personalization: AppearancePersonalization,
  viewport: AppearanceViewport
): AppearancePersonalizationCommon {
  const resolved = {
    ...personalization.common,
    ...personalization[viewport],
  };

  if (resolved.backgroundMode === "image" && resolved.backgroundAssetId === null) {
    return {
      ...resolved,
      backgroundMode: "none",
    };
  }

  return resolved;
}
