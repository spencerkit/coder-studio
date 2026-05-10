import type { CommandContext } from "../ws/dispatch.js";

export function emitGitStateChanged(
  ctx: CommandContext,
  workspaceId: string,
  options?: {
    treeChanged?: boolean;
    branchChanged?: boolean;
    worktreeChanged?: boolean;
  }
) {
  ctx.eventBus.emit({
    type: "git.state.changed",
    workspaceId,
    treeChanged: options?.treeChanged,
    branchChanged: options?.branchChanged,
    worktreeChanged: options?.worktreeChanged,
  });
}
