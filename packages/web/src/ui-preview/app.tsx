import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EmptyState } from "../components/ui";
import { getThemeById, resolveStoredThemeId } from "../theme";
import { getUiPreviewScene, type UiPreviewSceneDefinition } from "./catalog";
import type { UiPreviewDevice, UiPreviewLocale, UiPreviewTheme } from "./preview-store";

export interface UiPreviewRequest {
  sceneId: string;
  theme: UiPreviewTheme;
  locale: UiPreviewLocale;
  device: UiPreviewDevice;
  context: {
    theme: UiPreviewTheme;
    locale: UiPreviewLocale;
    device: UiPreviewDevice;
  };
  scene: UiPreviewSceneDefinition | null;
}

export function resolvePreviewRequest(search: string): UiPreviewRequest {
  const params = new URLSearchParams(search);
  const sceneId = params.get("scene") ?? "welcome";
  const theme = resolveStoredThemeId(params.get("theme"));
  const locale = params.get("locale") === "en" ? "en" : "zh";
  const device = params.get("device") === "mobile" ? "mobile" : "desktop";
  const scene = getUiPreviewScene(sceneId);

  return {
    sceneId,
    theme,
    locale,
    device,
    context: { theme, locale, device },
    scene,
  };
}

function UnknownScene({ sceneId }: { sceneId: string }) {
  return (
    <div className="welcome-container">
      <div className="welcome-card">
        <EmptyState title={<p>Unknown preview scene</p>} description={<p>{sceneId}</p>} />
      </div>
    </div>
  );
}

export function UiPreviewApp({ request }: { request: UiPreviewRequest }) {
  document.documentElement.setAttribute(
    "data-theme",
    getThemeById(request.theme).documentThemeAttr
  );
  document.documentElement.setAttribute("lang", request.locale === "zh" ? "zh" : "en");
  document.body.dataset.uiPreviewDevice = request.device;

  if (!request.scene) {
    return <UnknownScene sceneId={request.sceneId} />;
  }

  const router = request.scene.router(request.context);

  return (
    <MemoryRouter initialEntries={router.initialEntries}>
      <Routes>
        <Route path={router.path} element={request.scene.render(request.context)} />
      </Routes>
    </MemoryRouter>
  );
}
