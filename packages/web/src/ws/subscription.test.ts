import { describe, expect, it } from 'vitest';
import { Topics } from '@coder-studio/core';
import { sessionTopic, terminalTopic, workspaceTopic } from './subscription.js';

describe('subscription topic helpers', () => {
  it('builds workspace topics through Topics-compatible helpers', () => {
    expect(workspaceTopic('ws-1', 'meta')).toBe(Topics.workspaceMeta('ws-1'));
    expect(workspaceTopic('ws-1', 'git', 'state')).toBe(Topics.workspaceGitState('ws-1'));
    expect(workspaceTopic('ws-1', 'fs', 'dirty')).toBe(Topics.workspaceFsDirty('ws-1'));
  });

  it('builds terminal topics through Topics-compatible helpers', () => {
    expect(terminalTopic('ws-1', 'term-1', 'created')).toBe(
      Topics.terminalCreated('ws-1', 'term-1')
    );
    expect(terminalTopic('ws-1', 'term-1', 'output')).toBe(
      Topics.terminalOutput('ws-1', 'term-1')
    );
    expect(terminalTopic('ws-1', 'term-1', 'exit')).toBe(
      Topics.terminalExit('ws-1', 'term-1')
    );
  });

  it('builds session topics through Topics-compatible helpers', () => {
    expect(sessionTopic('ws-1', 'sess-1', 'state')).toBe(
      Topics.sessionState('ws-1', 'sess-1')
    );
    expect(sessionTopic('ws-1', 'sess-1', 'progress')).toBe(
      Topics.sessionProgress('ws-1', 'sess-1')
    );
    expect(sessionTopic('ws-1', 'sess-1', 'supervisor.state')).toBe(
      Topics.supervisorState('ws-1', 'sess-1')
    );
    expect(sessionTopic('ws-1', 'sess-1', 'supervisor.cycle')).toBe(
      Topics.supervisorCycle('ws-1', 'sess-1')
    );
  });
});
