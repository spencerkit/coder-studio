export interface DesktopChildProcessGoneDetails {
  type: string;
  name?: string;
  serviceName?: string;
}

export function isDesktopNetworkService(details: DesktopChildProcessGoneDetails): boolean {
  if (details.type !== "Utility") return false;
  return (
    details.name === "Network Service" || details.serviceName === "network.mojom.NetworkService"
  );
}

export interface DesktopAuthRecoveryOptions {
  canRecover(): boolean;
  authenticate(): Promise<"already_authenticated" | "recovered">;
  onRecovered(): void;
  onAttemptFailure?(error: unknown, attempt: number, willRetry: boolean): void;
  retryDelaysMs?: readonly number[];
  wait?(delayMs: number): Promise<void>;
}

export interface DesktopAuthRecoveryRequest {
  notifyWhenAlreadyAuthenticated?: boolean;
}

const DEFAULT_RETRY_DELAYS_MS = [250, 1_000, 3_000] as const;

const waitForDelay = (delayMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export class DesktopAuthRecoveryCoordinator {
  private inFlight: Promise<boolean> | null = null;
  private notifyWhenAlreadyAuthenticated = false;

  constructor(private readonly options: DesktopAuthRecoveryOptions) {}

  recover(request: DesktopAuthRecoveryRequest = {}): Promise<boolean> {
    if (request.notifyWhenAlreadyAuthenticated) {
      this.notifyWhenAlreadyAuthenticated = true;
    }
    if (this.inFlight) return this.inFlight;
    if (!this.options.canRecover()) {
      this.notifyWhenAlreadyAuthenticated = false;
      return Promise.resolve(false);
    }

    const recovery = this.run().finally(() => {
      if (this.inFlight === recovery) {
        this.inFlight = null;
        this.notifyWhenAlreadyAuthenticated = false;
      }
    });
    this.inFlight = recovery;
    return recovery;
  }

  private async run(): Promise<boolean> {
    const retryDelays = this.options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    const wait = this.options.wait ?? waitForDelay;

    for (let attemptIndex = 0; attemptIndex <= retryDelays.length; attemptIndex += 1) {
      if (!this.options.canRecover()) return false;
      if (attemptIndex > 0) {
        await wait(retryDelays[attemptIndex - 1] as number);
        if (!this.options.canRecover()) return false;
      }

      try {
        const result = await this.options.authenticate();
        if (!this.options.canRecover()) return false;
        if (result === "recovered" || this.notifyWhenAlreadyAuthenticated) {
          this.options.onRecovered();
        }
        return true;
      } catch (error) {
        this.options.onAttemptFailure?.(error, attemptIndex + 1, attemptIndex < retryDelays.length);
      }
    }

    return false;
  }
}
