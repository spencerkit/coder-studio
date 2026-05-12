export interface ActivationLease {
  clientInstanceId: string;
  wsClientId: string;
  generation: number;
}

export interface ActivationClaimResult {
  active: true;
  generation: number;
  recoveryMode: "fresh" | "grace_recover" | "takeover";
}

export class ActivationManager {
  private lease: ActivationLease | null = null;
  private generation = 0;

  claim(clientInstanceId: string, wsClientId: string): ActivationClaimResult {
    const current = this.lease;

    if (current && current.clientInstanceId === clientInstanceId) {
      current.wsClientId = wsClientId;
      return {
        active: true,
        generation: current.generation,
        recoveryMode: "grace_recover",
      };
    }

    this.generation += 1;
    this.lease = {
      clientInstanceId,
      wsClientId,
      generation: this.generation,
    };

    return {
      active: true,
      generation: this.lease.generation,
      recoveryMode: current ? "takeover" : "fresh",
    };
  }

  heartbeat(clientInstanceId: string, generation: number): boolean {
    return (
      this.lease?.clientInstanceId === clientInstanceId && this.lease.generation === generation
    );
  }

  release(clientInstanceId: string, generation: number): void {
    if (this.lease?.clientInstanceId !== clientInstanceId || this.lease.generation !== generation) {
      return;
    }

    this.lease = null;
  }

  getLease(): ActivationLease | null {
    return this.lease;
  }
}
