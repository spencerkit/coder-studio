import { describe, expect, it } from 'vitest'
import { claudeIdleHeuristics } from './idle-heuristics.js'

describe('claude idle heuristics', () => {
  const matchesIdle = (text: string) =>
    claudeIdleHeuristics.idlePromptPatterns.some((pattern) => pattern.test(text))

  it('does not rely on prompt matching initially', () => {
    expect(matchesIdle('some output\n\n│ > │\n')).toBe(false)
  })

  it('does not match while spinner is animating', () => {
    expect(matchesIdle('⠋ Thinking...')).toBe(false)
  })

  it('uses a conservative debounce window', () => {
    expect(claudeIdleHeuristics.idlePromptPatterns).toEqual([])
    expect(claudeIdleHeuristics.idleDebounceMs).toBeGreaterThanOrEqual(2000)
    expect(claudeIdleHeuristics.idleDebounceMs).toBeLessThanOrEqual(8000)
  })
})
