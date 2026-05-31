import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const VIEWPORT_QUERY = "(max-width: 899px), (pointer: coarse)";
const originalMatchMedia = window.matchMedia;
let appModule!: typeof import("./app");
let previewStoreModule!: typeof import("./preview-store");

function installMatchMedia(device: "desktop" | "mobile") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === VIEWPORT_QUERY ? device === "mobile" : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    }),
  });
}

function renderPreview(search: string) {
  window.history.replaceState({}, "", `/ui-preview.html${search}`);
  const { resolvePreviewRequest, UiPreviewApp } = appModule;
  const { buildUiPreviewStore } = previewStoreModule;
  const request = resolvePreviewRequest(window.location.search);
  installMatchMedia(request.device);
  const seed = request.scene ? request.scene.seed(request.context) : { ...request.context };
  const store = buildUiPreviewStore(seed);

  return render(
    <Provider store={store}>
      <UiPreviewApp request={request} />
    </Provider>
  );
}

describe("UiPreviewApp", () => {
  beforeAll(async () => {
    installMatchMedia("desktop");
    [appModule, previewStoreModule] = await Promise.all([
      import("./app"),
      import("./preview-store"),
    ]);
  }, 30_000);

  afterAll(() => {
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia;
    } else {
      delete (window as typeof window & { matchMedia?: typeof window.matchMedia }).matchMedia;
    }
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("lang");
    delete document.body.dataset.uiPreviewDevice;
  });

  it("renders the welcome scene and applies theme/lang to the document", async () => {
    renderPreview("?scene=welcome&theme=mint-light&locale=en&device=desktop");

    expect(await screen.findByRole("button", { name: /open workspace/i })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-theme", "mint-light");
    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(document.body.dataset.uiPreviewDevice).toBe("desktop");
  });

  it("renders the unknown scene shell for a missing scene id", async () => {
    window.history.replaceState({}, "", "/ui-preview.html?scene=missing-scene");
    const { resolvePreviewRequest, UiPreviewApp } = appModule;
    const request = resolvePreviewRequest(window.location.search);

    render(<UiPreviewApp request={request} />);

    expect(await screen.findByText("Unknown preview scene")).toBeInTheDocument();
    expect(screen.getByText("missing-scene")).toBeInTheDocument();
  });
});
