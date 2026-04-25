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
