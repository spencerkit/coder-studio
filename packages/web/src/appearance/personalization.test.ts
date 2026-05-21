import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE_PERSONALIZATION,
  resolveAppearancePersonalizationForViewport,
  resolveAppearancePersonalizationSetting,
} from "./personalization";

describe("appearance personalization", () => {
  it("falls back to the default contract when settings omit personalization", () => {
    expect(resolveAppearancePersonalizationSetting({})).toEqual(DEFAULT_APPEARANCE_PERSONALIZATION);
  });

  it("ignores invalid numeric and enum values from server settings", () => {
    expect(
      resolveAppearancePersonalizationSetting({
        "appearance.personalization.common.backgroundMode": "video",
        "appearance.personalization.common.backgroundBlur": 99,
        "appearance.personalization.common.surfaceOpacity": -1,
      })
    ).toEqual(DEFAULT_APPEARANCE_PERSONALIZATION);
  });

  it("merges common values with desktop overrides only for the supported fields", () => {
    const personalization = resolveAppearancePersonalizationSetting({
      "appearance.personalization.common.backgroundMode": "image",
      "appearance.personalization.common.backgroundAssetId": "asset-common",
      "appearance.personalization.common.glassEnabled": false,
      "appearance.personalization.desktop.backgroundAssetId": "asset-desktop",
      "appearance.personalization.desktop.glassEnabled": true,
    });

    expect(resolveAppearancePersonalizationForViewport(personalization, "desktop")).toMatchObject({
      backgroundMode: "image",
      backgroundAssetId: "asset-desktop",
      glassEnabled: true,
    });
    expect(resolveAppearancePersonalizationForViewport(personalization, "mobile")).toMatchObject({
      backgroundMode: "image",
      backgroundAssetId: "asset-common",
      glassEnabled: false,
    });
  });
});
