import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { connectionStatusAtom } from "../../../atoms/connection";
import { ConnectionStatus } from "./connection-status";

vi.mock("../../../components/ui/_internal/use-viewport", () => ({
  useViewport: () => "desktop" as const,
}));

describe("ConnectionStatus", () => {
  it("uses Tooltip instead of a native title attribute for non-connected states", () => {
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");

    const { container } = render(
      <Provider store={store}>
        <ConnectionStatus />
      </Provider>
    );

    const status = container.querySelector(".connection-status");
    expect(status).not.toBeNull();
    expect(status).not.toHaveAttribute("title");

    const statusLabel = status?.getAttribute("aria-label");
    expect(statusLabel).toBeTruthy();

    fireEvent.mouseEnter(status!);

    expect(screen.getByRole("tooltip")).toHaveTextContent(statusLabel ?? "");
  });
});
