import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { CtrlMode, SoftTerminalKeyId } from './virtual-terminal-keys';

const CTRL_LONG_PRESS_MS = 400;

const SOFT_KEY_LAYOUT: Array<{ id: SoftTerminalKeyId; text: string }> = [
  { id: 'escape', text: 'Esc' },
  { id: 'tab', text: 'Tab' },
  { id: 'arrow_up', text: '↑' },
  { id: 'enter', text: 'Enter' },
  { id: 'arrow_left', text: '←' },
  { id: 'arrow_down', text: '↓' },
  { id: 'arrow_right', text: '→' },
];

export interface MobileTerminalInputBarLabels {
  expand: string;
  collapse: string;
  shortcuts: string;
  ctrl: string;
  ctrlArmed: string;
  ctrlLocked: string;
  escape: string;
  tab: string;
  enter: string;
  up: string;
  down: string;
  left: string;
  right: string;
}

interface MobileTerminalInputBarProps {
  expanded: boolean;
  ctrlMode: CtrlMode;
  disabled?: boolean;
  labels: MobileTerminalInputBarLabels;
  onToggleExpanded: () => void;
  onKeyPress: (key: SoftTerminalKeyId) => void;
  onCtrlTap: () => void;
  onCtrlLongPress: () => void;
}

function getKeyAriaLabel(key: SoftTerminalKeyId, labels: MobileTerminalInputBarLabels): string {
  switch (key) {
    case 'escape':
      return labels.escape;
    case 'tab':
      return labels.tab;
    case 'enter':
      return labels.enter;
    case 'arrow_up':
      return labels.up;
    case 'arrow_down':
      return labels.down;
    case 'arrow_left':
      return labels.left;
    case 'arrow_right':
      return labels.right;
  }
}

export function MobileTerminalInputBar({
  expanded,
  ctrlMode,
  disabled = false,
  labels,
  onToggleExpanded,
  onKeyPress,
  onCtrlTap,
  onCtrlLongPress,
}: MobileTerminalInputBarProps) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const longPressSourceRef = useRef<'keyboard' | 'pointer' | null>(null);
  const commandKeysDisabled = disabled;

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (commandKeysDisabled) {
      clearLongPress();
      longPressTriggeredRef.current = false;
      longPressSourceRef.current = null;
    }
  }, [commandKeysDisabled]);

  useEffect(() => {
    return () => {
      clearLongPress();
    };
  }, []);

  const startCtrlGesture = () => {
    if (commandKeysDisabled) {
      return;
    }

    clearLongPress();
    longPressTriggeredRef.current = false;
    longPressSourceRef.current = null;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      longPressSourceRef.current = 'pointer';
      onCtrlLongPress();
    }, CTRL_LONG_PRESS_MS);
  };

  const cancelCtrlGesture = () => {
    clearLongPress();
    longPressTriggeredRef.current = false;
    longPressSourceRef.current = null;
  };

  const finishCtrlGesture = () => {
    if (commandKeysDisabled) {
      return;
    }

    clearLongPress();
  };

  const handleCtrlClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (commandKeysDisabled) {
      return;
    }

    if (longPressTriggeredRef.current) {
      const shouldSwallowClick =
        longPressSourceRef.current === 'pointer' ||
        (longPressSourceRef.current === 'keyboard' && event.detail === 0);

      longPressTriggeredRef.current = false;
      longPressSourceRef.current = null;
      if (shouldSwallowClick) {
        return;
      }
    }

    onCtrlTap();
  };

  const handleCtrlKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (commandKeysDisabled) {
      return;
    }

    if ((event.key === 'Enter' || event.key === ' ') && event.altKey) {
      event.preventDefault();
      clearLongPress();
      longPressTriggeredRef.current = true;
      longPressSourceRef.current = 'keyboard';
      onCtrlLongPress();
    }
  };

  const ctrlLabel =
    ctrlMode === 'locked' ? labels.ctrlLocked : ctrlMode === 'armed' ? labels.ctrlArmed : labels.ctrl;

  return (
    <div
      className="mobile-terminal-input-bar"
      data-expanded={expanded ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
    >
      <button
        type="button"
        className="mobile-terminal-input-bar__toggle"
        aria-label={expanded ? labels.collapse : labels.expand}
        onClick={onToggleExpanded}
      >
        <span className="mobile-terminal-input-bar__toggle-pill" aria-hidden="true" />
      </button>

      {expanded ? (
        <div className="mobile-terminal-input-bar__keys" role="group" aria-label={labels.shortcuts}>
          <button
            type="button"
            className="mobile-terminal-input-bar__key mobile-terminal-input-bar__ctrl"
            data-ctrl-mode={ctrlMode}
            aria-pressed={ctrlMode !== 'off'}
            aria-label={ctrlLabel}
            aria-keyshortcuts="Alt+Enter Alt+Space"
            disabled={commandKeysDisabled}
            onPointerDown={startCtrlGesture}
            onPointerUp={finishCtrlGesture}
            onPointerCancel={cancelCtrlGesture}
            onPointerLeave={cancelCtrlGesture}
            onClick={handleCtrlClick}
            onKeyDown={handleCtrlKeyDown}
          >
            Ctrl
          </button>

          {SOFT_KEY_LAYOUT.map((key) => (
            <button
                key={key.id}
                type="button"
                className="mobile-terminal-input-bar__key"
                aria-label={getKeyAriaLabel(key.id, labels)}
                disabled={commandKeysDisabled}
                onClick={() => onKeyPress(key.id)}
              >
                {key.text}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
