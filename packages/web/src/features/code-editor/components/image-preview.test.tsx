import { createEvent, fireEvent, render, screen } from "@testing-library/react";
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

  it("renders accessible zoom controls in the preview footer", () => {
    renderWithLocale(
      <ImagePreview
        alt="Preview asset"
        mime="image/png"
        sizeBytes={128}
        url="/api/file/test.png"
        version="1"
      />
    );

    expect(screen.getByRole("toolbar", { name: "Image zoom controls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fit to window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actual size" })).toBeInTheDocument();
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Fit");
  });

  it("updates the zoom level when the zoom buttons are used", () => {
    renderWithLocale(
      <ImagePreview
        alt="Preview asset"
        mime="image/png"
        sizeBytes={128}
        url="/api/file/test.png"
        version="1"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("125%");

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("100%");

    fireEvent.click(screen.getByRole("button", { name: "Fit to window" }));
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Fit");

    fireEvent.click(screen.getByRole("button", { name: "Actual size" }));
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("100%");
  });

  it("zooms with modified wheel input while normal wheel leaves zoom unchanged", () => {
    renderWithLocale(
      <ImagePreview
        alt="Preview asset"
        mime="image/png"
        sizeBytes={128}
        url="/api/file/test.png"
        version="1"
      />
    );

    const canvas = document.querySelector(".image-preview-canvas");
    expect(canvas).toBeTruthy();

    const normalWheel = createEvent.wheel(canvas as HTMLElement, {
      cancelable: true,
      deltaY: -120,
    });
    fireEvent(canvas as HTMLElement, normalWheel);
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Fit");

    const zoomWheel = createEvent.wheel(canvas as HTMLElement, {
      cancelable: true,
      ctrlKey: true,
      deltaY: -120,
    });
    fireEvent(canvas as HTMLElement, zoomWheel);
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("125%");
  });

  it("resets the zoom level when only the version changes", () => {
    const { rerender } = renderWithLocale(
      <ImagePreview
        alt="Preview asset"
        mime="image/png"
        sizeBytes={128}
        url="/api/file/test.png"
        version="1"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("125%");

    rerender(
      <ImagePreview
        alt="Preview asset"
        mime="image/png"
        sizeBytes={128}
        url="/api/file/test.png"
        version="2"
      />
    );

    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Fit");
  });

  it("pans a manually zoomed image with mouse drag", () => {
    renderWithLocale(
      <ImagePreview
        alt="Preview asset"
        mime="image/png"
        sizeBytes={128}
        url="/api/file/test.png"
        version="1"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Actual size" }));

    const canvas = document.querySelector(".image-preview-canvas") as HTMLElement;
    canvas.scrollLeft = 80;
    canvas.scrollTop = 40;

    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 200,
      clientY: 160,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(canvas, {
      clientX: 150,
      clientY: 120,
      pointerId: 1,
      pointerType: "mouse",
    });

    expect(canvas.scrollLeft).toBe(130);
    expect(canvas.scrollTop).toBe(80);

    fireEvent.pointerUp(canvas, {
      clientX: 150,
      clientY: 120,
      pointerId: 1,
      pointerType: "mouse",
    });
    expect(canvas).not.toHaveClass("image-preview-canvas--dragging");
  });

  it("pans a manually zoomed image with a touch pointer gesture", () => {
    renderWithLocale(
      <ImagePreview
        alt="Preview asset"
        mime="image/png"
        sizeBytes={128}
        url="/api/file/test.png"
        version="1"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Actual size" }));

    const canvas = document.querySelector(".image-preview-canvas") as HTMLElement;
    canvas.scrollLeft = 80;
    canvas.scrollTop = 40;

    fireEvent.pointerDown(canvas, {
      clientX: 100,
      clientY: 100,
      pointerId: 2,
      pointerType: "touch",
    });
    fireEvent.pointerMove(canvas, {
      clientX: 130,
      clientY: 70,
      pointerId: 2,
      pointerType: "touch",
    });

    expect(canvas.scrollLeft).toBe(50);
    expect(canvas.scrollTop).toBe(70);
    expect(canvas).toHaveClass("image-preview-canvas--dragging");

    fireEvent.pointerCancel(canvas, {
      pointerId: 2,
      pointerType: "touch",
    });
    expect(canvas).not.toHaveClass("image-preview-canvas--dragging");
  });

  it("keeps fit mode drag from hijacking the preview canvas scroll", () => {
    renderWithLocale(
      <ImagePreview
        alt="Preview asset"
        mime="image/png"
        sizeBytes={128}
        url="/api/file/test.png"
        version="1"
      />
    );

    const canvas = document.querySelector(".image-preview-canvas") as HTMLElement;
    canvas.scrollLeft = 80;
    canvas.scrollTop = 40;

    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 200,
      clientY: 160,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(canvas, {
      clientX: 150,
      clientY: 120,
      pointerId: 1,
      pointerType: "mouse",
    });

    expect(canvas.scrollLeft).toBe(80);
    expect(canvas.scrollTop).toBe(40);
    expect(canvas).not.toHaveClass("image-preview-canvas--dragging");
  });
});
