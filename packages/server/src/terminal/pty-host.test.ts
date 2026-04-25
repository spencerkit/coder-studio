/**
 * Tests for kill escalation helper
 *
 * Tests the polling-based SIGTERM -> SIGKILL escalation logic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { escalateKillWithPolling, killProcessGroup } from './pty-host'

describe('kill escalation', () => {
  let mockProcessKill: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockProcessKill = vi.spyOn(process, 'kill')
  })

  afterEach(() => {
    vi.useRealTimers()
    mockProcessKill.mockRestore()
  })

  describe('killProcessGroup', () => {
    it('should send signal to process group with negative PID', () => {
      mockProcessKill.mockReturnValue(true)

      const result = killProcessGroup(123, 'SIGTERM')

      expect(result).toBe(true)
      expect(mockProcessKill).toHaveBeenCalledWith(-123, 'SIGTERM')
    })

    it('should fallback to regular kill if process group kill fails', () => {
      mockProcessKill.mockImplementationOnce(() => {
        throw new Error('Process group does not exist')
      })
      mockProcessKill.mockReturnValueOnce(true)

      const result = killProcessGroup(123, 'SIGTERM')

      expect(result).toBe(true)
      expect(mockProcessKill).toHaveBeenCalledTimes(2)
      expect(mockProcessKill).toHaveBeenNthCalledWith(1, -123, 'SIGTERM')
      expect(mockProcessKill).toHaveBeenNthCalledWith(2, 123, 'SIGTERM')
    })

    it('should return false if both process group and regular kill fail', () => {
      mockProcessKill.mockImplementation(() => {
        throw new Error('Process does not exist')
      })

      const result = killProcessGroup(123, 'SIGTERM')

      expect(result).toBe(false)
      expect(mockProcessKill).toHaveBeenCalledTimes(2)
    })
  })

  describe('escalateKillWithPolling', () => {
    it('should immediately return if SIGTERM fails', async () => {
      mockProcessKill.mockImplementation(() => {
        throw new Error('Process does not exist')
      })

      const result = await escalateKillWithPolling(123, 'SIGTERM')

      expect(result).toBe(false)
      expect(mockProcessKill).toHaveBeenCalledTimes(2)
      expect(mockProcessKill.mock.calls).toEqual([
        [-123, 'SIGTERM'],
        [123, 'SIGTERM'],
      ])
    })

    it('should stop if both process group and pid are already gone on immediate check', async () => {
      mockProcessKill
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error('Process group has exited')
        })
        .mockImplementationOnce(() => {
          throw new Error('Process has exited')
        })

      const result = await escalateKillWithPolling(123, 'SIGTERM', {
        pollIntervalMs: 50,
        timeoutMs: 2000,
      })

      expect(result).toBe(true)
      expect(mockProcessKill.mock.calls).toEqual([
        [-123, 'SIGTERM'],
        [-123, 0],
        [123, 0],
      ])
      expect(mockProcessKill).not.toHaveBeenCalledWith(-123, 'SIGKILL')
      expect(mockProcessKill).not.toHaveBeenCalledWith(123, 'SIGKILL')
    })

    it('should continue polling when process group is gone but pid is still alive', async () => {
      vi.useFakeTimers()

      mockProcessKill
        .mockImplementationOnce(() => {
          throw new Error('Process group does not exist')
        })
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error('Process group does not exist')
        })
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error('Process group does not exist')
        })
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error('Process group does not exist')
        })
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error('Process group does not exist')
        })
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error('Process group does not exist')
        })
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error('Process group does not exist')
        })
        .mockReturnValueOnce(true)

      const resultPromise = escalateKillWithPolling(123, 'SIGTERM', {
        pollIntervalMs: 50,
        timeoutMs: 100,
      })

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result).toBe(true)
      expect(mockProcessKill.mock.calls).toEqual([
        [-123, 'SIGTERM'],
        [123, 'SIGTERM'],
        [-123, 0],
        [123, 0],
        [-123, 0],
        [123, 0],
        [-123, 0],
        [123, 0],
        [-123, 'SIGKILL'],
        [123, 'SIGKILL'],
      ])
    })

    it('should send SIGKILL if process survives timeout', async () => {
      vi.useFakeTimers()
      mockProcessKill.mockReturnValue(true)

      const resultPromise = escalateKillWithPolling(123, 'SIGTERM', {
        pollIntervalMs: 50,
        timeoutMs: 250,
      })

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result).toBe(true)
      expect(mockProcessKill).toHaveBeenCalledWith(-123, 'SIGKILL')
    })

    it('should not escalate for non-SIGTERM signals', async () => {
      mockProcessKill.mockReturnValue(true)

      const result = await escalateKillWithPolling(123, 'SIGKILL')

      expect(result).toBe(true)
      expect(mockProcessKill).toHaveBeenCalledTimes(1)
      expect(mockProcessKill).toHaveBeenCalledWith(-123, 'SIGKILL')
    })

    it('should use default polling parameters if not specified', async () => {
      mockProcessKill
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error('Process group exited')
        })
        .mockImplementationOnce(() => {
          throw new Error('Process exited')
        })

      const result = await escalateKillWithPolling(123, 'SIGTERM')

      expect(result).toBe(true)
      expect(mockProcessKill).toHaveBeenCalledWith(-123, 0)
      expect(mockProcessKill).toHaveBeenCalledWith(123, 0)
    })

    it('should stop polling when process exits after one interval', async () => {
      vi.useFakeTimers()

      mockProcessKill
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error('Process group exited')
        })
        .mockImplementationOnce(() => {
          throw new Error('Process exited')
        })

      const resultPromise = escalateKillWithPolling(123, 'SIGTERM', {
        pollIntervalMs: 50,
        timeoutMs: 2000,
      })

      await vi.advanceTimersByTimeAsync(50)
      const result = await resultPromise

      expect(result).toBe(true)
      expect(mockProcessKill.mock.calls).toEqual([
        [-123, 'SIGTERM'],
        [-123, 0],
        [-123, 0],
        [123, 0],
      ])
      expect(mockProcessKill).not.toHaveBeenCalledWith(-123, 'SIGKILL')
      expect(mockProcessKill).not.toHaveBeenCalledWith(123, 'SIGKILL')
    })
  })
})