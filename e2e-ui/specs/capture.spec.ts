import { test } from "@playwright/test";
import { captureSceneVariant } from "../fixtures/scene-runner";
import { UI_CAPTURE_SCENES } from "../scenes";

for (const scene of UI_CAPTURE_SCENES) {
  for (const variant of scene.variants) {
    test(`${scene.id} [${variant.device}/${variant.theme}/${variant.locale}]`, async ({
      page,
    }, testInfo) => {
      test.skip(
        testInfo.project.name !== variant.device,
        "capture only on matching device project"
      );
      await captureSceneVariant(page, {
        scene,
        variant,
      });
    });
  }
}
