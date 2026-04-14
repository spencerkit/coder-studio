import { test, expect } from '@playwright/test';
import { createTestWorkspace } from '../../fixtures/test-workspace';

test('@phase1 creates a git-backed temp workspace', async () => {
  const workspace = await createTestWorkspace();
  expect(workspace.path).toContain('coder-studio-phase1-');
  expect(workspace.gitInitialized).toBe(true);
});
