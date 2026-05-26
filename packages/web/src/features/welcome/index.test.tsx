import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../atoms/app-ui";
import { WelcomePage } from "./index";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

vi.mock("../workspace/views/shared/workspace-launch-modal", () => ({
  WorkspaceLaunchModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="workspace-launch-modal">
      <button type="button" onClick={onClose}>
        Close modal
      </button>
    </div>
  ),
}));

describe("WelcomePage", () => {
  beforeEach(() => {
    viewportMocks.viewport = "desktop";
  });

  it("opens the workspace launch modal directly from the primary action", () => {
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Workspace" }));

    expect(screen.getByTestId("workspace-launch-modal")).toBeInTheDocument();
  });

  it("navigates to settings from the secondary action", () => {
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<WelcomePage />} />
            <Route path="/settings" element={<div>Settings Screen</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByText("Settings Screen")).toBeInTheDocument();
  });

  it("adds the mobile welcome page variant classes on mobile viewports", () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </Provider>
    );

    expect(document.querySelector(".welcome-container--mobile")).toBeTruthy();
    expect(document.querySelector(".welcome-card--mobile")).toBeTruthy();
    expect(document.querySelector(".welcome-card.welcome-card--mobile")).toBeTruthy();
  });

  it("renders task-oriented English activation copy and action hints", () => {
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText("LOCAL AI CODING WORKSPACE")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Open a workspace. Start an AI coding session.",
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/Choose a local project folder to get started\./)).toBeInTheDocument();
    expect(screen.getByText(/launch Claude Code or Codex/i)).toBeInTheDocument();
    expect(screen.getByText("Step 1: Open your project folder")).toBeInTheDocument();
    expect(
      screen.getByText("Step 2 happens inside the workspace: start Claude or Codex.")
    ).toBeInTheDocument();
    expect(screen.getByText("Need to configure providers first?")).toBeInTheDocument();
    expect(screen.getByText("Start Claude or Codex sessions")).toBeInTheDocument();
    expect(
      screen.getByText("Open a workspace first, then launch an AI session for that project.")
    ).toBeInTheDocument();
    expect(screen.getByText("Review code and Git side by side")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Inspect files and changes next to the agent instead of switching between tools."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Run commands in the same workspace")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Use integrated terminals alongside your AI session when you need manual control."
      )
    ).toBeInTheDocument();
    expect(document.querySelector(".welcome-card__hero")).toBeTruthy();
    expect(document.querySelector(".welcome-card__actions")).toBeTruthy();
    expect(document.querySelector(".welcome-card__features")).toBeTruthy();
    expect(document.querySelector(".welcome-actions-group")).toBeTruthy();
    const openWorkspaceButton = screen.getByRole("button", { name: "Open Workspace" });
    const settingsButton = screen.getByRole("button", { name: "Settings" });
    const featureCards = Array.from(document.querySelectorAll(".welcome-feature"));

    expect(featureCards).toHaveLength(3);
    expect(
      openWorkspaceButton.querySelector('[data-icon-semantic="nav.newWorkspace"]')
    ).toBeTruthy();
    expect(settingsButton.querySelector('[data-icon-semantic="nav.settings"]')).toBeTruthy();
  });

  it("renders translated Chinese activation copy and action hints when locale is set to zh", () => {
    const store = createStore();
    store.set(localeAtom, "zh");

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText("本地 AI 编码工作台")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "先打开工作区，再启动 AI 编码会话" })
    ).toBeInTheDocument();
    expect(screen.getByText(/先选择一个本地项目目录。/)).toBeInTheDocument();
    expect(screen.getByText(/启动 Claude Code 或 Codex/)).toBeInTheDocument();
    expect(screen.getByText("第 1 步：打开你的项目目录")).toBeInTheDocument();
    expect(screen.getByText("第 2 步会在工作区里完成：启动 Claude 或 Codex。")).toBeInTheDocument();
    expect(screen.getByText("如果你需要先配置 Provider，可以先去设置。")).toBeInTheDocument();
    expect(screen.getByText("启动 Claude 或 Codex 会话")).toBeInTheDocument();
    expect(screen.getByText("先打开工作区，再为当前项目启动一个 AI 会话。")).toBeInTheDocument();
    expect(screen.getByText("并排查看代码和 Git 变更")).toBeInTheDocument();
    expect(
      screen.getByText("在 Agent 旁边直接查看文件和改动，不用在多个工具之间来回切换。")
    ).toBeInTheDocument();
    expect(screen.getByText("在同一工作区运行命令")).toBeInTheDocument();
    expect(
      screen.getByText("需要手动操作时，可以直接在集成终端里配合 AI 会话执行命令。")
    ).toBeInTheDocument();
  });

  it("renders the welcome feature icons", () => {
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </Provider>
    );

    const featureCards = Array.from(document.querySelectorAll(".welcome-feature"));

    expect(
      featureCards.some((card) =>
        card.querySelector('[data-icon-semantic="state.welcome.lightning"]')
      )
    ).toBe(true);
    expect(
      featureCards.some((card) => card.querySelector('[data-icon-semantic="state.welcome.git"]'))
    ).toBe(true);
    expect(
      featureCards.some((card) =>
        card.querySelector('[data-icon-semantic="state.welcome.terminal"]')
      )
    ).toBe(true);
  });

  it("renders the flat welcome shell with hero, actions, and features sections", () => {
    const store = createStore();
    store.set(localeAtom, "en");

    const { container } = render(
      <Provider store={store}>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </Provider>
    );

    expect(container.querySelector(".welcome-card__hero")).toBeTruthy();
    expect(container.querySelector(".welcome-card__actions")).toBeTruthy();
    expect(container.querySelector(".welcome-card__features")).toBeTruthy();
    expect(container.querySelector(".welcome-actions-group")).toBeTruthy();
    expect(container.querySelector(".welcome-card__panel")).toBeFalsy();
  });
});
