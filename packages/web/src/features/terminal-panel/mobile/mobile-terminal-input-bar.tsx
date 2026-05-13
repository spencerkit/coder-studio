import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from "react";
import type { CtrlMode, SoftTerminalKeyId } from "./virtual-terminal-keys";

const CTRL_LONG_PRESS_MS = 400;

const SOFT_KEY_LAYOUT: Array<{ id: SoftTerminalKeyId; text: string }> = [
  { id: "escape", text: "Esc" },
  { id: "tab", text: "Tab" },
  { id: "arrow_up", text: "↑" },
  { id: "arrow_left", text: "←" },
  { id: "arrow_down", text: "↓" },
  { id: "arrow_right", text: "→" },
  { id: "enter", text: "Enter" },
];

export interface MobileTerminalInputBarLabels {
  shortcuts: string;
  ctrl: string;
  ctrlArmed: string;
  ctrlLocked: string;
  shift: string;
  shiftArmed: string;
  escape: string;
  tab: string;
  enter: string;
  up: string;
  down: string;
  left: string;
  right: string;
}

interface MobileTerminalInputBarProps {
  ctrlMode: CtrlMode;
  shiftArmed: boolean;
  disabled?: boolean;
  labels: MobileTerminalInputBarLabels;
  onKeyPress: (key: SoftTerminalKeyId) => void;
  onCtrlTap: () => void;
  onCtrlLongPress: () => void;
  onShiftTap: () => void;
}

type TouchLikeGestureTarget = "ctrl" | "shift" | SoftTerminalKeyId;

type TouchLikeGestureStatus = "matched" | "mismatched" | "none";

interface TouchLikeGestureState {
  pointerId: number;
  target: TouchLikeGestureTarget;
}

function preserveExistingInputFocus(event: ReactPointerEvent<HTMLButtonElement>) {
  if (event.pointerType === "touch" || event.pointerType === "pen") {
    event.preventDefault();
  }
}

function isTouchLikePointer(event: ReactPointerEvent<HTMLButtonElement>) {
  return event.pointerType === "touch" || event.pointerType === "pen";
}

function getKeyAriaLabel(key: SoftTerminalKeyId, labels: MobileTerminalInputBarLabels): string {
  switch (key) {
    case "escape":
      return labels.escape;
    case "tab":
      return labels.tab;
    case "enter":
      return labels.enter;
    case "arrow_up":
      return labels.up;
    case "arrow_down":
      return labels.down;
    case "arrow_left":
      return labels.left;
    case "arrow_right":
      return labels.right;
  }
}

