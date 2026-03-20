import { forwardRef } from "react";
import { XtermBase, type XtermBaseHandle } from "./XtermBase";

export type AgentStreamTerminalProps = {
  streamId: string;
  stream: string;
  toneKey: string;
  theme: "dark";
  fontSize: number;
  mode?: "interactive" | "readonly";
  autoFocus?: boolean;
  onData?: (value: string) => void;
  onSize?: (size: { cols: number; rows: number }) => void;
};

export const AgentStreamTerminal = forwardRef<XtermBaseHandle, AgentStreamTerminalProps>(({
  streamId,
  stream,
  toneKey,
  theme,
  fontSize,
  mode = "readonly",
  autoFocus = false,
  onData,
  onSize
}, ref) => (
  <XtermBase
    ref={ref}
    outputIdentity={streamId}
    themeIdentity={toneKey}
    output={stream}
    theme={theme}
    fontSize={fontSize}
    mode={mode}
    onData={onData}
    onSize={onSize}
    autoFocus={autoFocus}
    className="agent-pane-xterm"
  />
));

AgentStreamTerminal.displayName = "AgentStreamTerminal";
