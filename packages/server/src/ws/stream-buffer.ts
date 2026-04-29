export interface Frame {
  data: string | Buffer;
  size: number;
}

export interface StreamBufferDropOldestEvent {
  topic: string;
  frameSize: number;
  bucketBytes: number;
  bucketLength: number;
}

export interface StreamBufferEvictTopicEvent {
  topic: string;
  frames: number;
  bytes: number;
}

export interface StreamBufferOptions {
  topicCap: number;
  topicLruCap: number;
  onDropOldest?: (event: StreamBufferDropOldestEvent) => void;
  onEvictTopic?: (event: StreamBufferEvictTopicEvent) => void;
}

export const STREAM_BUFFER_DEFAULTS: StreamBufferOptions = {
  topicCap: 512 * 1024,
  topicLruCap: 8,
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
      while (this.buckets.size >= this.options.topicLruCap) {
        const oldest = this.buckets.keys().next().value;
        if (oldest === undefined) break;
        const oldestBucket = this.buckets.get(oldest);
        const oldestBytes = this.bucketBytes.get(oldest) ?? 0;
        this.options.onEvictTopic?.({
          topic: oldest,
          frames: oldestBucket?.length ?? 0,
          bytes: oldestBytes,
        });
        this.buckets.delete(oldest);
        this.bucketBytes.delete(oldest);
      }
      bucket = [];
      this.buckets.set(topic, bucket);
      this.bucketBytes.set(topic, 0);
    } else {
      const bytes = this.bucketBytes.get(topic) ?? 0;
      this.buckets.delete(topic);
      this.buckets.set(topic, bucket);
      this.bucketBytes.delete(topic);
      this.bucketBytes.set(topic, bytes);
    }

    bucket.push(frame);
    let bytes = (this.bucketBytes.get(topic) ?? 0) + frame.size;

    while (bytes > this.options.topicCap && bucket.length > 1) {
      const dropped = bucket.shift()!;
      bytes -= dropped.size;
      this.options.onDropOldest?.({
        topic,
        frameSize: dropped.size,
        bucketBytes: bytes,
        bucketLength: bucket.length,
      });
    }

    this.bucketBytes.set(topic, bytes);
  }

  drain(maxBytes: number, send: (data: string | Buffer) => boolean): void {
    if (this.destroyed) return;
    let sent = 0;
    let sentAny = false;
    const startCursor = this.cursor;

    while (sent < maxBytes && this.buckets.size > 0) {
      const topics = [...this.buckets.keys()];
      let drainedThisRound = 0;

      for (let i = 0; i < topics.length && sent < maxBytes; i++) {
        const idx = (startCursor + i) % topics.length;
        const topic = topics[idx]!;
        const bucket = this.buckets.get(topic);
        if (!bucket || bucket.length === 0) continue;

        const next = bucket[0]!;
        if (!send(next.data)) {
          if (sentAny) this.cursor = startCursor + 1;
          return;
        }

        bucket.shift();
        sent += next.size;
        sentAny = true;
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
    }

    if (sentAny) this.cursor = startCursor + 1;
  }

  isEmpty(): boolean {
    return this.buckets.size === 0;
  }

  destroy(): void {
    this.destroyed = true;
    this.buckets.clear();
    this.bucketBytes.clear();
  }
}