export function MobileTerminalInputBar({
  ctrlMode,
  shiftArmed,
  disabled = false,
  labels,
  onKeyPress,
  onCtrlTap,
  onCtrlLongPress,
  onShiftTap,
}: MobileTerminalInputBarProps) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressedClickResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const longPressSourceRef = useRef<"keyboard" | "pointer" | null>(null);
  const suppressNextPointerClickRef = useRef(false);
  const touchLikeGestureRef = useRef<TouchLikeGestureState | null>(null);
  const commandKeysDisabled = disabled;

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const clearSuppressedClickReset = () => {
    if (suppressedClickResetTimerRef.current !== null) {
      clearTimeout(suppressedClickResetTimerRef.current);
      suppressedClickResetTimerRef.current = null;
    }
  };

  const scheduleSuppressedPointerClick = () => {
    suppressNextPointerClickRef.current = true;
    clearSuppressedClickReset();
    suppressedClickResetTimerRef.current = setTimeout(() => {
      suppressNextPointerClickRef.current = false;
      suppressedClickResetTimerRef.current = null;
    }, 0);
  };

  const consumeSuppressedPointerClick = () => {
    if (!suppressNextPointerClickRef.current) {
      return false;
    }

    suppressNextPointerClickRef.current = false;
    clearSuppressedClickReset();
    return true;
  };

  const clearTouchLikeGesture = () => {
    touchLikeGestureRef.current = null;
  };

  const startTouchLikeGesture = (
    event: ReactPointerEvent<HTMLButtonElement>,
    target: TouchLikeGestureTarget
  ) => {
    if (!isTouchLikePointer(event)) {
      return;
    }

    touchLikeGestureRef.current = {
      pointerId: event.pointerId,
      target,
    };
  };

  const finishTouchLikeGesture = (
    event: ReactPointerEvent<HTMLButtonElement>,
    target: TouchLikeGestureTarget
  ): TouchLikeGestureStatus => {
    if (!isTouchLikePointer(event)) {
      return "none";
    }

    const activeGesture = touchLikeGestureRef.current;
    if (!activeGesture || activeGesture.pointerId !== event.pointerId) {
      return "none";
    }

    touchLikeGestureRef.current = null;
    return activeGesture.target === target ? "matched" : "mismatched";
  };

  useEffect(() => {
    if (commandKeysDisabled) {
      clearLongPress();
      clearSuppressedClickReset();
      clearTouchLikeGesture();
      longPressTriggeredRef.current = false;
      longPressSourceRef.current = null;
      suppressNextPointerClickRef.current = false;
    }
  }, [commandKeysDisabled]);

  useEffect(() => {
    return () => {
      clearLongPress();
      clearSuppressedClickReset();
      clearTouchLikeGesture();
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
      longPressSourceRef.current = "pointer";
      onCtrlLongPress();
    }, CTRL_LONG_PRESS_MS);
  };

  const cancelCtrlGesture = () => {
    clearLongPress();
    longPressTriggeredRef.current = false;
    longPressSourceRef.current = null;
    suppressNextPointerClickRef.current = false;
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

    if (consumeSuppressedPointerClick()) {
      return;
    }

    if (longPressTriggeredRef.current) {
      const shouldSwallowClick =
        longPressSourceRef.current === "pointer" ||
        (longPressSourceRef.current === "keyboard" && event.detail === 0);

      longPressTriggeredRef.current = false;
      longPressSourceRef.current = null;
      if (shouldSwallowClick) {
        return;
      }
    }

    onCtrlTap();
  };

  const handleCtrlPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const touchGestureStatus = finishTouchLikeGesture(event, "ctrl");
    finishCtrlGesture();
    if (commandKeysDisabled || !isTouchLikePointer(event) || touchGestureStatus === "none") {
      return;
    }

    scheduleSuppressedPointerClick();

    if (touchGestureStatus !== "matched") {
      return;
    }

    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      longPressSourceRef.current = null;
      return;
    }

    onCtrlTap();
  };

  const handleTouchLikePointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
    target: TouchLikeGestureTarget,
    callback: () => void
  ) => {
    if (commandKeysDisabled || !isTouchLikePointer(event)) {
      return;
    }

    const touchGestureStatus = finishTouchLikeGesture(event, target);
    if (touchGestureStatus === "none") {
      return;
    }

    scheduleSuppressedPointerClick();
    if (touchGestureStatus !== "matched") {
      return;
    }

    callback();
  };

  const handleShiftClick = () => {
    if (commandKeysDisabled || consumeSuppressedPointerClick()) {
      return;
    }

    onShiftTap();
  };

  const handleSoftKeyClick = (key: SoftTerminalKeyId) => {
    if (commandKeysDisabled || consumeSuppressedPointerClick()) {
      return;
    }

    onKeyPress(key);
  };

  const handleCtrlKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (commandKeysDisabled) {
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && event.altKey) {
      event.preventDefault();
      clearLongPress();
      longPressTriggeredRef.current = true;
      longPressSourceRef.current = "keyboard";
      onCtrlLongPress();
    }
  };

  const ctrlLabel =
    ctrlMode === "locked"
      ? labels.ctrlLocked
      : ctrlMode === "armed"
        ? labels.ctrlArmed
        : labels.ctrl;
  const shiftLabel = shiftArmed ? labels.shiftArmed : labels.shift;

  return (
    <div
      className="mobile-terminal-input-bar"
      data-expanded="true"
      data-disabled={disabled ? "true" : "false"}
    >
      <div className="mobile-terminal-input-bar__keys" role="group" aria-label={labels.shortcuts}>
        <button
          type="button"
          className="mobile-terminal-input-bar__key mobile-terminal-input-bar__ctrl"
          data-ctrl-mode={ctrlMode}
          aria-pressed={ctrlMode !== "off"}
          aria-label={ctrlLabel}
          aria-keyshortcuts="Alt+Enter Alt+Space"
          disabled={commandKeysDisabled}
          onPointerDown={(event) => {
            preserveExistingInputFocus(event);
            startTouchLikeGesture(event, "ctrl");
            startCtrlGesture();
          }}
          onPointerUp={handleCtrlPointerUp}
          onPointerCancel={() => {
            clearTouchLikeGesture();
            cancelCtrlGesture();
          }}
          onPointerLeave={() => {
            clearTouchLikeGesture();
            cancelCtrlGesture();
          }}
          onClick={handleCtrlClick}
          onKeyDown={handleCtrlKeyDown}
        >
          Ctrl
        </button>

        <button
          type="button"
          className="mobile-terminal-input-bar__key mobile-terminal-input-bar__shift"
          data-shift-armed={shiftArmed ? "true" : "false"}
          aria-pressed={shiftArmed}
          aria-label={shiftLabel}
          disabled={commandKeysDisabled}
          onPointerDown={(event) => {
            preserveExistingInputFocus(event);
            startTouchLikeGesture(event, "shift");
          }}
          onPointerUp={(event) => {
            handleTouchLikePointerUp(event, "shift", onShiftTap);
          }}
          onPointerCancel={clearTouchLikeGesture}
          onClick={handleShiftClick}
        >
          Shift
        </button>

        {SOFT_KEY_LAYOUT.map((key) => (
          <button
            key={key.id}
            type="button"
            className="mobile-terminal-input-bar__key"
            aria-label={getKeyAriaLabel(key.id, labels)}
            disabled={commandKeysDisabled}
            onPointerDown={(event) => {
              preserveExistingInputFocus(event);
              startTouchLikeGesture(event, key.id);
            }}
            onPointerUp={(event) => {
              handleTouchLikePointerUp(event, key.id, () => onKeyPress(key.id));
            }}
            onPointerCancel={clearTouchLikeGesture}
            onClick={() => handleSoftKeyClick(key.id)}
          >
            {key.text}
          </button>
        ))}
      </div>
    </div>
  );
}
