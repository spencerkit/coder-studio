// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTokenTrendSection } from "./agent-token-trend-section";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string) => {
    const translations: Record<string, string> = {
      "workspace.agent_instructions.token_trend.collapse_label": "Collapse Token Trend",
      "workspace.agent_instructions.token_trend.expand_label": "Expand Token Trend",
      "workspace.agent_instructions.token_trend.more_data": "More Data",
      "workspace.agent_instructions.token_trend.title": "Token Trend",
    };

    return translations[key] ?? key;
  },
}));

vi.mock("./agent-instructions-token-trend", () => ({
  AgentInstructionsTokenTrend: ({ workspacePath }: { workspacePath: string }) => (
    <div data-testid="agent-token-trend" data-workspace-path={workspacePath} />
  ),
}));

describe("AgentTokenTrendSection", () => {
  beforeEach(() => {
    navigateMock.mockClear();
  });

  it("renders token trend with collapsible standalone sidebar section chrome", () => {
    render(<AgentTokenTrendSection workspacePath="/repo/project" />);

    const heading = screen.getByRole("heading", { level: 2, name: "Token Trend" });
    const section = heading.closest("section");
    const toggle = screen.getByRole("button", { name: "Collapse Token Trend" });

    expect(section).toHaveClass("workspace-sidebar-section");
    expect(section).toHaveClass("workspace-agent-token-trend-section");
    expect(heading).toHaveClass("workspace-sidebar-section__title");
    expect(toggle).toHaveClass("workspace-sidebar-section__chevron");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls");
    expect(screen.getByTestId("agent-token-trend")).toHaveAttribute(
      "data-workspace-path",
      "/repo/project"
    );

    fireEvent.click(toggle);

    expect(screen.queryByTestId("agent-token-trend")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Token Trend" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("navigates to work analysis scoped to the current workspace from the more data action", () => {
    render(<AgentTokenTrendSection workspacePath="/repo/project" />);

    const moreDataButton = screen.getByRole("button", { name: "More Data" });

    expect(moreDataButton.closest(".workspace-sidebar-section__actions")).toHaveClass(
      "workspace-sidebar-panel__actions"
    );

    fireEvent.click(moreDataButton);

    expect(navigateMock).toHaveBeenCalledWith(
      "/settings?section=analysis&workspacePath=%2Frepo%2Fproject"
    );
  });
});
