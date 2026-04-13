import type { PointerEventHandler, RefObject } from "react";
import type { Translator } from "../../i18n";
import type { TerminalCompatibilityMode } from "../../types/app";
import { ShellTerminal, type XtermBaseHandle } from "../../components/terminal";
import { WorkspaceTerminalPanel } from "../../components/workspace";

type TerminalOption = {
  id: string;
  title: string;
};

type ActiveTerminal = {
  id: string;
  output?: string;
};

type WorkspaceTerminalFeatureProps = {
  visible: boolean;
  progressPercent: number;
  progressTone: "live" | "steady" | "idle";
  activeTerminal?: ActiveTerminal;
  mode: "interactive" | "readonly";
  terminals: TerminalOption[];
  terminalViewportRef: RefObject<HTMLDivElement | null>;
  shellTerminalRef: RefObject<XtermBaseHandle | null>;
  theme: "dark";
  fontSize: number;
  compatibilityMode: TerminalCompatibilityMode;
  autoFocus: boolean;
  onTerminalData: (value: string) => void;
  onTerminalSize: (size: { cols: number; rows: number }) => void;
  onResizeStart: PointerEventHandler<HTMLDivElement>;
  onSelect: (terminalId: string) => void;
  onCloseActive: () => void;
  onAdd: () => void;
  t: Translator;
};

export const WorkspaceTerminalFeature = ({
  visible,
  progressPercent,
  progressTone,
  activeTerminal,
  mode,
  terminals,
  terminalViewportRef,
  shellTerminalRef,
  theme,
  fontSize,
  compatibilityMode,
  autoFocus,
  onTerminalData,
  onTerminalSize,
  onResizeStart,
  onSelect,
  onCloseActive,
  onAdd,
  t,
}: WorkspaceTerminalFeatureProps) => {
  if (!visible) return null;

  return (
    <WorkspaceTerminalPanel
      progressPercent={progressPercent}
      progressTone={progressTone}
      activeTerminalId={activeTerminal?.id}
      terminals={terminals}
      terminalViewportRef={terminalViewportRef}
      terminalContent={activeTerminal ? (
        <ShellTerminal
          ref={shellTerminalRef}
          terminalId={activeTerminal.id}
          output={activeTerminal.output ?? ""}
          theme={theme}
          fontSize={fontSize}
          compatibilityMode={compatibilityMode}
          mode={mode}
          onData={onTerminalData}
          onSize={onTerminalSize}
          autoFocus={autoFocus}
        />
      ) : (
        <div className="terminal-empty">{t("noTerminalYet")}</div>
      )}
      onResizeStart={onResizeStart}
      onSelect={onSelect}
      onClose={onCloseActive}
      onAdd={onAdd}
      hasActiveTerminal={Boolean(activeTerminal)}
      t={t}
    />
  );
};
