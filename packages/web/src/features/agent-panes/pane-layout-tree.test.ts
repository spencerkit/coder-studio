import { describe, expect, it } from 'vitest';
import type { PaneNode } from '../../atoms/ui';
import { closePaneBySessionId, splitPaneBySessionId } from './pane-layout-tree';

describe('pane-layout-tree', () => {
  it('splits a session leaf into the original session and a draft pane', () => {
    const layout: PaneNode = {
      id: 'root',
      type: 'leaf',
      sessionId: 'sess_1',
    };

    const nextLayout = splitPaneBySessionId(layout, 'sess_1', 'vertical');

    expect(nextLayout).toEqual(
      expect.objectContaining({
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        children: [
          expect.objectContaining({ type: 'leaf', sessionId: 'sess_1' }),
          expect.objectContaining({ type: 'leaf' }),
        ],
      })
    );
  });

  it('collapses split nodes when closing a child pane', () => {
    const layout: PaneNode = {
      id: 'root',
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      children: [
        { id: 'left', type: 'leaf', sessionId: 'sess_1' },
        { id: 'right', type: 'leaf', sessionId: 'sess_2' },
      ],
    };

    const nextLayout = closePaneBySessionId(layout, 'sess_1');

    expect(nextLayout).toEqual(
      expect.objectContaining({
        type: 'leaf',
        sessionId: 'sess_2',
      })
    );
  });

  it('returns an empty draft leaf when the final pane is closed', () => {
    const layout: PaneNode = {
      id: 'root',
      type: 'leaf',
      sessionId: 'sess_1',
    };

    expect(closePaneBySessionId(layout, 'sess_1')).toEqual({
      id: 'root',
      type: 'leaf',
    });
  });
});
