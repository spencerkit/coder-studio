import { describe, expect, it } from 'vitest';
import type { PaneNode } from '../../atoms/ui';
import { assignSessionToPane, closePaneBySessionId, splitPaneBySessionId } from './pane-layout-tree';

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

  it('turns the closed session pane into a draft leaf while preserving split layout', () => {
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

    expect(nextLayout).toEqual({
      id: 'root',
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      children: [
        { id: 'left', type: 'leaf' },
        { id: 'right', type: 'leaf', sessionId: 'sess_2' },
      ],
    });
  });

  it('assigns a session to the matching draft pane without touching siblings', () => {
    const layout: PaneNode = {
      id: 'root',
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      children: [
        { id: 'left', type: 'leaf', sessionId: 'sess_1' },
        { id: 'right', type: 'leaf' },
      ],
    };

    expect(assignSessionToPane(layout, 'right', 'sess_3')).toEqual({
      id: 'root',
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      children: [
        { id: 'left', type: 'leaf', sessionId: 'sess_1' },
        { id: 'right', type: 'leaf', sessionId: 'sess_3' },
      ],
    });
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
