import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Notice } from "..";

describe("Notice", () => {
  it("does not set a default role when the caller omits one", () => {
    render(<Notice data-testid="notice-root" message="Saved" tone="success" />);

    expect(screen.getByTestId("notice-root")).not.toHaveAttribute("role");
  });

  it("renders shared content, compatibility classes, and pass-through props", () => {
    render(
      <Notice
        aria-live="polite"
        className="custom-notice"
        data-testid="notice-root"
        message="settings exploded"
        title="Settings load failed"
        tone="error"
      />
    );

    const notice = screen.getByTestId("notice-root");

    expect(notice).toHaveClass(
      "settings-page__notice",
      "settings-page__notice--error",
      "custom-notice"
    );
    expect(notice).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Settings load failed")).toHaveClass("settings-page__notice-title");
    expect(screen.getByText("settings exploded")).toHaveClass("settings-page__notice-message");
    expect(document.querySelector(".settings-page__notice-copy")).toBeTruthy();
  });

  it("renders an optional action slot without overriding caller-owned button classes", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();

    render(
      <Notice
        action={
          <button type="button" className="settings-link" onClick={onAction}>
            Refresh
          </button>
        }
        message="Retry the request."
        title="Settings load failed"
        tone="warning"
      />
    );

    const notice = screen.getByText("Settings load failed").closest(".settings-page__notice");
    expect(notice).not.toBeNull();
    const action = within(notice as HTMLElement).getByRole("button", { name: "Refresh" });
    expect(action).toHaveClass("settings-link");

    await user.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("does not render an action wrapper when the caller omits the slot", () => {
    const { container } = render(
      <Notice message="Retry the request." title="Settings load failed" />
    );

    expect(container.querySelector('[class*="action"]')).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
