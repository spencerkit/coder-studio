import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren, ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { ImagePreview } from "./image-preview";

function renderWithLocale(ui: ReactElement) {
  const store = createStore();
  store.set(localeAtom, "en");

  function LocaleProvider({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  }

  return render(ui, { wrapper: LocaleProvider });
}

describe("ImagePreview", () => {
  it("preserves the migrated empty-state fallback when image loading fails", () => {
    renderWithLocale(
      <ImagePreview
        alt="Preview asset"
        mime="image/png"
        sizeBytes={128}
        url="/api/file/test.png"
        version="1"
      />
    );

    fireEvent.error(screen.getByRole("img", { name: "Preview asset" }));

    expect(document.querySelector(".git-diff-empty")).toBeTruthy();
    expect(screen.getByText("Preview unavailable")).toHaveClass("git-diff-empty-title");
    expect(screen.getByText(/could not be loaded/i)).toHaveClass("git-diff-empty-body");
  });

  it("resets the preview state when only the version changes", () => {
    const { rerender } = renderWithLocale(
      <ImagePreview
        alt="Preview asset"
        mime="image/png"
        sizeBytes={128}
        url="/api/file/test.png"
        version="1"
      />
    );

    fireEvent.error(screen.getByRole("img", { name: "Preview asset" }));
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();

    rerender(
      <ImagePreview
        alt="Preview asset"
        mime="image/png"
        sizeBytes={128}
        url="/api/file/test.png"
        version="2"
      />
    );

    expect(screen.queryByText("Preview unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Preview asset" })).toHaveAttribute(
      "src",
      "/api/file/test.png?v=2"
    );
  });

  it("appends the cache-busting version with ampersand when the url already has query params", () => {
    renderWithLocale(
      <ImagePreview
        alt="Preview asset"
        mime="image/png"
        sizeBytes={128}
        url="/api/file?workspaceId=ws-1&path=logo.png"
        version="7"
      />
    );

    expect(screen.getByRole("img", { name: "Preview asset" })).toHaveAttribute(
      "src",
      "/api/file?workspaceId=ws-1&path=logo.png&v=7"
    );
  });
});
