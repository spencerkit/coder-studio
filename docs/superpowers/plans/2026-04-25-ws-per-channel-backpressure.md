# WS Per-Channel Backpressure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current per-socket "drop everything when bufferedAmount > 1MiB" backpressure with a per-channel scheme that never drops control-class events and isolates noisy stream-class topics from each other.

**Architecture:** `WsClient` exposes two send paths: `sendControl()` (direct, never dropped) and `sendStream(topic, msg)` (buffered through a per-topic `StreamBuffer` with fair-rotation drain and on-demand flush timer). `WsHub.broadcast()` routes by `isStreamTopic(topic)`. Frontend protocol is unchanged; existing `terminal.replay` covers stream recovery.

**Tech Stack:** TypeScript, Node.js, `ws` library, Vitest. Server code lives in `packages/server/src/ws/`.

**Spec:** `docs/superpowers/specs/2026-04-25-ws-per-channel-backpressure-design.md`

---

## File Structure

**New files:**
- `packages/server/src/ws/topic-class.ts` — `isStreamTopic(topic)` predicate
- `packages/server/src/ws/stream-buffer.ts` — `StreamBuffer` class + `Frame` interface + `STREAM_BUFFER_DEFAULTS`
- `packages/server/src/__tests__/topic-class.test.ts`
- `packages/server/src/__tests__/stream-buffer.test.ts`

**Modified files:**
- `packages/server/src/ws/client.ts` — add `sendControl`, `sendStream`, `sendEventStream`, `flushStream`, timer plumbing; remove per-socket bufferedAmount drop in `send`
- `packages/server/src/ws/hub.ts` — `broadcast()` routes by `isStreamTopic`; fix stale `Broadcaster` comment
- `packages/server/src/__tests__/ws-client.test.ts` — replace "should handle backpressure" test; add stream-path tests
- `packages/server/src/__tests__/ws-hub.test.ts` — add routing assertions for stream vs control

---

## Constants

These live where they're used:

In `stream-buffer.ts`:
```ts
export const STREAM_BUFFER_DEFAULTS = {
  topicCap: 256 * 1024,   // bytes per topic queue
  topicLruCap: 16,        // max active topics before LRU eviction
} as const;
```

In `client.ts`:
```ts
const HIGH_WATER = 512 * 1024;  // bytes; stream queues above this
const LOW_WATER = 128 * 1024;   // bytes; flush resume threshold
const FLUSH_INTERVAL_MS = 30;
```

---

## Task 1: `isStreamTopic` predicate

**Files:**
- Create: `packages/server/src/ws/topic-class.ts`
- Test: `packages/server/src/__tests__/topic-class.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `packages/server/src/__tests__/topic-class.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isStreamTopic } from '../ws/topic-class.js';

