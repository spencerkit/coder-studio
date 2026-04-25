export interface Frame {
  data: string;
  size: number;
}

export interface StreamBufferOptions {
  topicCap: number;
  topicLruCap: number;
}

export const STREAM_BUFFER_DEFAULTS: StreamBufferOptions = {
  topicCap: 256 * 1024,
  topicLruCap: 16,
};

export class StreamBuffer {
  private readonly buckets = new Map<string, Frame[]>();
  private readonly bucketBytes = new Map<string, number>();
  private cursor = 0;
  private destroyed = false;

  constructor(private readonly options: StreamBufferOptions = STREAM_BUFFER_DEFAULTS) {}

  enqueue(topic: string, frame: Frame): void {
    if (this.destroyed) return;

    let bucket = this.buckets.get(topic);
    if (!bucket) {
      // Note: LRU eviction implemented in Task 3
      bucket = [];
      this.buckets.set(topic, bucket);
      this.bucketBytes.set(topic, 0);
    } else {
      // Touch: re-insert to mark as recently written (Map preserves insertion order)
      this.buckets.delete(topic);
      this.bucketBytes.delete(topic);
      this.buckets.set(topic, bucket);
      this.bucketBytes.set(topic, this.bucketSize(bucket));
    }

    bucket.push(frame);
    let bytes = (this.bucketBytes.get(topic) ?? 0) + frame.size;

    while (bytes > this.options.topicCap && bucket.length > 1) {
      const dropped = bucket.shift()!;
      bytes -= dropped.size;
    }

    this.bucketBytes.set(topic, bytes);
  }

  drain(maxBytes: number, send: (data: string) => boolean): void {
    if (this.destroyed) return;
    let sent = 0;
    while (sent < maxBytes && this.buckets.size > 0) {
      const topics = [...this.buckets.keys()];
      let drainedThisRound = 0;
      for (let i = 0; i < topics.length && sent < maxBytes; i++) {
        const idx = (this.cursor + i) % topics.length;
        const topic = topics[idx]!;
        const bucket = this.buckets.get(topic);
        if (!bucket || bucket.length === 0) continue;
        const next = bucket[0]!;
        if (!send(next.data)) return;
        bucket.shift();
        sent += next.size;
        drainedThisRound++;
        const remaining = (this.bucketBytes.get(topic) ?? 0) - next.size;
        if (bucket.length === 0) {
          this.buckets.delete(topic);
          this.bucketBytes.delete(topic);
        } else {
          this.bucketBytes.set(topic, remaining);
        }
      }
      if (drainedThisRound === 0) break;
      this.cursor++;
    }
  }

  isEmpty(): boolean {
    return this.buckets.size === 0;
  }

  destroy(): void {
    this.destroyed = true;
    this.buckets.clear();
    this.bucketBytes.clear();
  }

  private bucketSize(bucket: Frame[]): number {
    let total = 0;
    for (const f of bucket) total += f.size;
    return total;
  }
}
