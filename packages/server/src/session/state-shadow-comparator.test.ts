import { describe, expect, it, vi } from 'vitest'
import { createShadowComparator } from './state-shadow-comparator.js'

describe('state shadow comparator', () => {
  it('logs divergence when hook says running but pty says idle', () => {
    const log = vi.fn()
    const comparator = createShadowComparator(log)

    comparator.observeHookState('running')
    comparator.observePtyState('idle')

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: 'session.state.shadow.diverge',
        hookState: 'running',
        ptyState: 'idle',
      })
    )
  })

  it('does not log when hook and pty agree', () => {
    const log = vi.fn()
    const comparator = createShadowComparator(log)

    comparator.observeHookState('idle')
    comparator.observePtyState('idle')

    expect(log).not.toHaveBeenCalled()
  })

  it('stores the last divergence timestamp in the snapshot', () => {
    const log = vi.fn()
    const comparator = createShadowComparator(log)

    comparator.observeHookState('running')
    comparator.observePtyState('idle')

    expect(comparator.snapshot()).toEqual({
      hookState: 'running',
      ptyState: 'idle',
      lastDivergedAt: expect.any(Number),
    })
  })
})
