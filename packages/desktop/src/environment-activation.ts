export interface EnvironmentActivationOptions {
  focusWindow: () => boolean;
  markReady: (requestId: string) => Promise<void>;
  markFailed: (requestId: string, message: string) => Promise<void>;
}

export class EnvironmentActivationCoordinator {
  private readonly pendingRequestIds = new Set<string>();
  private focusRequested = false;
  private windowReady = false;
  private flushPromise: Promise<void> | null = null;

  constructor(private readonly options: EnvironmentActivationOptions) {}

  request(requestId?: string): Promise<void> {
    this.focusRequested = true;
    if (requestId) this.pendingRequestIds.add(requestId);
    return this.scheduleFlush();
  }

  markWindowReady(): Promise<void> {
    this.windowReady = true;
    this.focusRequested = true;
    return this.scheduleFlush();
  }

  markWindowUnavailable(): void {
    this.windowReady = false;
  }

  async failPending(message: string): Promise<void> {
    const requestIds = [...this.pendingRequestIds];
    this.pendingRequestIds.clear();
    this.focusRequested = false;
    await Promise.all(requestIds.map((requestId) => this.options.markFailed(requestId, message)));
  }

  private scheduleFlush(): Promise<void> {
    if (!this.windowReady || !this.focusRequested) return Promise.resolve();
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.flush().finally(() => {
      this.flushPromise = null;
      if (this.windowReady && this.focusRequested) void this.scheduleFlush();
    });
    return this.flushPromise;
  }

  private async flush(): Promise<void> {
    while (this.windowReady && this.focusRequested) {
      if (!this.options.focusWindow()) {
        this.windowReady = false;
        return;
      }
      this.focusRequested = false;
      const requestIds = [...this.pendingRequestIds];
      requestIds.forEach((requestId) => this.pendingRequestIds.delete(requestId));
      await Promise.all(requestIds.map((requestId) => this.options.markReady(requestId)));
    }
  }
}
