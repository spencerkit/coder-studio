import type { IdleHeuristics } from '@coder-studio/core'

export type PtyDerivedState = 'running' | 'idle'

export interface PtyStateDetectorOptions {
  heuristics: IdleHeuristics
  onStateChange: (state: PtyDerivedState) => void
}

const RECENT_BUFFER_LIMIT = 4096

export class PtyStateDetector {
  private currentState: PtyDerivedState | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private recentBuffer = ''

  constructor(private readonly options: PtyStateDetectorOptions) {}

  feed(chunk: Buffer): void {
    this.transitionTo('running')
    this.recentBuffer = `${this.recentBuffer}${chunk.toString('utf8')}`.slice(-RECENT_BUFFER_LIMIT)

    if (this.matchesIdlePrompt()) {
      this.clearIdleTimer()
      this.transitionTo('idle')
      return
    }

    this.scheduleIdleDebounce()
  }

  dispose(): void {
    this.clearIdleTimer()
  }

  private transitionTo(state: PtyDerivedState): void {
    if (this.currentState === state) {
      return
    }

    this.currentState = state
    this.options.onStateChange(state)
  }

  private matchesIdlePrompt(): boolean {
    return this.options.heuristics.idlePromptPatterns.some((pattern) => pattern.test(this.recentBuffer))
  }

  private scheduleIdleDebounce(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.transitionTo('idle')
    }, this.options.heuristics.idleDebounceMs)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer === null) {
      return
    }

    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}
