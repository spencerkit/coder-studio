import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePreviewRequest, UiPreviewApp } from "./app";
import { buildUiPreviewStore } from "./preview-store";

function renderPreview(search: string) {
  window.history.replaceState({}, "", `/ui-preview.html${search}`);
  const request = resolvePreviewRequest(window.location.search);
  const seed = request.scene ? request.scene.seed(request.context) : { ...request.context };
  const store = buildUiPreviewStore(seed);

  return render(
    <Provider store={store}>
      <UiPreviewApp request={request} />
    </Provider>
  );
}

describe("UiPreviewApp", () => {
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
    const request = resolvePreviewRequest(window.location.search);

    render(<UiPreviewApp request={request} />);

    expect(await screen.findByText("Unknown preview scene")).toBeInTheDocument();
    expect(screen.getByText("missing-scene")).toBeInTheDocument();
  });
});
