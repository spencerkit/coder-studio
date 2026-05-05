import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileTerminalInputBar } from './mobile-terminal-input-bar';

const labels = {
  expand: 'Expand terminal keys',
  collapse: 'Collapse terminal keys',
  shortcuts: 'Terminal shortcut keys',
  ctrl: 'Ctrl',
  ctrlArmed: 'Ctrl armed',
  ctrlLocked: 'Ctrl locked',
  escape: 'Escape',
  tab: 'Tab',
  enter: 'Enter',
  up: 'Up arrow',
  down: 'Down arrow',
  left: 'Left arrow',
  right: 'Right arrow',
};

describe('MobileTerminalInputBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders only the handle while collapsed and shows the key grid when expanded', async () => {
    const onToggleExpanded = vi.fn();

    const { container, rerender } = render(
      <MobileTerminalInputBar
        expanded={false}
        ctrlMode="off"
        labels={labels}
        onToggleExpanded={onToggleExpanded}
        onKeyPress={vi.fn()}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={vi.fn()}
      />
    );

    expect(container.querySelector('.mobile-terminal-input-bar')).toHaveAttribute('data-expanded', 'false');
    expect(container.querySelector('.mobile-terminal-input-bar')).toHaveAttribute('data-disabled', 'false');
    expect(screen.getByRole('button', { name: labels.expand })).toHaveClass(
      'mobile-terminal-input-bar__toggle'
    );
    expect(
      container.querySelector('.mobile-terminal-input-bar__toggle-pill')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: labels.escape })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: labels.expand }));
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);

    rerender(
      <MobileTerminalInputBar
        expanded
        ctrlMode="armed"
        labels={labels}
        onToggleExpanded={onToggleExpanded}
        onKeyPress={vi.fn()}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={vi.fn()}
      />
    );

    expect(container.querySelector('.mobile-terminal-input-bar')).toHaveAttribute('data-expanded', 'true');
    expect(screen.getByRole('button', { name: labels.collapse })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: labels.shortcuts })).toHaveClass(
      'mobile-terminal-input-bar__keys'
    );
    expect(screen.getByRole('button', { name: labels.escape })).toHaveClass(
      'mobile-terminal-input-bar__key'
    );
    expect(screen.getByRole('button', { name: labels.up })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.ctrlArmed })).toHaveClass(
      'mobile-terminal-input-bar__key',
      'mobile-terminal-input-bar__ctrl'
    );
    expect(screen.getByRole('button', { name: labels.ctrlArmed })).toHaveAttribute(
      'data-ctrl-mode',
      'armed'
    );
  });

  it('dispatches key taps and ctrl tap callbacks', async () => {
    const onKeyPress = vi.fn();
    const onCtrlTap = vi.fn();

    render(
      <MobileTerminalInputBar
        expanded
        ctrlMode="off"
        labels={labels}
        onToggleExpanded={vi.fn()}
        onKeyPress={onKeyPress}
        onCtrlTap={onCtrlTap}
        onCtrlLongPress={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: labels.escape }));
    fireEvent.click(screen.getByRole('button', { name: labels.tab }));
    fireEvent.click(screen.getByRole('button', { name: labels.enter }));

    expect(onKeyPress).toHaveBeenNthCalledWith(1, 'escape');
    expect(onKeyPress).toHaveBeenNthCalledWith(2, 'tab');
    expect(onKeyPress).toHaveBeenNthCalledWith(3, 'enter');

    fireEvent.click(screen.getByRole('button', { name: labels.ctrl }));
    expect(onCtrlTap).toHaveBeenCalledTimes(1);
  });

  it('locks ctrl on long press and switches ctrl labels by mode', () => {
    const onCtrlTap = vi.fn();
    const onCtrlLongPress = vi.fn();

    const { rerender } = render(
      <MobileTerminalInputBar
        expanded
        ctrlMode="off"
        labels={labels}
        onToggleExpanded={vi.fn()}
        onKeyPress={vi.fn()}
        onCtrlTap={onCtrlTap}
        onCtrlLongPress={onCtrlLongPress}
      />
    );

    const ctrlButton = screen.getByRole('button', { name: labels.ctrl });
    fireEvent.pointerDown(ctrlButton);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    fireEvent.pointerUp(ctrlButton);

    expect(onCtrlLongPress).toHaveBeenCalledTimes(1);
    expect(onCtrlTap).not.toHaveBeenCalled();

    rerender(
      <MobileTerminalInputBar
        expanded
        ctrlMode="locked"
        labels={labels}
        onToggleExpanded={vi.fn()}
        onKeyPress={vi.fn()}
        onCtrlTap={onCtrlTap}
        onCtrlLongPress={onCtrlLongPress}
      />
    );

    expect(screen.getByRole('button', { name: labels.ctrlLocked })).toHaveAttribute(
      'data-ctrl-mode',
      'locked'
    );
  });

  it('clears a pending ctrl long-press when the bar becomes disabled', () => {
    const onCtrlLongPress = vi.fn();

    const { rerender } = render(
      <MobileTerminalInputBar
        expanded
        ctrlMode="off"
        labels={labels}
        onToggleExpanded={vi.fn()}
        onKeyPress={vi.fn()}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={onCtrlLongPress}
      />
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: labels.ctrl }));

    rerender(
      <MobileTerminalInputBar
        expanded
        ctrlMode="off"
        disabled
        labels={labels}
        onToggleExpanded={vi.fn()}
        onKeyPress={vi.fn()}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={onCtrlLongPress}
      />
    );

    act(() => {
      vi.advanceTimersByTime(450);
    });

    expect(onCtrlLongPress).not.toHaveBeenCalled();
  });

  it('exposes an alternate non-pointer path to lock ctrl', () => {
    const onCtrlTap = vi.fn();
    const onCtrlLongPress = vi.fn();

    render(
      <MobileTerminalInputBar
        expanded
        ctrlMode="armed"
        labels={labels}
        onToggleExpanded={vi.fn()}
        onKeyPress={vi.fn()}
        onCtrlTap={onCtrlTap}
        onCtrlLongPress={onCtrlLongPress}
      />
    );

    fireEvent.keyDown(screen.getByRole('button', { name: labels.ctrlArmed }), {
      key: 'Enter',
      altKey: true,
    });

    expect(screen.getByRole('button', { name: labels.ctrlArmed })).toHaveAttribute(
      'aria-keyshortcuts',
      'Alt+Enter Alt+Space'
    );
    expect(onCtrlLongPress).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: labels.ctrlArmed }), { detail: 1 });

    expect(onCtrlTap).toHaveBeenCalledTimes(1);
  });

  it('uses the shortcuts label for the expanded key group semantics', () => {
    render(
      <MobileTerminalInputBar
        expanded
        ctrlMode="off"
        labels={labels}
        onToggleExpanded={vi.fn()}
        onKeyPress={vi.fn()}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={vi.fn()}
      />
    );

    expect(screen.getByRole('group', { name: labels.shortcuts })).toHaveClass(
      'mobile-terminal-input-bar__keys'
    );
  });

  it('ignores command-key callbacks when disabled but still allows toggling', () => {
    const onToggleExpanded = vi.fn();
    const onCtrlTap = vi.fn();
    const onCtrlLongPress = vi.fn();
    const onKeyPress = vi.fn();

    const { container } = render(
      <MobileTerminalInputBar
        expanded
        ctrlMode="locked"
        disabled
        labels={labels}
        onToggleExpanded={onToggleExpanded}
        onKeyPress={onKeyPress}
        onCtrlTap={onCtrlTap}
        onCtrlLongPress={onCtrlLongPress}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: labels.collapse }));
    fireEvent.click(screen.getByRole('button', { name: labels.escape }));
    const ctrlButton = screen.getByRole('button', { name: labels.ctrlLocked });
    fireEvent.pointerDown(ctrlButton);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    fireEvent.pointerUp(ctrlButton);

    expect(container.querySelector('.mobile-terminal-input-bar')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByRole('button', { name: labels.escape })).toBeDisabled();
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);
    expect(onKeyPress).not.toHaveBeenCalled();
    expect(onCtrlTap).not.toHaveBeenCalled();
    expect(onCtrlLongPress).not.toHaveBeenCalled();
  });

  it('keeps the expand toggle enabled while command keys are disabled', () => {
    render(
      <MobileTerminalInputBar
        expanded
        ctrlMode="off"
        disabled
        labels={labels}
        onToggleExpanded={vi.fn()}
        onKeyPress={vi.fn()}
        onCtrlTap={vi.fn()}
        onCtrlLongPress={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: labels.collapse })).toBeEnabled();
    expect(screen.getByRole('button', { name: labels.escape })).toBeDisabled();
  });
});
