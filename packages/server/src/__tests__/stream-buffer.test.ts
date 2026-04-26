import { describe, it, expect, vi } from 'vitest';
import { StreamBuffer, type Frame } from '../ws/stream-buffer.js';

const frame = (data: string | Buffer): Frame => ({
  data,
  size: typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : data.byteLength,
});

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
    buf.enqueue('t', frame('aaaa'));
    buf.enqueue('t', frame('bbbb'));
    buf.enqueue('t', frame('cccc'));

    const sent: string[] = [];
    buf.drain(1024, (d) => {
      sent.push(d);
      return true;
    });
    expect(sent).toEqual(['bbbb', 'cccc']);
  });

  it('keeps a single oversized frame as the only entry', () => {
    const buf = new StreamBuffer({ topicCap: 4, topicLruCap: 8 });
    buf.enqueue('t', frame('hugepayload'));

    const sent: string[] = [];
    buf.drain(1024, (d) => {
      sent.push(d as string);
      return true;
    });
    expect(sent).toEqual(['hugepayload']);
  });

  it('drains binary frames without changing payload bytes', () => {
    const buf = new StreamBuffer({ topicCap: 1024, topicLruCap: 8 });
    const payload = Buffer.from([1, 2, 3]);
    buf.enqueue('t', frame(payload));

    const sent: Buffer[] = [];
    buf.drain(1024, (d) => {
      sent.push(d as Buffer);
      return true;
    });

    expect(sent).toEqual([payload]);
  });

  it('isolates topics: cap is per-topic, not global', () => {
    const buf = new StreamBuffer({ topicCap: 8, topicLruCap: 8 });
    buf.enqueue('a', frame('xxxxxxxx'));
    buf.enqueue('b', frame('yyyyyyyy'));

    const sent: string[] = [];
    buf.drain(1024, (d) => {
      sent.push(d);
      return true;
    });
    expect(sent.length).toBe(2);
    expect(sent).toContain('xxxxxxxx');
    expect(sent).toContain('yyyyyyyy');
  });
});

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

    expect(seen[0]).toEqual(['a1', 'b1']);
    expect(seen[1]).toEqual(['b2', 'a2']);
  });
});

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
