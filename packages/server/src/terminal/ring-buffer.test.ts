// Unit tests for RingBuffer

import { describe, it, expect } from 'vitest'
import { RingBuffer } from './ring-buffer'

describe('RingBuffer', () => {
  it('should append data and return sequence number', () => {
    const buffer = new RingBuffer(1024)
    const chunk = Buffer.from('hello world')

    const result = buffer.append(chunk)

    expect(result.seq).toBe(chunk.length)
    expect(buffer.getSeq()).toBe(chunk.length)
  })

  it('should replay data from sequence number', () => {
    const buffer = new RingBuffer(1024)
    const chunk1 = Buffer.from('first')
    const chunk2 = Buffer.from('second')

    buffer.append(chunk1)
    const seqAfterChunk1 = buffer.getSeq()
    buffer.append(chunk2)

    const result = buffer.replayFrom(seqAfterChunk1)

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.data.toString()).toBe('second')
      expect(result.seq).toBe(chunk1.length + chunk2.length)
    }
  })

  it('should return empty buffer when replaying from current seq', () => {
    const buffer = new RingBuffer(1024)
    const chunk = Buffer.from('test')

    buffer.append(chunk)
    const seq = buffer.getSeq()

    const result = buffer.replayFrom(seq)

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.data.length).toBe(0)
      expect(result.seq).toBe(seq)
    }
  })

  it('should handle circular overwrite', () => {
    const buffer = new RingBuffer(10)
    const chunk1 = Buffer.from('12345') // 5 bytes
    const chunk2 = Buffer.from('67890') // 5 bytes
    const chunk3 = Buffer.from('abcde') // 5 bytes - should overwrite first 5 bytes

    buffer.append(chunk1)
    buffer.append(chunk2)
    const seqBeforeOverwrite = buffer.getSeq()
    buffer.append(chunk3)

    // Try to replay from before overwrite - should be too_old
    const result = buffer.replayFrom(0)

    expect(result.status).toBe('too_old')
  })

  it('should replay data that was not overwritten', () => {
    const buffer = new RingBuffer(10)
    const chunk1 = Buffer.from('12345')
    const chunk2 = Buffer.from('67890')
    const chunk3 = Buffer.from('abcde')

    buffer.append(chunk1)
    const seqAfterChunk1 = buffer.getSeq()
    buffer.append(chunk2)
    buffer.append(chunk3)

    // Replay from after chunk1 - should get chunk2 + chunk3
    const result = buffer.replayFrom(seqAfterChunk1)

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.data.toString()).toBe('67890abcde')
    }
  })

  it('should return snapshot of current buffer', () => {
    const buffer = new RingBuffer(100)
    const chunk = Buffer.from('hello world')

    buffer.append(chunk)

    const snapshot = buffer.snapshot()

    expect(snapshot.toString()).toBe('hello world')
  })

  it('should handle multiple small writes', () => {
    const buffer = new RingBuffer(1024)

    for (let i = 0; i < 10; i++) {
      buffer.append(Buffer.from(`chunk${i}`))
    }

    const totalBytes = 10 * 6 // 'chunk0' to 'chunk9' = 6 chars each
    expect(buffer.getSeq()).toBe(totalBytes)

    const snapshot = buffer.snapshot()
    expect(snapshot.toString()).toBe('chunk0chunk1chunk2chunk3chunk4chunk5chunk6chunk7chunk8chunk9')
  })

  it('should handle empty chunks', () => {
    const buffer = new RingBuffer(1024)

    const result = buffer.append(Buffer.alloc(0))

    expect(result.seq).toBe(0)
    expect(buffer.getSeq()).toBe(0)
  })

  it('should handle chunks larger than buffer size', () => {
    const buffer = new RingBuffer(5)
    const largeChunk = Buffer.from('1234567890') // 10 bytes

    buffer.append(largeChunk)

    // Only last 5 bytes should be in buffer
    const snapshot = buffer.snapshot()
    expect(snapshot.length).toBe(5)
    expect(snapshot.toString()).toBe('67890')
  })

  it('should handle partial circular writes', () => {
    const buffer = new RingBuffer(8)
    const chunk1 = Buffer.from('1234')
    const chunk2 = Buffer.from('56789') // 5 bytes - wraps around

    buffer.append(chunk1)
    buffer.append(chunk2)

    expect(buffer.getSeq()).toBe(9)

    // Replay should handle wraparound correctly
    const result = buffer.replayFrom(4) // From after chunk1
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.data.toString()).toBe('56789')
    }
  })
})