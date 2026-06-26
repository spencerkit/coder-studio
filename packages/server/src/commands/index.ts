/**
 * Command handlers
 *
 * Imported for side effects so handlers register with the dispatch registry.
 * The explicit registration functions are phase-1 bootstrap affordances that
 * currently preserve this static behavior.
 */

import "./workspace.js";
import "./workspace-activity.js";
import "./automation.js";
import "./ui-actions.js";
import "./canvas.js";
import "./activation.js";
import "./connection.js";
import "./recovery.js";
import "./session.js";
import "./session-metadata.js";
import "./session-review.js";
import "./terminal.js";
import "./task.js";
import "./file.js";
import "./git.js";
import "./agent-instructions.js";
import "./skills.js";
import "./agent-context.js";
import "./settings.js";
import "./diagnostics.js";
import "./provider.js";
import "./custom-provider.js";
import "./system-deps.js";
import "./supervisor.js";
import "./worktree.js";
import "./fencing.js";
import "./lsp.js";
import "./updates.js";
import "./monitoring.js";
import "./work-analysis.js";
import "./memory.js";

export async function registerHostCommands(): Promise<void> {}

export async function registerRuntimeCommands(): Promise<void> {}

export async function registerAllCommands(): Promise<void> {
  await registerHostCommands();
  await registerRuntimeCommands();
}
