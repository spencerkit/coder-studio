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
  private failurePromise: Promise<void> | null = null;
  private failureMessage: string | null = null;

  constructor(private readonly options: EnvironmentActivationOptions) {}

  request(requestId?: string): Promise<void> {
    const alreadyPending = requestId ? this.pendingRequestIds.has(requestId) : false;
    if (requestId && this.failureMessage !== null) {
      if (!alreadyPending) this.pendingRequestIds.add(requestId);
      if (alreadyPending && this.failurePromise) return this.failurePromise;
      return this.scheduleFailureDrain();
    }
    if (requestId && alreadyPending) {
      if (this.flushPromise) return this.flushPromise;
      if (this.focusRequested) return this.scheduleFlush();
    }
    this.focusRequested = true;
    if (requestId) this.pendingRequestIds.add(requestId);
    return this.scheduleFlush();
  }

  markWindowReady(): Promise<void> {
    this.failureMessage = null;
    this.windowReady = true;
    this.focusRequested = true;
    return this.scheduleFlush();
  }

  markWindowUnavailable(): void {
    this.windowReady = false;
  }

  failPending(message: string): Promise<void> {
    this.failureMessage = message;
    this.windowReady = false;
    this.focusRequested = false;
    return this.scheduleFailureDrain();
  }

  private scheduleFailureDrain(): Promise<void> {
    const message = this.failureMessage;
    if (message === null) return this.scheduleFlush();
    if (this.failurePromise) {
      return this.failurePromise.then(
        () => this.scheduleFailureDrain(),
        () => this.scheduleFailureDrain()
      );
    }
    if (this.pendingRequestIds.size === 0) return Promise.resolve();
    const failurePromise = Promise.resolve().then(() => this.failAfterFlush(message));
    this.failurePromise = failurePromise;
    return failurePromise.finally(() => {
      if (this.failurePromise === failurePromise) this.failurePromise = null;
    });
  }

  private scheduleFlush(): Promise<void> {
    if (this.failurePromise) {
      return this.failurePromise.then(
        () => this.scheduleFlush(),
        () => this.scheduleFlush()
      );
    }
    if (!this.windowReady || !this.focusRequested) return Promise.resolve();
    if (this.flushPromise) {
      return this.flushPromise.then(
        () => this.scheduleFlush(),
        () => this.scheduleFlush()
      );
    }
    const flushPromise = this.flush();
    this.flushPromise = flushPromise;
    return flushPromise.finally(() => {
      if (this.flushPromise === flushPromise) this.flushPromise = null;
    });
  }

  private async flush(): Promise<void> {
    while (this.windowReady && this.focusRequested) {
      if (!this.options.focusWindow()) {
        this.windowReady = false;
        return;
      }
      this.focusRequested = false;
      const requestIds = [...this.pendingRequestIds];
      await this.settleRequestIds(requestIds, (requestId) => this.options.markReady(requestId));
    }
  }

  private async failAfterFlush(message: string): Promise<void> {
    const flushPromise = this.flushPromise;
    if (flushPromise) await flushPromise.catch(() => undefined);
    const requestIds = [...this.pendingRequestIds];
    await this.settleRequestIds(requestIds, (requestId) =>
      this.options.markFailed(requestId, message)
    );
  }

  private async settleRequestIds(
    requestIds: string[],
    settle: (requestId: string) => Promise<void>
  ): Promise<void> {
    const results = await Promise.allSettled(requestIds.map((requestId) => settle(requestId)));
    let failure: PromiseRejectedResult | undefined;
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        this.pendingRequestIds.delete(requestIds[index]!);
      } else {
        failure ??= result;
      }
    });
    if (failure) throw failure.reason;
  }
}
