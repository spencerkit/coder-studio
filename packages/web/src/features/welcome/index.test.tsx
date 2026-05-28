import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
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
    expect(document.querySelector(".welcome-flow")).toBeTruthy();
  });

  it("renders task-oriented English activation copy with a step-first workflow", () => {
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
    expect(screen.getByText("How it works")).toBeInTheDocument();
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect(screen.getByText("Open your project folder")).toBeInTheDocument();
    expect(
      screen.getByText("Choose a local directory to become your active workspace.")
    ).toBeInTheDocument();
    expect(screen.getByText("Step 2")).toBeInTheDocument();
    expect(screen.getByText("Start Claude or Codex")).toBeInTheDocument();
    expect(
      screen.getByText("Inside the workspace, launch an AI session for that project.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Need provider setup first?")).not.toBeInTheDocument();
    expect(screen.getByText("Why use it here")).toBeInTheDocument();
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
    expect(document.querySelector(".welcome-flow")).toBeTruthy();
    expect(document.querySelector(".welcome-flow__steps")).toBeTruthy();
    expect(document.querySelector(".welcome-flow__support")).toBeFalsy();
    expect(document.querySelector(".welcome-step-card")).toBeTruthy();
    expect(document.querySelector(".welcome-card__features")).toBeTruthy();
    expect(document.querySelector(".welcome-support-list")).toBeTruthy();
    const openWorkspaceButton = screen.getByRole("button", { name: "Open Workspace" });
    const stepCards = Array.from(document.querySelectorAll(".welcome-step-card"));
    const supportItems = Array.from(document.querySelectorAll(".welcome-feature"));

    expect(stepCards).toHaveLength(2);
    expect(supportItems).toHaveLength(2);
    expect(
      openWorkspaceButton.querySelector('[data-icon-semantic="nav.newWorkspace"]')
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("renders translated Chinese activation copy in the step-first layout when locale is set to zh", () => {
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
    expect(screen.getByText("使用步骤")).toBeInTheDocument();
    expect(screen.getByText("第 1 步")).toBeInTheDocument();
    expect(screen.getByText("打开你的项目目录")).toBeInTheDocument();
    expect(screen.getByText("先选择一个本地目录，作为当前工作区。")).toBeInTheDocument();
    expect(screen.getByText("第 2 步")).toBeInTheDocument();
    expect(screen.getByText("启动 Claude 或 Codex")).toBeInTheDocument();
    expect(screen.getByText("进入工作区后，再为当前项目启动一个 AI 会话。")).toBeInTheDocument();
    expect(screen.queryByText("如果要先配置 Provider，可以先去设置。")).not.toBeInTheDocument();
    expect(screen.getByText("为什么在这里使用")).toBeInTheDocument();
    expect(screen.getByText("并排查看代码和 Git 变更")).toBeInTheDocument();
    expect(
      screen.getByText("在 Agent 旁边直接查看文件和改动，不用在多个工具之间来回切换。")
    ).toBeInTheDocument();
    expect(screen.getByText("在同一工作区运行命令")).toBeInTheDocument();
    expect(
      screen.getByText("需要手动操作时，可以直接在集成终端里配合 AI 会话执行命令。")
    ).toBeInTheDocument();
  });

  it("renders the step and support icons", () => {
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </Provider>
    );

    const stepCards = Array.from(document.querySelectorAll(".welcome-step-card"));
    const supportItems = Array.from(document.querySelectorAll(".welcome-feature"));

    expect(
      stepCards.some((card) => card.querySelector('[data-icon-semantic="nav.newWorkspace"]'))
    ).toBe(true);
    expect(
      stepCards.some((card) => card.querySelector('[data-icon-semantic="state.welcome.lightning"]'))
    ).toBe(true);
    expect(
      supportItems.some((card) => card.querySelector('[data-icon-semantic="state.welcome.git"]'))
    ).toBe(true);
    expect(
      supportItems.some((card) =>
        card.querySelector('[data-icon-semantic="state.welcome.terminal"]')
      )
    ).toBe(true);
  });

  it("renders the step-first welcome shell with hero, workflow, and secondary summary", () => {
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
    expect(container.querySelector(".welcome-flow")).toBeTruthy();
    expect(container.querySelector(".welcome-flow__steps")).toBeTruthy();
    expect(container.querySelector(".welcome-flow__support")).toBeFalsy();
    expect(container.querySelector(".welcome-card__features")).toBeTruthy();
    expect(container.querySelector(".welcome-support-list")).toBeTruthy();
    expect(container.querySelector(".welcome-card__panel")).toBeFalsy();
  });
});
