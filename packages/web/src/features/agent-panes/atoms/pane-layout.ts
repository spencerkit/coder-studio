/**
 * Agent Pane Layout State
 *
 * Server-backed pane layout projection owned by the agent-panes feature.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import type { WorkspacePaneNode } from '@coder-studio/core';

/**
 * Pane layout by workspace (agent pane splits)
 * Persisted: ui.paneLayout.<workspaceId>
 */
export interface PaneNode extends WorkspacePaneNode {
  ratio?: number;
  children?: PaneNode[];
}

export const LEGACY_PANE_LAYOUT_STORAGE_KEY_PREFIX = 'ui.paneLayout.';

export const defaultPaneLayout: PaneNode = {
  id: 'root',
  type: 'leaf',
};

export const paneLayoutAtomFamily = atomFamily((workspaceId: string) =>
  atom<PaneNode>(defaultPaneLayout)
);
