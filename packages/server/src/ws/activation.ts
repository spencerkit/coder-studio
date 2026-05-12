import type { FastifyRequest } from "fastify";

export interface ActivationLease {
  clientInstanceId: string;
  wsClientId: string;
  generation: number;
  issuedAt: number;
  graceUntil: number | null;
  ip: string;
  userAgent: string;
}

export interface ActivationClaimResult {
  active: true;
  generation: number;
  recoveryMode: "fresh" | "grace_recover" | "takeover";
  displacedWsClientId: string | null;
}

export interface ActivationManagerOptions {
  graceMs: number;
}

const DEFAULT_OPTIONS: ActivationManagerOptions = {
  graceMs: 3_000,
};

export class ActivationManager {
  private readonly options: ActivationManagerOptions;
  private lease: ActivationLease | null = null;
  private generation = 0;

  constructor(options?: Partial<ActivationManagerOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  claim(
    clientInstanceId: string,
    wsClientId: string,
    request: FastifyRequest
  ): ActivationClaimResult {
    const now = Date.now();
    const activeLease = this.getLease();

    if (activeLease && activeLease.clientInstanceId === clientInstanceId) {
      const isGraceRecovery = activeLease.graceUntil !== null && now <= activeLease.graceUntil;
      const displacedWsClientId =
        isGraceRecovery || activeLease.wsClientId === wsClientId ? null : activeLease.wsClientId;

      activeLease.wsClientId = wsClientId;
      activeLease.graceUntil = null;

      return {
        active: true,
        generation: activeLease.generation,
        recoveryMode: "grace_recover",
        displacedWsClientId,
      };
    }

    const displacedWsClientId =
      activeLease && activeLease.clientInstanceId !== clientInstanceId
        ? activeLease.wsClientId
        : null;
    const recoveryMode = displacedWsClientId === null ? "fresh" : "takeover";

    this.generation += 1;
    this.lease = {
      clientInstanceId,
      wsClientId,
      generation: this.generation,
      issuedAt: now,
      graceUntil: null,
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? "",
    };

    return {
      active: true,
      generation: this.lease.generation,
      recoveryMode,
      displacedWsClientId,
    };
  }

  release(clientInstanceId: string, generation: number): void {
    const lease = this.getLease();
    if (!lease) {
      return;
    }

    if (lease.clientInstanceId !== clientInstanceId || lease.generation !== generation) {
      return;
    }

    this.lease = null;
  }

  onSocketClosed(wsClientId: string): void {
    const lease = this.getLease();
    if (!lease || lease.wsClientId !== wsClientId) {
      return;
    }

    lease.graceUntil = Date.now() + this.options.graceMs;
  }

  getLease(): ActivationLease | null {
    if (!this.lease) {
      return null;
    }

    return this.lease;
  }
}
