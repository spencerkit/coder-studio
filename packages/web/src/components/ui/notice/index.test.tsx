import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Notice } from ".";

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

  it("renders optional action and dismiss controls", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onDismiss = vi.fn();

    render(
      <Notice
        actionLabel="Refresh"
        dismissible
        message="Retry the request."
        onAction={onAction}
        onDismiss={onDismiss}
        title="Settings load failed"
        tone="warning"
      />
    );

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not render a dismiss button without an onDismiss handler", () => {
    render(<Notice dismissible message="Retry the request." title="Settings load failed" />);

    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("supports config drift compatibility classes", () => {
    render(
      <Notice
        className="config-drift-banner__notice"
        message="Backed up config to /tmp/config.toml.bak"
        tone="info"
      />
    );

    const notice = document.querySelector(".config-drift-banner__notice");
    expect(notice).toBeTruthy();
    expect(notice).toHaveTextContent("Backed up config to /tmp/config.toml.bak");
    expect(notice).not.toHaveClass("settings-page__notice--error");
  });
});