describe('isStreamTopic', () => {
  it('matches workspace.{wid}.terminal.{tid}.output', () => {
    expect(isStreamTopic('workspace.42.terminal.term-1.output')).toBe(true);
    expect(isStreamTopic('workspace.abc-123.terminal.t_99.output')).toBe(true);
  });

  it('rejects other workspace terminal subtopics', () => {
    expect(isStreamTopic('workspace.42.terminal.term-1.created')).toBe(false);
    expect(isStreamTopic('workspace.42.terminal.term-1.exit')).toBe(false);
  });

  it('rejects non-terminal workspace topics', () => {
    expect(isStreamTopic('workspace.42.session.s1.state')).toBe(false);
    expect(isStreamTopic('workspace.42.meta')).toBe(false);
    expect(isStreamTopic('workspace.42.git.state')).toBe(false);
  });

  it('rejects connection-level topics', () => {
    expect(isStreamTopic('connection.status')).toBe(false);
    expect(isStreamTopic('connection.ready')).toBe(false);
  });

  it('rejects malformed strings that look similar', () => {
    expect(isStreamTopic('terminal.term-1.output')).toBe(false);
    expect(isStreamTopic('workspace..terminal..output')).toBe(false);
    expect(isStreamTopic('output')).toBe(false);
    expect(isStreamTopic('')).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run test, verify it fails**

Run: `pnpm --filter @coder-studio/server test --run topic-class`
Expected: FAIL — `Cannot find module '../ws/topic-class.js'`

- [ ] **Step 1.3: Implement `topic-class.ts`**

Create `packages/server/src/ws/topic-class.ts`:

```ts
const STREAM_TOPIC_RE = /^workspace\.[^.]+\.terminal\.[^.]+\.output$/;

export function isStreamTopic(topic: string): boolean {
  return STREAM_TOPIC_RE.test(topic);
}
```

- [ ] **Step 1.4: Run test, verify it passes**

Run: `pnpm --filter @coder-studio/server test --run topic-class`
Expected: PASS — 5 tests green.

- [ ] **Step 1.5: Commit**

```bash
git add packages/server/src/ws/topic-class.ts packages/server/src/__tests__/topic-class.test.ts
git commit -m "feat(ws): add isStreamTopic classifier"
```

---

## Task 2: `StreamBuffer` — enqueue + drop oldest

**Files:**
- Create: `packages/server/src/ws/stream-buffer.ts`
- Test: `packages/server/src/__tests__/stream-buffer.test.ts`

- [ ] **Step 2.1: Write failing tests for enqueue and drop-oldest**

Create `packages/server/src/__tests__/stream-buffer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { StreamBuffer, type Frame } from '../ws/stream-buffer.js';

const frame = (data: string): Frame => ({ data, size: Buffer.byteLength(data, 'utf8') });

describe('StreamBuffer enqueue', () => {
  it('starts empty', () => {
    const buf = new StreamBuffer({ topicCap: 1024, topicLruCap: 8 });
    expect(buf.isEmpty()).toBe(true);
  });

  it('isEmpty becomes false after enqueue', () => {
    const buf = new StreamBuffer({ topicCap: 1024, topicLruCap: 8 });
    buf.enqueue('t', frame('hi'));
    expect(buf.isEmpty()).toBe(false);
  });

  it('drops oldest frame when topic exceeds cap', () => {
    const buf = new StreamBuffer({ topicCap: 10, topicLruCap: 8 });
    buf.enqueue('t', frame('aaaa'));   // 4 bytes
    buf.enqueue('t', frame('bbbb'));   // 8 bytes total
    buf.enqueue('t', frame('cccc'));   // would be 12, drops 'aaaa' → 8

    const sent: string[] = [];
    buf.drain(1024, (d) => { sent.push(d); return true; });
    expect(sent).toEqual(['bbbb', 'cccc']);
  });

  it('keeps a single oversized frame as the only entry', () => {
    const buf = new StreamBuffer({ topicCap: 4, topicLruCap: 8 });
    buf.enqueue('t', frame('hugepayload'));   // 11 bytes > cap

    const sent: string[] = [];
    buf.drain(1024, (d) => { sent.push(d); return true; });
    expect(sent).toEqual(['hugepayload']);
  });

  it('isolates topics: cap is per-topic, not global', () => {
    const buf = new StreamBuffer({ topicCap: 8, topicLruCap: 8 });
    buf.enqueue('a', frame('xxxxxxxx'));   // exactly cap, no drop
    buf.enqueue('b', frame('yyyyyyyy'));   // exactly cap, no drop

    const sent: string[] = [];
    buf.drain(1024, (d) => { sent.push(d); return true; });
    expect(sent.length).toBe(2);
    expect(sent).toContain('xxxxxxxx');
    expect(sent).toContain('yyyyyyyy');
  });
});
```

- [ ] **Step 2.2: Run, verify failure**

Run: `pnpm --filter @coder-studio/server test --run stream-buffer`
Expected: FAIL — `Cannot find module`

- [ ] **Step 2.3: Implement enqueue + minimal drain**

Create `packages/server/src/ws/stream-buffer.ts`:

```ts
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
```

- [ ] **Step 2.4: Run, verify pass**

Run: `pnpm --filter @coder-studio/server test --run stream-buffer`
Expected: PASS — 5 tests green.

- [ ] **Step 2.5: Commit**

```bash
git add packages/server/src/ws/stream-buffer.ts packages/server/src/__tests__/stream-buffer.test.ts
git commit -m "feat(ws): add StreamBuffer with per-topic cap and drop-oldest"
```

---

## Task 3: `StreamBuffer` — LRU eviction

**Files:**
- Modify: `packages/server/src/ws/stream-buffer.ts`
- Modify: `packages/server/src/__tests__/stream-buffer.test.ts`

- [ ] **Step 3.1: Add failing LRU test**

Append to `stream-buffer.test.ts`:

```ts
describe('StreamBuffer LRU eviction', () => {
  it('evicts least-recently-written topic when adding past topicLruCap', () => {
    const buf = new StreamBuffer({ topicCap: 1024, topicLruCap: 3 });
    buf.enqueue('a', frame('a-data'));
    buf.enqueue('b', frame('b-data'));
    buf.enqueue('c', frame('c-data'));
    buf.enqueue('d', frame('d-data'));   // should evict 'a'

    const sent: string[] = [];
    buf.drain(1024, (d) => { sent.push(d); return true; });
    expect(sent).not.toContain('a-data');
    expect(sent).toContain('b-data');
    expect(sent).toContain('c-data');
    expect(sent).toContain('d-data');
  });

  it('writing to existing topic refreshes its LRU position', () => {
    const buf = new StreamBuffer({ topicCap: 1024, topicLruCap: 3 });
    buf.enqueue('a', frame('a-old'));
    buf.enqueue('b', frame('b-data'));
    buf.enqueue('c', frame('c-data'));
    buf.enqueue('a', frame('a-new'));   // refresh 'a'
    buf.enqueue('d', frame('d-data'));   // should evict 'b' (oldest), not 'a'

    const sent: string[] = [];
    buf.drain(1024, (d) => { sent.push(d); return true; });
    expect(sent).not.toContain('b-data');
    expect(sent).toContain('a-old');
    expect(sent).toContain('a-new');
    expect(sent).toContain('c-data');
    expect(sent).toContain('d-data');
  });
});
```

- [ ] **Step 3.2: Run, verify failure**

Run: `pnpm --filter @coder-studio/server test --run stream-buffer`
Expected: FAIL — first new test should fail because `a-data` ends up sent.

- [ ] **Step 3.3: Implement LRU eviction in `enqueue`**

In `packages/server/src/ws/stream-buffer.ts`, replace the `if (!bucket) {` branch inside `enqueue` so it evicts before inserting a new topic:

```ts
    let bucket = this.buckets.get(topic);
    if (!bucket) {
      while (this.buckets.size >= this.options.topicLruCap) {
        const oldest = this.buckets.keys().next().value;
        if (oldest === undefined) break;
        this.buckets.delete(oldest);
        this.bucketBytes.delete(oldest);
      }
      bucket = [];
      this.buckets.set(topic, bucket);
      this.bucketBytes.set(topic, 0);
    } else {
```

(The else branch and remainder of `enqueue` stay as in Task 2.)

- [ ] **Step 3.4: Run, verify pass**

Run: `pnpm --filter @coder-studio/server test --run stream-buffer`
Expected: PASS — all stream-buffer tests green.

- [ ] **Step 3.5: Commit**

```bash
git add packages/server/src/ws/stream-buffer.ts packages/server/src/__tests__/stream-buffer.test.ts
git commit -m "feat(ws): add LRU topic eviction to StreamBuffer"
```

---

## Task 4: `StreamBuffer` — fair rotation + drain stop conditions

**Files:**
- Modify: `packages/server/src/__tests__/stream-buffer.test.ts`

The drain logic implemented in Task 2 already does fair rotation; this task adds explicit tests so the contract is locked.

- [ ] **Step 4.1: Add fair rotation + send-failure tests**

Append to `stream-buffer.test.ts`:

```ts
describe('StreamBuffer drain', () => {
  it('round-robins frames across topics in fair order', () => {
    const buf = new StreamBuffer({ topicCap: 1024, topicLruCap: 8 });
    buf.enqueue('a', frame('a1'));
    buf.enqueue('a', frame('a2'));
    buf.enqueue('b', frame('b1'));
    buf.enqueue('b', frame('b2'));

    const sent: string[] = [];
    buf.drain(1024, (d) => { sent.push(d); return true; });
    expect(sent).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('stops when send returns false and leaves remaining frames in queue', () => {
    const buf = new StreamBuffer({ topicCap: 1024, topicLruCap: 8 });
    buf.enqueue('t', frame('one'));
    buf.enqueue('t', frame('two'));

    const sent: string[] = [];
    let allow = 1;
    buf.drain(1024, (d) => {
      if (allow-- <= 0) return false;
      sent.push(d);
      return true;
    });
    expect(sent).toEqual(['one']);
    expect(buf.isEmpty()).toBe(false);

    // Subsequent drain delivers the remainder
    const more: string[] = [];
    buf.drain(1024, (d) => { more.push(d); return true; });
    expect(more).toEqual(['two']);
    expect(buf.isEmpty()).toBe(true);
  });

  it('stops when cumulative sent bytes reach maxBytes', () => {
    const buf = new StreamBuffer({ topicCap: 1024, topicLruCap: 8 });
    buf.enqueue('t', frame('aaa'));   // 3
    buf.enqueue('t', frame('bbb'));   // 3
    buf.enqueue('t', frame('ccc'));   // 3

    const sent: string[] = [];
    buf.drain(5, (d) => { sent.push(d); return true; });
    // After sending 'aaa' (3) and 'bbb' (3), cumulative = 6 ≥ 5 → stop
    expect(sent).toEqual(['aaa', 'bbb']);
    expect(buf.isEmpty()).toBe(false);
  });

  it('rotates start position across drain calls so no topic is starved', () => {
    const buf = new StreamBuffer({ topicCap: 1024, topicLruCap: 8 });
    buf.enqueue('a', frame('a1'));
    buf.enqueue('b', frame('b1'));

    const seen: string[][] = [[], []];
    buf.drain(1024, (d) => { seen[0]!.push(d); return true; });

    buf.enqueue('a', frame('a2'));
    buf.enqueue('b', frame('b2'));
    buf.drain(1024, (d) => { seen[1]!.push(d); return true; });

    // First drain saw [a1, b1]; second drain rotation starts at b
    expect(seen[0]).toEqual(['a1', 'b1']);
    expect(seen[1]).toEqual(['b2', 'a2']);
  });
});
```

- [ ] **Step 4.2: Run, verify pass**

Run: `pnpm --filter @coder-studio/server test --run stream-buffer`
Expected: PASS — drain tests are verifying behavior already implemented.

- [ ] **Step 4.3: Commit**

```bash
git add packages/server/src/__tests__/stream-buffer.test.ts
git commit -m "test(ws): lock fair-rotation and stop-condition contracts for StreamBuffer drain"
```

---

## Task 5: `StreamBuffer` — destroy

**Files:**
- Modify: `packages/server/src/__tests__/stream-buffer.test.ts`

The `destroy()` method already exists from Task 2. This task adds tests for its post-destroy contract.

- [ ] **Step 5.1: Add destroy tests**

Append to `stream-buffer.test.ts`:

```ts
describe('StreamBuffer destroy', () => {
  it('clears all buckets and reports empty', () => {
    const buf = new StreamBuffer({ topicCap: 1024, topicLruCap: 8 });
    buf.enqueue('a', frame('a1'));
    buf.enqueue('b', frame('b1'));
    buf.destroy();
    expect(buf.isEmpty()).toBe(true);
  });

  it('post-destroy enqueue is a no-op', () => {
    const buf = new StreamBuffer({ topicCap: 1024, topicLruCap: 8 });
    buf.destroy();
    expect(() => buf.enqueue('a', frame('after'))).not.toThrow();
    expect(buf.isEmpty()).toBe(true);
  });

  it('post-destroy drain is a no-op', () => {
    const buf = new StreamBuffer({ topicCap: 1024, topicLruCap: 8 });
    buf.enqueue('a', frame('before'));
    buf.destroy();
    const send = vi.fn();
    buf.drain(1024, send);
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5.2: Run, verify pass**

Run: `pnpm --filter @coder-studio/server test --run stream-buffer`
Expected: PASS — all stream-buffer tests green.

- [ ] **Step 5.3: Commit**

```bash
git add packages/server/src/__tests__/stream-buffer.test.ts
git commit -m "test(ws): lock StreamBuffer destroy semantics"
```

---

## Task 6: `WsClient` — split `send` into `sendControl` and remove per-socket drop

**Files:**
- Modify: `packages/server/src/ws/client.ts`
- Modify: `packages/server/src/__tests__/ws-client.test.ts`

- [ ] **Step 6.1: Replace the failing test for the new control-path contract**

In `packages/server/src/__tests__/ws-client.test.ts`, replace the existing `'should handle backpressure'` test (lines 54–61) with:

```ts
  it('sendControl never drops on bufferedAmount (control class is unconditional)', () => {
    mockSocket.bufferedAmount = 8 * 1024 * 1024; // way above the old 1MiB threshold

    const result = client.sendControl({
      kind: 'event',
      topic: 'test',
      seq: 1,
      timestamp: 0,
      data: {},
    });

    expect(result).toBe(true);
    expect(mockSocket.send).toHaveBeenCalled();
  });

  it('send() is an alias for sendControl()', () => {
    mockSocket.bufferedAmount = 8 * 1024 * 1024;

    const result = client.send({
      kind: 'event',
      topic: 'test',
      seq: 1,
      timestamp: 0,
      data: {},
    });

    expect(result).toBe(true);
    expect(mockSocket.send).toHaveBeenCalled();
  });
```

- [ ] **Step 6.2: Run, verify failure**

Run: `pnpm --filter @coder-studio/server test --run ws-client`
Expected: FAIL — `client.sendControl is not a function` and the alias case fails because the existing `send` returns false at high bufferedAmount.

- [ ] **Step 6.3: Add `sendControl` and make `send` an alias**

In `packages/server/src/ws/client.ts`, replace the `send(msg: ServerToClient)` method (lines 70–90) with:

```ts
  /**
   * Control-class send: bypasses application-level backpressure.
   * Stream-class senders go through sendStream() instead.
   */
  sendControl(msg: ServerToClient): boolean {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.socket.send(JSON.stringify(msg));
      return true;
    } catch (error) {
      console.error(`Failed to send message to client ${this.id}:`, error);
      return false;
    }
  }

  /**
   * Backwards-compatible alias for sendControl.
   * Kept so existing call sites (hub.send, dispatch results, sendToClient) compile unchanged.
   */
  send(msg: ServerToClient): boolean {
    return this.sendControl(msg);
  }
```

- [ ] **Step 6.4: Run, verify pass**

Run: `pnpm --filter @coder-studio/server test --run ws-client`
Expected: PASS — all `ws-client` tests green, including the rewritten backpressure test and the existing `'should send event'` and `'should not send when socket not open'` tests.

- [ ] **Step 6.5: Run the full server suite to catch downstream impact**

Run: `pnpm --filter @coder-studio/server test --run`
Expected: PASS — `ws-hub`, `ws-client`, `terminal-events`, etc. should all stay green because `client.send()` retains its old return-value contract and only loses the unconditional drop branch.

- [ ] **Step 6.6: Commit**

```bash
git add packages/server/src/ws/client.ts packages/server/src/__tests__/ws-client.test.ts
git commit -m "refactor(ws): introduce sendControl, drop per-socket bufferedAmount gate

Removes the 1 MiB bufferedAmount drop from WsClient.send. Control-class
events should never be dropped; stream-class events get their own buffered
path in the next commit."
```

---

## Task 7: `WsClient` — stream send path with on-demand flush timer

**Files:**
- Modify: `packages/server/src/ws/client.ts`
- Modify: `packages/server/src/__tests__/ws-client.test.ts`

- [ ] **Step 7.1: Write failing tests for the stream path**

Append to `packages/server/src/__tests__/ws-client.test.ts` (inside the `describe('WsClient', ...)` block):

```ts
  describe('stream path', () => {
    const HIGH = 512 * 1024;
    const LOW  = 128 * 1024;
    const sample = { kind: 'event', topic: 't', seq: 0, timestamp: 0, data: {} } as const;

    it('sendStream below HIGH water sends directly', () => {
      mockSocket.bufferedAmount = 0;
      client.sendStream('workspace.x.terminal.t1.output', sample);
      expect(mockSocket.send).toHaveBeenCalledTimes(1);
    });

    it('sendStream at or above HIGH water defers to the buffer and starts the flush timer', () => {
      vi.useFakeTimers();
      mockSocket.bufferedAmount = HIGH;
      client.sendStream('workspace.x.terminal.t1.output', sample);
      expect(mockSocket.send).not.toHaveBeenCalled();

      // Drop below LOW and tick the flush timer
      mockSocket.bufferedAmount = LOW - 1;
      vi.advanceTimersByTime(40);
      expect(mockSocket.send).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('clears the flush timer once the buffer is drained', () => {
      vi.useFakeTimers();
      mockSocket.bufferedAmount = HIGH;
      client.sendStream('workspace.x.terminal.t1.output', sample);

      mockSocket.bufferedAmount = 0;
      vi.advanceTimersByTime(40);
      expect(mockSocket.send).toHaveBeenCalledTimes(1);

      // Another tick after queue is empty: must not produce more sends
      mockSocket.send.mockClear();
      vi.advanceTimersByTime(200);
      expect(mockSocket.send).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('isolates topics: a noisy topic does not block another topic from sending', () => {
      vi.useFakeTimers();
      mockSocket.bufferedAmount = HIGH;
      client.sendStream('workspace.x.terminal.A.output', { ...sample, data: { id: 'A' } });
      client.sendStream('workspace.x.terminal.B.output', { ...sample, data: { id: 'B' } });

      mockSocket.bufferedAmount = 0;
      vi.advanceTimersByTime(40);

      const sentTopics = mockSocket.send.mock.calls.map(
        ([raw]: [string]) => JSON.parse(raw).data.id
      );
      expect(sentTopics).toEqual(['A', 'B']);
      vi.useRealTimers();
    });

    it('control sends remain unaffected when the stream buffer is busy', () => {
      mockSocket.bufferedAmount = HIGH;
      client.sendStream('workspace.x.terminal.t1.output', sample);
      mockSocket.send.mockClear();

      const ok = client.sendControl({
        kind: 'event',
        topic: 'workspace.x.session.s1.state',
        seq: 0,
        timestamp: 0,
        data: { state: 'running' },
      });

      expect(ok).toBe(true);
      expect(mockSocket.send).toHaveBeenCalledTimes(1);
    });

    it('close clears the flush timer and destroys the buffer', () => {
      vi.useFakeTimers();
      mockSocket.bufferedAmount = HIGH;
      client.sendStream('workspace.x.terminal.t1.output', sample);

      // Simulate ws emitting 'close'
      const closeHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'close'
      )?.[1];
      mockSocket.readyState = WebSocket.CLOSED;
      closeHandler?.();

      mockSocket.send.mockClear();
      vi.advanceTimersByTime(200);
      expect(mockSocket.send).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
```

- [ ] **Step 7.2: Run, verify failure**

Run: `pnpm --filter @coder-studio/server test --run ws-client`
Expected: FAIL — `client.sendStream is not a function`.

- [ ] **Step 7.3: Add `sendStream`, `sendEventStream`, flush plumbing, and close cleanup**

Edit `packages/server/src/ws/client.ts`. Add the StreamBuffer import and constants near the top:

```ts
import { StreamBuffer, type Frame } from './stream-buffer.js';

const HIGH_WATER = 512 * 1024;
const LOW_WATER = 128 * 1024;
const FLUSH_INTERVAL_MS = 30;
```

Add fields to the class (next to existing `private subscriptions = new Set<string>();`):

```ts
  private readonly streamBuffer = new StreamBuffer();
  private flushTimer: NodeJS.Timeout | null = null;
```

Update `setupSocketHandlers` so the close branch tears down the stream side:

```ts
    this.socket.on('close', () => {
      this.isAlive = false;
      this.clearFlushTimer();
      this.streamBuffer.destroy();
      this.closeHandler?.();
    });
```

Add the new send paths after `send()` (before `sendEvent`):

```ts
  /**
   * Stream-class send: queued per-topic, drop-oldest on overflow.
   * Caller-side ordering is preserved within a topic; across topics the
   * flusher uses fair rotation. Frontend recovers via seq-gap + replay.
   */
  sendStream(topic: string, msg: ServerToClient): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;

    const data = JSON.stringify(msg);
    const frame: Frame = {
      data,
      size: Buffer.byteLength(data, 'utf8'),
    };

    const buffered = this.socket.bufferedAmount ?? 0;
    if (buffered < HIGH_WATER && this.streamBuffer.isEmpty()) {
      try {
        this.socket.send(data);
      } catch (error) {
        console.error(`Failed to send stream frame to client ${this.id}:`, error);
      }
      return;
    }

    this.streamBuffer.enqueue(topic, frame);
    this.flushStream();
  }

  /**
   * Sugar for stream-class events (mirrors sendEvent for control class).
   */
  sendEventStream(topic: string, data: unknown, seq: number = 0): void {
    const event: Event = {
      kind: 'event',
      topic,
      seq,
      timestamp: Date.now(),
      data,
    };
    this.sendStream(topic, event);
  }

  private flushStream(): void {
    if (this.socket.readyState !== WebSocket.OPEN) {
      this.clearFlushTimer();
      this.streamBuffer.destroy();
      return;
    }

    const buffered = this.socket.bufferedAmount ?? 0;
    if (buffered < LOW_WATER) {
      const headroom = HIGH_WATER - buffered;
      this.streamBuffer.drain(headroom, (data) => {
        try {
          this.socket.send(data);
          return true;
        } catch (error) {
          console.error(`Stream send failed for client ${this.id}:`, error);
          return false;
        }
      });
    }

    if (this.streamBuffer.isEmpty()) {
      this.clearFlushTimer();
    } else {
      this.ensureFlushTimer();
    }
  }

  private ensureFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flushStream(), FLUSH_INTERVAL_MS);
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
```

- [ ] **Step 7.4: Run, verify pass**

Run: `pnpm --filter @coder-studio/server test --run ws-client`
Expected: PASS — all `ws-client` tests including the new `describe('stream path', ...)` block.

- [ ] **Step 7.5: Commit**

```bash
git add packages/server/src/ws/client.ts packages/server/src/__tests__/ws-client.test.ts
git commit -m "feat(ws): add sendStream path with per-topic StreamBuffer and flush timer"
```

---

## Task 8: `WsHub.broadcast` — route by `isStreamTopic`

**Files:**
- Modify: `packages/server/src/ws/hub.ts`
- Modify: `packages/server/src/__tests__/ws-hub.test.ts`

- [ ] **Step 8.1: Add failing routing tests**

Append to the existing `describe('WsHub', ...)` block in `ws-hub.test.ts`. Wrap timer-sensitive tests in `vi.useFakeTimers()` so the on-demand flush timer started by the queued path can't leak into other tests:

```ts
  it('routes terminal.output broadcasts through the stream path', () => {
    vi.useFakeTimers();
    try {
      const socket = createMockSocket();
      hub.handleConnection(socket, createMockRequest());
      subscribeToAllTopics(socket);
      socket.bufferedAmount = 1024 * 1024; // above HIGH (512 KiB)
      socket.send.mockClear();

      eventBus.emit({
        type: 'terminal.output',
        workspaceId: 'workspace-42',
        terminalId: 'term-123',
        chunk: Buffer.from('hi'),
        seq: 1,
      });

      // Stream path: high buffer → frame queued, no send yet
      expect(socket.send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes non-terminal-output events through the control path regardless of buffer', () => {
    const socket = createMockSocket();
    hub.handleConnection(socket, createMockRequest());
    subscribeToAllTopics(socket);
    socket.bufferedAmount = 8 * 1024 * 1024; // far above any threshold
    socket.send.mockClear();

    eventBus.emit({
      type: 'session.state.changed',
      workspaceId: 'workspace-42',
      sessionId: 'sess-123',
      from: 'starting',
      to: 'running',
    });

    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.send.mock.calls[0]?.[0]).toMatch(/session\.sess-123\.state/);
  });
```

> Note: the exact `eventBus.emit` payload shape (field names like `type`, `chunk`, `from`/`to`) must match the `DomainEvent` discriminated union in `packages/core/src/domain/events.ts`. If the existing `'should translate terminal.output events'` test in this file uses a slightly different shape (e.g., a different field name), match that established shape rather than the literals shown here.

- [ ] **Step 8.2: Run, verify failure**

Run: `pnpm --filter @coder-studio/server test --run ws-hub`
Expected: FAIL — the first new test fails because `terminal.output` currently goes through `sendEvent` (control path), so `socket.send` is called even at high bufferedAmount.

- [ ] **Step 8.3: Update `broadcast` to route by topic class**

In `packages/server/src/ws/hub.ts`, add the import near the top:

```ts
import { isStreamTopic } from './topic-class.js';
```

Replace the `broadcast` method (lines 129–135):

```ts
  /**
   * Broadcast to all subscribed clients.
   * Routes by isStreamTopic: stream topics go through the per-topic queued
   * path; everything else goes through the control path (never dropped).
   */
  broadcast(topic: string, payload: unknown): void {
    const stream = isStreamTopic(topic);
    for (const client of this.clients.values()) {
      if (!client.subscribesTo(topic)) continue;
      if (stream) {
        client.sendEventStream(topic, payload);
      } else {
        client.sendEvent(topic, payload);
      }
    }
  }
```

Also update the stale `Broadcaster` interface comment (lines 32–35):

```ts
/**
 * Broadcaster interface for fan-out of domain events to subscribed clients.
 * Used by FsWatcher and SupervisorManager; WsHub is the only implementation.
 * Internally routes via isStreamTopic so callers don't have to classify.
 */
export interface Broadcaster {
  broadcast(topic: string, data: unknown): void;
}
```

- [ ] **Step 8.4: Run, verify pass**

Run: `pnpm --filter @coder-studio/server test --run ws-hub`
Expected: PASS — both new tests + all existing `ws-hub` tests green. The pre-existing `'should translate terminal.output events'` test stays green because the test mock has `bufferedAmount: 0`, so the stream path takes the direct-send fast lane.

- [ ] **Step 8.5: Run the full server suite**

Run: `pnpm --filter @coder-studio/server test --run`
Expected: PASS across all server tests.

- [ ] **Step 8.6: Commit**

```bash
git add packages/server/src/ws/hub.ts packages/server/src/__tests__/ws-hub.test.ts
git commit -m "feat(ws): route broadcast by isStreamTopic for per-channel backpressure"
```

---

## Task 9: Manual acceptance smoke test

**Files:** none (manual verification)

This is the spec's acceptance section, run by hand on the dev server.

- [ ] **Step 9.1: Start the dev server in a terminal**

```bash
pnpm dev
```

Wait for the server to bind and the web client to load. Open the web UI in a browser.

- [ ] **Step 9.2: Verify control-plane is unaffected by stream load**

In a workspace, create a shell terminal and run:

```bash
yes | head -c 50000000 | base64
```

While that pours output through the stream channel, in another browser pane rename the workspace. The new name should appear in the UI immediately (control event survives stream pressure).

PASS criterion: workspace meta change reflects within < 1 second while the high-volume stream is still running.

- [ ] **Step 9.3: Verify noisy-neighbor isolation**

Open two terminals in the same workspace. In terminal A run:

```bash
yes | head -c 50000000 | base64
```

In terminal B run a low-frequency loop, e.g.:

```bash
while true; do echo "tick $(date +%s)"; sleep 1; done
```

PASS criterion: terminal B continues to render its tick lines on time even while A is saturated. Brief catch-up delays are acceptable; complete stalls are not.

- [ ] **Step 9.4: Verify cleanup on disconnect**

While streams are running, close the browser tab. In the server logs, no `flushStream` errors should appear. If `process.memoryUsage()` is logged, RSS should plateau within a few seconds rather than continuing to grow.

- [ ] **Step 9.5: Record results in the verification report**

Append a row to `docs/验收报告/` (per the `feedback-commit-scope-includes-docs-and-reports` memory). Include date, scenario, observed behavior. If the report uses a fixed filename pattern, follow it; otherwise create `docs/验收报告/2026-04-25-ws-per-channel-backpressure.md` with a short summary of the three checks above.

- [ ] **Step 9.6: Commit the verification report**

```bash
git add docs/验收报告/
git commit -m "docs: acceptance report for per-channel WS backpressure"
```

---

## Done Criteria

- [ ] All steps in tasks 1–8 are checked off and committed
- [ ] `pnpm --filter @coder-studio/server test --run` is green
- [ ] Manual smoke checks in task 9 pass and are recorded
- [ ] Frontend `xterm-host.test.tsx` was not modified (sanity: `git log --follow packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx` since branch base shows no new changes)
