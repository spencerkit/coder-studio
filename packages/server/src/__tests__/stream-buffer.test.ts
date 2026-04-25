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
