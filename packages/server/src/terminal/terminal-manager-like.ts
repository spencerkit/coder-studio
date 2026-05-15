import type { Terminal } from "@coder-studio/core";
import type { ActiveTerminal } from "./active-terminal.js";
import type { RenderOptions } from "./snapshot-render.js";
import type {
  ReplayResult,
  TerminalId,
  TerminalRecoveryMetadata,
  TerminalShutdownMode,
  TerminalSpec,
} from "./types.js";

type SnapshotResult =
  | { status: "ok"; data: Buffer; seq: number; cols: number; rows: number }
  | { status: "unsupported" };

export interface TerminalManagerLike {
  connect?(): Promise<void>;
  hydrateOwned?(): Promise<void>;
  claimPreserved?(requestId: string): Promise<void>;
  create(spec: TerminalSpec): Terminal | Promise<Terminal>;
  write(terminalId: TerminalId, bytes: Buffer): void;
  resize(terminalId: TerminalId, cols: number, rows: number): void;
  close(terminalId: TerminalId, signal?: NodeJS.Signals): Promise<void>;
  closeForWorkspace(workspaceId: string, signal?: NodeJS.Signals): Promise<void>;
  get(terminalId: TerminalId): ActiveTerminal | undefined;
  replay(terminalId: TerminalId, lastSeq: number): ReplayResult | Promise<ReplayResult>;
  snapshot(terminalId: TerminalId): Promise<SnapshotResult>;
  getRenderedSnapshot(terminalId: TerminalId, options: RenderOptions): Promise<string>;
  getRingBufferTail(terminalId: TerminalId, bytes: number): Buffer;
  getRecoveryMetadata?(terminalId: TerminalId): Promise<TerminalRecoveryMetadata | null>;
  getAll(): ActiveTerminal[];
  shutdown(mode?: TerminalShutdownMode): void | Promise<void>;
}
