// DomainEvent type union for EventBus (spec §4.0)

import type { LspDiagnosticsEvent } from "./lsp";
import type { SessionState, TaskDefinition, TaskRun, TerminalKind, Workspace } from "./types";

export type DomainEvent =
  | {
      type: "session.state.changed";
      sessionId: string;
      workspaceId?: string;
      from: SessionState;
      to: SessionState;
      session?: import("./types").Session;
    }
  | {
      type: "session.lifecycle";
      sessionId: string;
      workspaceId?: string;
      event: "started" | "turn_completed" | "stopped" | "removed";
    }
  | { type: "workspace.meta.changed"; workspaceId: string; patch: Partial<Workspace> }
  | {
      type: "git.state.changed";
      workspaceId: string;
      treeChanged?: boolean;
      branchChanged?: boolean;
      worktreeChanged?: boolean;
    }
  | { type: "fs.dirty"; workspaceId: string; reason: string }
  | {
      type: "terminal.created";
      workspaceId: string;
      terminalId: string;
      kind: TerminalKind;
      title: string;
      cwd: string;
    }
  | { type: "terminal.output"; workspaceId: string; terminalId: string; chunk: Buffer; seq: number }
  | {
      type: "terminal.continuity_lost";
      workspaceId: string;
      terminalId: string;
      clientId: string;
      reason: "stream_drop" | "topic_evicted";
    }
  | { type: "terminal.exited"; workspaceId: string; terminalId: string; exitCode: number }
  | { type: "task.discovered"; workspaceId: string; tasks: TaskDefinition[] }
  | { type: "task.run.started"; workspaceId: string; run: TaskRun }
  | { type: "task.run.updated"; workspaceId: string; run: TaskRun }
  | { type: "task.run.finished"; workspaceId: string; run: TaskRun }
  | { type: "task.run.stopped"; workspaceId: string; run: TaskRun }
  | ({ type: "lsp.diagnostics.updated" } & LspDiagnosticsEvent);
