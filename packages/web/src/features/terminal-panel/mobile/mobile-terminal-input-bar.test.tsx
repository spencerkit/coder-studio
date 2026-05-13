import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileTerminalInputBar } from "./mobile-terminal-input-bar";

const labels = {
  shortcuts: "Terminal shortcut keys",
  ctrl: "Ctrl",
  ctrlArmed: "Ctrl armed",
  ctrlLocked: "Ctrl locked",
  shift: "Shift",
  shiftArmed: "Shift armed",
  escape: "Escape",
  tab: "Tab",
  enter: "Enter",
  up: "Up arrow",
  down: "Down arrow",
  left: "Left arrow",
  right: "Right arrow",
};

describe("MobileTerminalInputBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("always renders the keybar without an expand-collapse toggle", () => {
    const { container, rerender } = render(
      <MobileTerminalInputBar
        ctrlMode="off"
        shiftArmed={false}
        labels={labels}
        onKeyPress={vi.fn()}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={vi.fn()}
        onShiftTap={vi.fn()}
      />
    );

    expect(container.querySelector(".mobile-terminal-input-bar")).toHaveAttribute(
      "data-expanded",
      "true"
    );
    expect(container.querySelector(".mobile-terminal-input-bar")).toHaveAttribute(
      "data-disabled",
      "false"
    );
    expect(container.querySelector(".mobile-terminal-input-bar__meta")).toBeNull();
    expect(screen.getByRole("group", { name: labels.shortcuts })).toHaveClass(
      "mobile-terminal-input-bar__keys"
    );
    expect(screen.getByRole("button", { name: labels.escape })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: labels.shift })).toHaveAttribute(
      "data-shift-armed",
      "false"
    );

    rerender(
      <MobileTerminalInputBar
        ctrlMode="armed"
        shiftArmed
        labels={labels}
        onKeyPress={vi.fn()}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={vi.fn()}
        onShiftTap={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: labels.ctrlArmed })).toHaveAttribute(
      "data-ctrl-mode",
      "armed"
    );
    expect(screen.getByRole("button", { name: labels.shiftArmed })).toHaveAttribute(
      "data-shift-armed",
      "true"
    );
  });

  it("dispatches key taps and modifier tap callbacks", () => {
    const onKeyPress = vi.fn();
    const onCtrlTap = vi.fn();
    const onShiftTap = vi.fn();

    render(
      <MobileTerminalInputBar
        ctrlMode="off"
        shiftArmed={false}
        labels={labels}
        onKeyPress={onKeyPress}
        onCtrlTap={onCtrlTap}
        onCtrlLongPress={vi.fn()}
        onShiftTap={onShiftTap}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: labels.escape }));
    fireEvent.click(screen.getByRole("button", { name: labels.tab }));
    fireEvent.click(screen.getByRole("button", { name: labels.enter }));

    expect(onKeyPress).toHaveBeenNthCalledWith(1, "escape");
    expect(onKeyPress).toHaveBeenNthCalledWith(2, "tab");
    expect(onKeyPress).toHaveBeenNthCalledWith(3, "enter");

    fireEvent.click(screen.getByRole("button", { name: labels.ctrl }));
    expect(onCtrlTap).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: labels.shift }));
    expect(onShiftTap).toHaveBeenCalledTimes(1);
  });

  it("locks ctrl on long press and switches ctrl labels by mode", () => {
    const onCtrlTap = vi.fn();
    const onCtrlLongPress = vi.fn();

    const { rerender } = render(
      <MobileTerminalInputBar
        ctrlMode="off"
        shiftArmed={false}
        labels={labels}
        onKeyPress={vi.fn()}
        onCtrlTap={onCtrlTap}
        onCtrlLongPress={onCtrlLongPress}
        onShiftTap={vi.fn()}
      />
    );

    const ctrlButton = screen.getByRole("button", { name: labels.ctrl });
    fireEvent.pointerDown(ctrlButton);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    fireEvent.pointerUp(ctrlButton);

    expect(onCtrlLongPress).toHaveBeenCalledTimes(1);
    expect(onCtrlTap).not.toHaveBeenCalled();

    rerender(
      <MobileTerminalInputBar
        ctrlMode="locked"
        shiftArmed={false}
        labels={labels}
        onKeyPress={vi.fn()}
        onCtrlTap={onCtrlTap}
        onCtrlLongPress={onCtrlLongPress}
        onShiftTap={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: labels.ctrlLocked })).toHaveAttribute(
      "data-ctrl-mode",
      "locked"
    );
  });

  it("clears a pending ctrl long-press when the bar becomes disabled", () => {
    const onCtrlLongPress = vi.fn();

    const { rerender } = render(
      <MobileTerminalInputBar
        ctrlMode="off"
        shiftArmed={false}
        labels={labels}
        onKeyPress={vi.fn()}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={onCtrlLongPress}
        onShiftTap={vi.fn()}
      />
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: labels.ctrl }));

    rerender(
      <MobileTerminalInputBar
        ctrlMode="off"
        shiftArmed={false}
        disabled
        labels={labels}
        onKeyPress={vi.fn()}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={onCtrlLongPress}
        onShiftTap={vi.fn()}
      />
    );

    act(() => {
      vi.advanceTimersByTime(450);
    });

    expect(onCtrlLongPress).not.toHaveBeenCalled();
  });

  it("exposes an alternate non-pointer path to lock ctrl", () => {
    const onCtrlTap = vi.fn();
    const onCtrlLongPress = vi.fn();

    render(
      <MobileTerminalInputBar
        ctrlMode="armed"
        shiftArmed={false}
        labels={labels}
        onKeyPress={vi.fn()}
        onCtrlTap={onCtrlTap}
        onCtrlLongPress={onCtrlLongPress}
        onShiftTap={vi.fn()}
      />
    );

    fireEvent.keyDown(screen.getByRole("button", { name: labels.ctrlArmed }), {
      key: "Enter",
      altKey: true,
    });

    expect(screen.getByRole("button", { name: labels.ctrlArmed })).toHaveAttribute(
      "aria-keyshortcuts",
      "Alt+Enter Alt+Space"
    );
    expect(onCtrlLongPress).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: labels.ctrlArmed }), { detail: 1 });

    expect(onCtrlTap).toHaveBeenCalledTimes(1);
  });

  it("uses the shortcuts label for the key group semantics", () => {
    render(
      <MobileTerminalInputBar
        ctrlMode="off"
        shiftArmed={false}
        labels={labels}
        onKeyPress={vi.fn()}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={vi.fn()}
        onShiftTap={vi.fn()}
      />
    );

    expect(screen.getByRole("group", { name: labels.shortcuts })).toHaveClass(
      "mobile-terminal-input-bar__keys"
    );
  });

  it("prevents touch pointer presses from moving focus onto a soft key", () => {
    render(
      <MobileTerminalInputBar
        ctrlMode="off"
        shiftArmed={false}
        labels={labels}
        onKeyPress={vi.fn()}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={vi.fn()}
        onShiftTap={vi.fn()}
      />
    );

    const escapeButton = screen.getByRole("button", { name: labels.escape });
    const pointerDownEvent = new Event("pointerdown", {
      bubbles: true,
      cancelable: true,
    }) as Event & { pointerType?: string };
    pointerDownEvent.pointerType = "touch";

    fireEvent(escapeButton, pointerDownEvent);

    expect(pointerDownEvent.defaultPrevented).toBe(true);
  });

  it("dispatches touch and pen soft-key taps without relying on click synthesis", () => {
    const onKeyPress = vi.fn();
    const onShiftTap = vi.fn();

    render(
      <MobileTerminalInputBar
        ctrlMode="off"
        shiftArmed={false}
        labels={labels}
        onKeyPress={onKeyPress}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={vi.fn()}
        onShiftTap={onShiftTap}
      />
    );

    const escapeButton = screen.getByRole("button", { name: labels.escape });
    fireEvent.pointerDown(escapeButton, { pointerType: "touch" });
    fireEvent.pointerUp(escapeButton, { pointerType: "touch" });

    expect(onKeyPress).toHaveBeenCalledTimes(1);
    expect(onKeyPress).toHaveBeenLastCalledWith("escape");

    const shiftButton = screen.getByRole("button", { name: labels.shift });
    fireEvent.pointerDown(shiftButton, { pointerType: "pen" });
    fireEvent.pointerUp(shiftButton, { pointerType: "pen" });

    expect(onShiftTap).toHaveBeenCalledTimes(1);
  });

  it("dispatches touch ctrl taps on pointer release and keeps long press distinct", () => {
    const onCtrlTap = vi.fn();
    const onCtrlLongPress = vi.fn();

    render(
      <MobileTerminalInputBar
        ctrlMode="off"
        shiftArmed={false}
        labels={labels}
        onKeyPress={vi.fn()}
        onCtrlTap={onCtrlTap}
        onCtrlLongPress={onCtrlLongPress}
        onShiftTap={vi.fn()}
      />
    );

    const ctrlButton = screen.getByRole("button", { name: labels.ctrl });
    fireEvent.pointerDown(ctrlButton, { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerUp(ctrlButton, { pointerType: "touch" });

    expect(onCtrlTap).toHaveBeenCalledTimes(1);
    expect(onCtrlLongPress).not.toHaveBeenCalled();

    fireEvent.pointerDown(ctrlButton, { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    fireEvent.pointerUp(ctrlButton, { pointerType: "touch" });

    expect(onCtrlTap).toHaveBeenCalledTimes(1);
    expect(onCtrlLongPress).toHaveBeenCalledTimes(1);
  });

  it("does not double-dispatch when a touch sequence is followed by a click event", () => {
    const onKeyPress = vi.fn();

    render(
      <MobileTerminalInputBar
        ctrlMode="off"
        shiftArmed={false}
        labels={labels}
        onKeyPress={onKeyPress}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={vi.fn()}
        onShiftTap={vi.fn()}
      />
    );

    const escapeButton = screen.getByRole("button", { name: labels.escape });
    fireEvent.pointerDown(escapeButton, { pointerType: "touch" });
    fireEvent.pointerUp(escapeButton, { pointerType: "touch" });
    fireEvent.click(escapeButton);

    expect(onKeyPress).toHaveBeenCalledTimes(1);
    expect(onKeyPress).toHaveBeenCalledWith("escape");
  });

  it("does not dispatch a touch soft key when the gesture started on a different button", () => {
    const onKeyPress = vi.fn();

    render(
      <MobileTerminalInputBar
        ctrlMode="off"
        shiftArmed={false}
        labels={labels}
        onKeyPress={onKeyPress}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={vi.fn()}
        onShiftTap={vi.fn()}
      />
    );

    const tabButton = screen.getByRole("button", { name: labels.tab });
    const escapeButton = screen.getByRole("button", { name: labels.escape });
    fireEvent.pointerDown(tabButton, { pointerType: "touch", pointerId: 7 });
    fireEvent.pointerUp(escapeButton, { pointerType: "touch", pointerId: 7 });

    expect(onKeyPress).not.toHaveBeenCalled();
  });

  it("ignores command-key callbacks when disabled", () => {
    const onCtrlTap = vi.fn();
    const onCtrlLongPress = vi.fn();
    const onKeyPress = vi.fn();
    const onShiftTap = vi.fn();

    const { container } = render(
      <MobileTerminalInputBar
        ctrlMode="locked"
        shiftArmed
        disabled
        labels={labels}
        onKeyPress={onKeyPress}
        onCtrlTap={onCtrlTap}
        onCtrlLongPress={onCtrlLongPress}
        onShiftTap={onShiftTap}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: labels.escape }));
    const ctrlButton = screen.getByRole("button", { name: labels.ctrlLocked });
    fireEvent.click(screen.getByRole("button", { name: labels.shiftArmed }));
    fireEvent.pointerDown(ctrlButton);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    fireEvent.pointerUp(ctrlButton);

    expect(container.querySelector(".mobile-terminal-input-bar")).toHaveAttribute(
      "data-disabled",
      "true"
    );
    expect(screen.getByRole("button", { name: labels.escape })).toBeDisabled();
    expect(onKeyPress).not.toHaveBeenCalled();
    expect(onCtrlTap).not.toHaveBeenCalled();
    expect(onCtrlLongPress).not.toHaveBeenCalled();
    expect(onShiftTap).not.toHaveBeenCalled();
  });

  it("keeps the full keybar visible while command keys are disabled", () => {
    render(
      <MobileTerminalInputBar
        ctrlMode="off"
        shiftArmed
        disabled
        labels={labels}
        onKeyPress={vi.fn()}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={vi.fn()}
        onShiftTap={vi.fn()}
      />
    );

    expect(screen.getByRole("group", { name: labels.shortcuts })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: labels.escape })).toBeDisabled();
    expect(screen.getByRole("button", { name: labels.shiftArmed })).toBeDisabled();
  });

  it("keeps direction keys adjacent and before enter", () => {
    render(
      <MobileTerminalInputBar
        ctrlMode="off"
        shiftArmed={false}
        labels={labels}
        onKeyPress={vi.fn()}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={vi.fn()}
        onShiftTap={vi.fn()}
      />
    );

    const buttons = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));

    expect(buttons).toEqual([
      labels.ctrl,
      labels.shift,
      labels.escape,
      labels.tab,
      labels.up,
      labels.left,
      labels.down,
      labels.right,
      labels.enter,
    ]);
  });
});
