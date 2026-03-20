import { forwardRef } from "react";
import { XtermBase, type XtermBaseHandle } from "./XtermBase";

export type ShellTerminalProps = {
  terminalId: string;
  output: string;
  theme: "dark";
  fontSize: number;
  autoFocus?: boolean;
  onData?: (value: string) => void;
  onSize?: (size: { cols: number; rows: number }) => void;
};

export const ShellTerminal = forwardRef<XtermBaseHandle, ShellTerminalProps>(({
  terminalId,
  output,
  theme,
  fontSize,
  autoFocus = false,
  onData,
  onSize
}, ref) => (
  <XtermBase
    ref={ref}
    outputIdentity={terminalId}
    output={output}
    theme={theme}
    fontSize={fontSize}
    mode="interactive"
    onData={onData}
    onSize={onSize}
    autoFocus={autoFocus}
    className="agent-pane-xterm"
  />
));

ShellTerminal.displayName = "ShellTerminal";
