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
      sent.push(d);
      return true;
    });
    expect(sent).toEqual(['hugepayload']);
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
