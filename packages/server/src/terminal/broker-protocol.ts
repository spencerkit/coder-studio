import type { RuntimeTerminalRecord, TerminalRecoveryMetadata, TerminalSpec } from "./types.js";

export type BrokerReplayResult =
  | { status: "ok"; dataBase64: string; seq: number }
  | { status: "too_old" }
  | { status: "unknown" };

export type BrokerSnapshotResult =
  | { status: "ok"; dataBase64: string; seq: number; cols: number; rows: number }
  | { status: "unsupported" };

export type BrokerEvent =
  | {
      type: "output";
      ownerServerInstanceId: string;
      terminalId: string;
      workspaceId: string;
      seq: number;
      chunkBase64: string;
      lastOutputAt: number | null;
    }
  | {
      type: "exit";
      ownerServerInstanceId: string;
      terminalId: string;
      workspaceId: string;
      exitCode: number;
    };

export type BrokerRequest =
  | {
      id: string;
      op: "create";
      terminalId: string;
      spec: TerminalSpec;
      ownerServerInstanceId: string;
    }
  | {
      id: string;
      op: "detach_for_restart";
      ownerServerInstanceId: string;
      requestId: string;
      ttlMs: number;
    }
  | { id: string; op: "claim_preserved"; requestId: string; ownerServerInstanceId: string }
  | { id: string; op: "hydrate_attached"; ownerServerInstanceId: string }
  | { id: string; op: "subscribe_output"; ownerServerInstanceId: string }
  | { id: string; op: "unsubscribe_output"; ownerServerInstanceId: string }
  | { id: string; op: "close_all_for_owner"; ownerServerInstanceId: string }
  | { id: string; op: "write"; terminalId: string; bytesBase64: string }
  | { id: string; op: "resize"; terminalId: string; cols: number; rows: number }
  | { id: string; op: "close"; terminalId: string }
  | { id: string; op: "replay"; terminalId: string; lastSeq: number }
  | { id: string; op: "snapshot"; terminalId: string }
  | { id: string; op: "recovery"; terminalId: string }
  | { id: string; op: "status" }
  | { id: string; op: "ping" };

export type BrokerResponse =
  | {
      id: string;
      ok: true;
      broker?: {
        pid: number;
        startedAt: number;
      };
      terminal?: RuntimeTerminalRecord;
      terminals?: RuntimeTerminalRecord[];
      replay?: BrokerReplayResult;
      snapshot?: BrokerSnapshotResult;
      recovery?: TerminalRecoveryMetadata | null;
    }
  | { id: string; ok: false; code: string; message: string };
