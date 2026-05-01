/**
 * Agent Pane Layout State
 *
 * Persisted pane layout owned by the agent-panes feature.
 */

import { atomWithStorage } from 'jotai/utils';
import { atomFamily } from 'jotai-family';

/**
 * Pane layout by workspace (agent pane splits)
 * Persisted: ui.paneLayout.<workspaceId>
 */
export interface PaneNode {
  id: string;
  type: 'leaf' | 'split';
  sessionId?: string;
  direction?: 'horizontal' | 'vertical';
  ratio?: number;
  children?: PaneNode[];
}

const defaultPaneLayout: PaneNode = {
  id: 'root',
  type: 'leaf',
};

export const paneLayoutAtomFamily = atomFamily((workspaceId: string) =>
  atomWithStorage<PaneNode>(`ui.paneLayout.${workspaceId}`, defaultPaneLayout)
);
