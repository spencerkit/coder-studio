import type { DomainEvent, Terminal } from "@coder-studio/core";
import type { EventBus } from "../bus/event-bus.js";
import { ActiveTerminal } from "./active-terminal.js";
import { TerminalBrokerClient } from "./broker-client.js";
import { type RenderOptions, renderSnapshotToText } from "./snapshot-render.js";
import type {
  ReplayResult,
  TerminalDatabase,
  TerminalId,
  TerminalRecoveryMetadata,
  TerminalShutdownMode,
  TerminalSpec,
} from "./types.js";

type SnapshotResult =
  | { status: "ok"; data: Buffer; seq: number; cols: number; rows: number }
  | { status: "unsupported" };

function generateId(): string {
  return `term_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function emitTerminalCreated(eventBus: EventBus, terminal: Terminal): void {
  const event: DomainEvent = {
    type: "terminal.created",
    workspaceId: terminal.workspaceId,
    terminalId: terminal.id,
    kind: terminal.kind,
    title: terminal.title,
    cwd: terminal.cwd,
  } satisfies DomainEvent;
  eventBus.emit(event);
}

export class BrokerTerminalManager {
  private readonly terminals = new Map<TerminalId, ActiveTerminal>();
  private readonly recentOutput = new Map<TerminalId, Buffer>();
  private unsubscribeBrokerOutput: (() => Promise<void>) | null = null;

  constructor(
    private readonly deps: {
      broker: TerminalBrokerClient;
      eventBus: EventBus;
      db: TerminalDatabase;
      ownerServerInstanceId: string;
    }
  ) {}

  async connect(): Promise<void> {
    this.unsubscribeBrokerOutput = await this.deps.broker.subscribeOutput(
      this.deps.ownerServerInstanceId,
      (event) => {
        if (event.type === "output") {
          const terminal = this.terminals.get(event.terminalId);
          if (terminal) {
            terminal.alive = true;
            this.recentOutput.set(event.terminalId, Buffer.from(event.chunkBase64, "base64"));
          }

          this.deps.eventBus.emit({
            type: "terminal.output",
            workspaceId: event.workspaceId,
            terminalId: event.terminalId,
            seq: event.seq,
            chunk: Buffer.from(event.chunkBase64, "base64"),
          } satisfies DomainEvent);
          return;
        }

        const terminal = this.terminals.get(event.terminalId);
        if (terminal) {
          terminal.alive = false;
          terminal.exitCode = event.exitCode;
        }

        this.deps.eventBus.emit({
          type: "terminal.exited",
          workspaceId: event.workspaceId,
          terminalId: event.terminalId,
          exitCode: event.exitCode,
        } satisfies DomainEvent);
      }
    );
  }

  async create(spec: TerminalSpec): Promise<Terminal> {
    const id = generateId();
    const created = await this.deps.broker.create(id, spec, this.deps.ownerServerInstanceId);
    if (!created) {
      throw new Error(`Terminal broker did not return a created terminal for ${id}`);
    }

    const active = ActiveTerminal.fromRuntimeRecord(created);
    this.terminals.set(active.id, active);
    this.deps.db.insert(active.toRow());
    emitTerminalCreated(this.deps.eventBus, active.toDTO());
    return active.toDTO();
  }

  async hydrateOwned(): Promise<void> {
    const terminals = await this.deps.broker.hydrateAttached(this.deps.ownerServerInstanceId);
    for (const terminal of terminals) {
      this.terminals.set(terminal.id, ActiveTerminal.fromRuntimeRecord(terminal));
    }
  }

  async claimPreserved(requestId: string): Promise<void> {
    const terminals = await this.deps.broker.claimPreserved(
      requestId,
      this.deps.ownerServerInstanceId
    );

    for (const terminal of terminals) {
      this.terminals.set(terminal.id, ActiveTerminal.fromRuntimeRecord(terminal));
    }
  }

  write(terminalId: TerminalId, bytes: Buffer): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || !terminal.alive) {
      throw new Error("Terminal is not alive");
    }

    void this.deps.broker.write(terminalId, bytes.toString("base64"));
  }

  resize(terminalId: TerminalId, cols: number, rows: number): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || !terminal.alive) {
      return;
    }

    terminal.currentCols = cols;
    terminal.currentRows = rows;
    void this.deps.broker.resize(terminalId, cols, rows);
  }

  async close(terminalId: TerminalId): Promise<void> {
    await this.deps.broker.close(terminalId);
    this.terminals.delete(terminalId);
    this.recentOutput.delete(terminalId);
  }

  async closeForWorkspace(workspaceId: string): Promise<void> {
    const closes = this.getAll()
      .filter((terminal) => terminal.spec.workspaceId === workspaceId)
      .map((terminal) => this.close(terminal.id));
    await Promise.all(closes);
  }

  get(terminalId: TerminalId): ActiveTerminal | undefined {
    return this.terminals.get(terminalId);
  }

  async replay(terminalId: TerminalId, lastSeq: number): Promise<ReplayResult> {
    const replay = await this.deps.broker.replay(terminalId, lastSeq);
    if (replay.status !== "ok") {
      return replay;
    }

    return {
      status: "ok",
      seq: replay.seq,
      data: Buffer.from(replay.dataBase64, "base64"),
    };
  }

  async snapshot(terminalId: TerminalId): Promise<SnapshotResult> {
    const snapshot = await this.deps.broker.snapshot(terminalId);
    if (snapshot.status !== "ok") {
      return snapshot;
    }

    return {
      status: "ok",
      seq: snapshot.seq,
      cols: snapshot.cols,
      rows: snapshot.rows,
      data: Buffer.from(snapshot.dataBase64, "base64"),
    };
  }

  async getRenderedSnapshot(terminalId: TerminalId, options: RenderOptions): Promise<string> {
    const snapshot = await this.snapshot(terminalId);
    if (snapshot.status !== "ok") {
      return "";
    }

    return renderSnapshotToText(snapshot.data, options);
  }

  getRingBufferTail(terminalId: TerminalId, bytes: number): Buffer {
    const buffer = this.recentOutput.get(terminalId);
    if (!buffer) {
      return Buffer.alloc(0);
    }

    return buffer.subarray(Math.max(0, buffer.length - bytes));
  }

  async getRecoveryMetadata(terminalId: TerminalId): Promise<TerminalRecoveryMetadata | null> {
    return await this.deps.broker.recovery(terminalId);
  }

  getAll(): ActiveTerminal[] {
    return Array.from(this.terminals.values());
  }

  async shutdown(mode: TerminalShutdownMode = { mode: "terminate" }): Promise<void> {
    if (mode.mode === "restart-preserve") {
      await this.deps.broker.detachForRestart(
        this.deps.ownerServerInstanceId,
        mode.requestId,
        mode.ttlMs
      );
    } else {
      await this.deps.broker.closeAllForOwner(this.deps.ownerServerInstanceId);
    }

    await this.unsubscribeBrokerOutput?.();
    this.unsubscribeBrokerOutput = null;
    this.terminals.clear();
    this.recentOutput.clear();
  }
}
