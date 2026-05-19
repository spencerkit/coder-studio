import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LocalOverlay } from ".";

describe("LocalOverlay", () => {
  it("renders inside the host flow instead of portaling to document.body", () => {
    const { container } = render(
      <div data-testid="host" style={{ position: "relative" }}>
        <LocalOverlay open>
          <div>Uploading…</div>
        </LocalOverlay>
      </div>
    );

    const overlay = screen.getByRole("status");

    expect(container.querySelector("[data-testid='host']")).toContainElement(overlay);
    expect(document.body).toContainElement(overlay);
    expect(overlay).toHaveClass("local-overlay");
    expect(overlay).toHaveAttribute("aria-live", "polite");
    expect(overlay).toHaveAttribute("data-interactive", "false");
  });

  it("supports dialog mode with aria-modal semantics", () => {
    render(
      <div style={{ position: "relative" }}>
        <LocalOverlay ariaLabelledBy="paste-dialog-title" mode="dialog" open>
          <div className="paste-dialog">
            <h3 id="paste-dialog-title">Paste into terminal</h3>
          </div>
        </LocalOverlay>
      </div>
    );

    const dialog = screen.getByRole("dialog", { name: "Paste into terminal" });

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).not.toHaveAttribute("aria-live");
  });

  it("keeps status overlays pass-through by default so host interaction is preserved", async () => {
    const user = userEvent.setup();
    const onHostClick = vi.fn();

    render(
      <div style={{ position: "relative" }}>
        <button onClick={onHostClick} type="button">
          Host action
        </button>
        <LocalOverlay open>
          <div>History replay failed</div>
        </LocalOverlay>
      </div>
    );

    const overlay = screen.getByRole("status");

    expect(overlay).toHaveAttribute("data-interactive", "false");
    await user.click(screen.getByRole("button", { name: "Host action" }));

    expect(onHostClick).toHaveBeenCalledTimes(1);
  });

  it("supports interactive dialog overlays that dismiss on backdrop click when onDismiss is supplied", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(
      <div style={{ position: "relative" }}>
        <LocalOverlay interactive mode="dialog" onDismiss={onDismiss} open>
          <div className="paste-dialog">
            <button type="button">Submit</button>
          </div>
        </LocalOverlay>
      </div>
    );

    await user.click(screen.getByRole("dialog"));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss on backdrop click when not interactive or when onDismiss is absent", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    const { rerender } = render(
      <div style={{ position: "relative" }}>
        <LocalOverlay mode="dialog" open>
          <div className="paste-dialog">Static dialog</div>
        </LocalOverlay>
      </div>
    );

    await user.click(screen.getByRole("dialog"));
    expect(onDismiss).not.toHaveBeenCalled();

    rerender(
      <div style={{ position: "relative" }}>
        <LocalOverlay interactive={false} mode="dialog" onDismiss={onDismiss} open>
          <div className="paste-dialog">Still not interactive</div>
        </LocalOverlay>
      </div>
    );

    await user.click(screen.getByRole("dialog"));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does not lock document scroll", () => {
    document.body.style.overflow = "";

    render(
      <div style={{ position: "relative" }}>
        <LocalOverlay mode="dialog" open>
          <div className="paste-dialog">Paste dialog</div>
        </LocalOverlay>
      </div>
    );

    expect(document.body.style.overflow).toBe("");
  });
});
