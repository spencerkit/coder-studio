import { forwardRef } from "react";
import type { TerminalCompatibilityMode } from "../../types/app";
import { XtermBase, type XtermBaseHandle } from "./XtermBase";

export type ShellTerminalProps = {
  terminalId: string;
  output: string;
  outputIdentity?: string;
  outputSyncStrategy?: "snapshot" | "incremental" | "replace";
  sanitizeOutput?: (value: string) => string;
  theme: "dark";
  fontSize: number;
  compatibilityMode?: TerminalCompatibilityMode;
  mode?: "interactive" | "readonly";
  autoFocus?: boolean;
  onData?: (value: string) => void;
  onSize?: (size: { cols: number; rows: number }) => void;
};

export const ShellTerminal = forwardRef<XtermBaseHandle, ShellTerminalProps>(({
  terminalId,
  output,
  outputIdentity,
  outputSyncStrategy,
  sanitizeOutput,
  theme,
  fontSize,
  compatibilityMode = "standard",
  mode = "interactive",
  autoFocus = false,
  onData,
  onSize
}, ref) => (
  <XtermBase
    ref={ref}
    outputIdentity={outputIdentity ?? terminalId}
    outputSyncStrategy={outputSyncStrategy}
    output={output}
    sanitizeOutput={sanitizeOutput}
    theme={theme}
    fontSize={fontSize}
    compatibilityMode={compatibilityMode}
    mode={mode}
    onData={onData}
    onSize={onSize}
    autoFocus={autoFocus}
    className="agent-pane-xterm"
  />
));

ShellTerminal.displayName = "ShellTerminal";
