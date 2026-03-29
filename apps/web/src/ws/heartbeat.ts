import type { WsPingEnvelope } from "./protocol.ts";

const PING_INTERVAL_MS = 15000;
const PONG_TIMEOUT_MS = 10000;

type WsHeartbeatOptions = {
  send: (message: WsPingEnvelope) => void;
  onTimeout: () => void;
};

export class WsHeartbeat {
  private pingTimer: number | null = null;
  private pongTimer: number | null = null;
  private readonly options: WsHeartbeatOptions;

  constructor(options: WsHeartbeatOptions) {
    this.options = options;
  }

  start() {
    this.stop();
    this.scheduleNextPing();
  }

  stop() {
    if (this.pingTimer !== null) {
      window.clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimer !== null) {
      window.clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  markAlive() {
    if (this.pongTimer !== null) {
      window.clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private scheduleNextPing() {
    this.pingTimer = window.setTimeout(() => {
      this.options.send({ type: "ping", ts: Date.now() });
      this.pongTimer = window.setTimeout(() => {
        this.options.onTimeout();
      }, PONG_TIMEOUT_MS);
      this.scheduleNextPing();
    }, PING_INTERVAL_MS);
  }
}
