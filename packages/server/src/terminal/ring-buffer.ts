// Ring buffer implementation for terminal output (spec §4.5)

/**
 * Ring buffer for storing terminal output
 * Fixed 2 MiB size with circular overwrite
 */
export class RingBuffer {
  private buffer: Buffer
  private writePos = 0
  private totalBytes = 0

  constructor(private readonly size: number) {
    this.buffer = Buffer.alloc(size)
  }

  /**
   * Append a chunk of data to the ring buffer
   * Returns the sequence number (cumulative byte count)
   */
  append(chunk: Buffer): { seq: number } {
    if (chunk.length === 0) {
      return { seq: this.totalBytes }
    }

    // Write in circular fashion
    let remaining = chunk.length
    let offset = 0

    while (remaining > 0) {
      const availableSpace = this.size - this.writePos
      const writeLength = Math.min(remaining, availableSpace)

      chunk.copy(this.buffer, this.writePos, offset, offset + writeLength)

      this.writePos = (this.writePos + writeLength) % this.size
      offset += writeLength
      remaining -= writeLength
    }

    this.totalBytes += chunk.length

    return { seq: this.totalBytes }
  }

  /**
   * Replay data from a given sequence number
   * Returns the data and new sequence number, or 'too_old' if data was overwritten
   */
  replayFrom(lastSeq: number): { status: 'ok'; data: Buffer; seq: number } | { status: 'too_old' } {
    if (lastSeq >= this.totalBytes) {
      // No new data
      return { status: 'ok', data: Buffer.alloc(0), seq: this.totalBytes }
    }

    const bytesToRead = this.totalBytes - lastSeq

    // Check if requested data is still in buffer
    if (bytesToRead > this.size) {
      return { status: 'too_old' }
    }

    // Extract data from circular buffer
    const data = Buffer.alloc(bytesToRead)
    let readPos = this.writePos - bytesToRead
    if (readPos < 0) {
      readPos += this.size
    }

    let remaining = bytesToRead
    let offset = 0

    while (remaining > 0) {
      const availableBytes = this.size - readPos
      const readLength = Math.min(remaining, availableBytes)

      this.buffer.copy(data, offset, readPos, readPos + readLength)

      readPos = (readPos + readLength) % this.size
      offset += readLength
      remaining -= readLength
    }

    return { status: 'ok', data, seq: this.totalBytes }
  }

  /**
   * Get a snapshot of current valid bytes in the buffer
   */
  snapshot(): Buffer {
    const validBytes = Math.min(this.totalBytes, this.size)
    const startPos = this.totalBytes > this.size ? this.writePos : 0

    const snapshot = Buffer.alloc(validBytes)
    let readPos = startPos
    let remaining = validBytes
    let offset = 0

    while (remaining > 0) {
      const availableBytes = this.size - readPos
      const readLength = Math.min(remaining, availableBytes)

      this.buffer.copy(snapshot, offset, readPos, readPos + readLength)

      readPos = (readPos + readLength) % this.size
      offset += readLength
      remaining -= readLength
    }

    return snapshot
  }

  /**
   * Read the last N bytes currently retained in the buffer.
   */
  tail(bytes: number): Buffer {
    if (bytes <= 0) {
      return Buffer.alloc(0)
    }

    const snapshot = this.snapshot()
    if (snapshot.length <= bytes) {
      return snapshot
    }

    return snapshot.subarray(snapshot.length - bytes)
  }

  /**
   * Get current sequence number (total bytes written)
   */
  getSeq(): number {
    return this.totalBytes
  }
}